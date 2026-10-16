const { env } = require("../config/env");
const Order = require("../models/Order");
const Job = require("../models/Job");
const Domain = require("../models/Domain");
const Contact = require("../models/Contact");
const { namesilo, assertOk, redact, asArray } = require("../services/namesilo");
const { http } = require("../lib/http");

const SUCCESS = new Set([300, 301, 302]);

function contactParams(contact) {
  return {
    fn: contact.fn,
    ln: contact.ln,
    ad: contact.ad,
    ad2: contact.ad2,
    cy: contact.cy,
    st: contact.st,
    zp: contact.zp,
    ct: contact.ct,
    em: contact.em,
    ph: contact.ph,
    cp: contact.cp,
  };
}

async function ensureNamesiloContact(contact) {
  if (contact.namesiloContactId) return contact.namesiloContactId;
  const reply = assertOk(await namesilo("contactAdd", contactParams(contact)));
  const contactId = String(reply.contact_id || "");
  if (!contactId) throw http(502, "NameSilo did not return a contact id");
  contact.namesiloContactId = contactId;
  await contact.save();
  return contactId;
}

async function associateContact(domain, contactId) {
  return assertOk(
    await namesilo("contactDomainAssociate", {
      domain,
      registrant: contactId,
      administrative: contactId,
      technical: contactId,
      billing: contactId,
    })
  );
}

async function readInfo(domain) {
  const reply = await namesilo("getDomainInfo", { domain });
  if (Number(reply.code) === 300) return reply;
  const detail = String(reply.detail || "");
  if (/not found|does not exist|invalid domain|not active in your account/i.test(detail)) return null;
  throw http(400, redact(detail || "Could not read domain"));
}

async function saveDomain({ userId, order, item, info, warning }) {
  const existing = await Domain.findOne({ name: item.domain });
  if (existing && String(existing.userId) !== String(userId)) {
    throw http(409, `${item.domain} is already linked to another customer`);
  }
  const nameservers = asArray(info?.nameservers).map(String);
  return Domain.findOneAndUpdate(
    { name: item.domain },
    {
      userId,
      orderId: order._id,
      contactId: order.contactId,
      expires: info?.expires || existing?.expires || "",
      locked: String(info?.locked || "Yes").toLowerCase() === "yes",
      privacy: String(info?.private || "Yes").toLowerCase() === "yes",
      premium: item.premium,
      nameservers,
      forwardUrl: info?.forward_url || "",
      forwardType: info?.forward_type || "",
      status: "active",
      warning: warning || "",
    },
    { upsert: true, new: true }
  );
}

function itemById(order, itemId) {
  return order.items.id(itemId);
}

async function refreshOrderStatus(order) {
  const codes = order.items.map((item) => item.namesiloCode);
  const allDone = order.items.every((item) => {
    if (item.action === "transfer") return /complete|success/i.test(item.transferStatus || "");
    return SUCCESS.has(item.namesiloCode);
  });
  const any302 = codes.includes(302);
  const pendingContact = order.items.some((item) => item.namesiloCode === 302 && item.warning);
  if (allDone && !pendingContact) order.status = "active";
  else if (any302 || order.items.some((item) => item.warning && !SUCCESS.has(item.namesiloCode))) {
    order.status = order.status === "awaiting_funds" ? "awaiting_funds" : "action_required";
  } else if (order.status !== "awaiting_funds") order.status = "registering";
  await order.save();
}

async function accountCanCover(cost) {
  const reply = assertOk(await namesilo("getAccountBalance"));
  return { balance: Number(reply.balance), enough: Number(reply.balance) >= Number(cost) };
}

async function handleRegister(order, item, contact) {
  const owned = await Domain.findOne({ name: item.domain });
  if (owned && String(owned.userId) !== String(order.userId)) {
    item.warning = "Domain is already linked to another customer";
    order.status = "action_required";
    return "failed";
  }
  if (owned && SUCCESS.has(item.namesiloCode)) return "done";

  const existingInfo = await readInfo(item.domain);
  if (existingInfo) {
    const created = new Date(existingInfo.created);
    const recent = created >= new Date(new Date(order.createdAt).getTime() - 5 * 60 * 1000);
    if (!owned && !recent) {
      item.warning = "Domain is already in the registrar account";
      order.status = "action_required";
      return "failed";
    }
    await saveDomain({ userId: order.userId, order, item, info: existingInfo, warning: item.warning });
    item.namesiloCode = item.namesiloCode || 300;
    item.namesiloDetail = item.namesiloDetail || "already registered";
    return "done";
  }

  const funds = await accountCanCover(item.costQuote);
  if (!funds.enough) {
    order.status = "awaiting_funds";
    return "wait";
  }

  const contactId = await ensureNamesiloContact(contact);
  const reply = await namesilo("registerDomain", {
    domain: item.domain,
    years: item.years,
    private: 1,
    auto_renew: 0,
    contact_id: contactId,
  });
  const code = Number(reply.code);
  item.namesiloCode = code;
  item.namesiloDetail = redact(reply.detail || "");

  if (code === 300 || code === 301 || code === 302) {
    if (code === 301) {
      item.warning = "Registered with NameSilo default nameservers";
      order.warning = item.warning;
    }
    if (code === 302) {
      try {
        await associateContact(item.domain, contactId);
        const info = await readInfo(item.domain);
        const registrant = String(info?.contact_ids?.registrant || "");
        if (registrant && registrant !== String(contactId)) {
          item.warning = "Registrant contact still needs to be applied";
        } else {
          item.warning = "";
          item.namesiloCode = 300;
        }
      } catch (error) {
        item.warning = redact(error.message);
      }
    }
    const info = await readInfo(item.domain);
    await saveDomain({ userId: order.userId, order, item, info, warning: item.warning });
    return item.warning && code === 302 ? "retry" : "done";
  }

  item.warning = redact(reply.detail || "Registration was not accepted");
  order.status = "action_required";
  return "failed";
}

async function handleRenew(order, item) {
  const owned = await Domain.findOne({ name: item.domain, userId: order.userId });
  if (!owned) {
    item.warning = "Domain is not on this account";
    order.status = "action_required";
    return "failed";
  }
  if (SUCCESS.has(item.namesiloCode)) return "done";
  const funds = await accountCanCover(item.costQuote);
  if (!funds.enough) {
    order.status = "awaiting_funds";
    return "wait";
  }
  const reply = assertOk(await namesilo("renewDomain", { domain: item.domain, years: item.years, auto_renew: 0 }));
  item.namesiloCode = Number(reply.code);
  item.namesiloDetail = redact(reply.detail || "");
  const info = await readInfo(item.domain);
  if (info?.expires) owned.expires = info.expires;
  await owned.save();
  return "done";
}

async function handleTransfer(order, item, contact) {
  const owned = await Domain.findOne({ name: item.domain });
  if (owned && String(owned.userId) !== String(order.userId)) {
    item.warning = "Domain is already linked to another customer";
    order.status = "action_required";
    return "failed";
  }

  if (item.namesiloCode === 300) {
    const statusReply = assertOk(await namesilo("checkTransferStatus", { domain: item.domain }));
    item.transferStatus = String(statusReply.status || "");
    const state = `${statusReply.status || ""} ${statusReply.message || ""}`;
    if (/reject|fail|cancel/i.test(state)) {
      item.warning = "Transfer was not accepted";
      order.status = "action_required";
      return "failed";
    }
    if (/complete|success/i.test(state) && !/pending/i.test(state)) {
      const info = await readInfo(item.domain);
      await saveDomain({ userId: order.userId, order, item, info });
      return "done";
    }
    return "retry";
  }

  const funds = await accountCanCover(item.costQuote);
  if (!funds.enough) {
    order.status = "awaiting_funds";
    return "wait";
  }
  const contactId = await ensureNamesiloContact(contact);
  const reply = await namesilo("transferDomain", {
    domain: item.domain,
    auth: item.eppCode,
    years: 1,
    private: 1,
    auto_renew: 0,
    contact_id: contactId,
  });
  const code = Number(reply.code);
  item.namesiloCode = code;
  item.namesiloDetail = redact(reply.detail || reply.message || "");
  item.eppCode = "";
  if (code !== 300) {
    item.warning = redact(reply.detail || "Transfer was not submitted");
    order.status = "action_required";
    return "failed";
  }
  item.transferStatus = "submitted";
  return "retry";
}

async function handleJob(job) {
  if (!env.registerEnabled) {
    job.status = "queued";
    job.lastError = "REGISTER_ENABLED is false";
    job.nextRetryAt = new Date(Date.now() + 60_000);
    await job.save();
    return;
  }

  const order = await Order.findById(job.orderId);
  if (!order || order.status === "cancelled" || order.status === "awaiting_payment") {
    job.status = "cancelled";
    await job.save();
    return;
  }

  const item = itemById(order, job.itemId);
  if (!item) {
    job.status = "failed";
    job.lastError = "Order item missing";
    await job.save();
    return;
  }

  order.status = order.status === "awaiting_funds" ? "awaiting_funds" : "registering";
  const contact = await Contact.findById(order.contactId);
  if (!contact) throw http(500, "Order contact is missing");

  let result = "done";
  if (item.action === "register") result = await handleRegister(order, item, contact);
  else if (item.action === "renew") result = await handleRenew(order, item);
  else result = await handleTransfer(order, item, contact);

  await refreshOrderStatus(order);

  if (result === "wait") {
    job.status = "queued";
    job.lastError = "Waiting for NameSilo account funds";
    job.nextRetryAt = new Date(Date.now() + 60_000);
  } else if (result === "retry") {
    job.status = "queued";
    job.lastError = "";
    job.nextRetryAt = new Date(Date.now() + 60_000);
  } else if (result === "failed") {
    job.status = "failed";
    job.lastError = redact(item.warning || "Registry call failed");
  } else {
    job.status = "done";
    job.lastError = "";
  }
  job.attempts += 1;
  await job.save();
}

let running = false;

async function processDueJobs() {
  if (running) return;
  running = true;
  try {
    const due = await Job.find({ status: "queued", nextRetryAt: { $lte: new Date() } }).limit(8);
    for (const job of due) {
      const claimed = await Job.findOneAndUpdate({ _id: job._id, status: "queued" }, { $set: { status: "running" } });
      if (!claimed) continue;
      try {
        await handleJob(claimed);
      } catch (error) {
        claimed.status = "queued";
        claimed.attempts += 1;
        claimed.lastError = redact(error.message || "Job failed").slice(0, 400);
        claimed.nextRetryAt = new Date(Date.now() + Math.min(claimed.attempts, 15) * 60_000);
        await claimed.save();
        if (claimed.attempts >= 5) {
          await Order.updateOne(
            { _id: claimed.orderId, status: { $nin: ["cancelled", "active", "awaiting_funds"] } },
            { status: "action_required" }
          );
        }
      }
    }
  } finally {
    running = false;
  }
}

function startWorker() {
  setInterval(() => {
    processDueJobs().catch((error) => {
      console.error(redact(error.message || "Worker failed"));
    });
  }, 60_000);
}

async function enqueueOrder(order) {
  for (const item of order.items) {
    await Job.updateOne(
      { orderId: order._id, itemId: item._id },
      {
        $setOnInsert: {
          orderId: order._id,
          itemId: item._id,
          action: item.action,
          status: "queued",
          attempts: 0,
          nextRetryAt: new Date(),
        },
      },
      { upsert: true }
    );
  }
  processDueJobs().catch((error) => console.error(redact(error.message || "Worker failed")));
}

module.exports = { processDueJobs, startWorker, enqueueOrder, readInfo };
