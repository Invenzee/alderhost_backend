const Domain = require("../models/Domain");
const Contact = require("../models/Contact");
const { namesilo, assertOk, asArray } = require("./namesilo");
const { http } = require("../lib/http");
const { parseContact } = require("./orders");

const DNS_TYPES = new Set(["A", "AAAA", "CNAME", "MX", "TXT", "SRV", "CAA"]);

async function ownedDomain(userId, name) {
  const domain = await Domain.findOne({ name: String(name || "").toLowerCase(), userId });
  if (!domain) throw http(404, "Domain not found");
  return domain;
}

async function domainView(userId, name) {
  const domain = await ownedDomain(userId, name);
  let live = null;
  try {
    live = assertOk(await namesilo("getDomainInfo", { domain: domain.name }));
    domain.expires = live.expires || domain.expires;
    domain.locked = String(live.locked || "").toLowerCase() === "yes";
    domain.privacy = String(live.private || "").toLowerCase() === "yes";
    domain.nameservers = asArray(live.nameservers).map(String);
    domain.forwardUrl = live.forward_url || "";
    domain.forwardType = live.forward_type || "";
    await domain.save();
  } catch {
    live = null;
  }
  const contact = domain.contactId ? await Contact.findById(domain.contactId).lean() : null;
  return {
    domain: {
      name: domain.name,
      expires: domain.expires,
      locked: domain.locked,
      privacy: domain.privacy,
      premium: domain.premium,
      nameservers: domain.nameservers,
      forwardUrl: domain.forwardUrl,
      forwardType: domain.forwardType,
      status: domain.status,
      warning: domain.warning,
    },
    contact: contact
      ? {
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
        }
      : null,
    emailVerificationRequired: live ? String(live.email_verification_required || "") : "",
  };
}

async function listDns(userId, name) {
  const domain = await ownedDomain(userId, name);
  const reply = assertOk(await namesilo("dnsListRecords", { domain: domain.name }));
  return asArray(reply.resource_record).map((record) => ({
    id: record.record_id,
    type: record.type,
    host: record.host,
    value: record.value,
    ttl: Number(record.ttl) || 3600,
    distance: Number(record.distance) || 0,
  }));
}

function dnsParams(body) {
  const type = String(body.type || "").toUpperCase();
  if (!DNS_TYPES.has(type)) throw http(400, "Unsupported DNS record type");
  const host = String(body.host || "").trim();
  const value = String(body.value || "").trim();
  if (!host || !value) throw http(400, "Host and value are required");
  const ttl = Number(body.ttl || 3600);
  if (!Number.isFinite(ttl) || ttl < 300) throw http(400, "TTL must be at least 300 seconds");
  return {
    rrtype: type,
    rrhost: host,
    rrvalue: value,
    rrttl: ttl,
    rrdistance: body.distance == null ? undefined : Number(body.distance),
  };
}

async function addDns(userId, name, body) {
  const domain = await ownedDomain(userId, name);
  assertOk(await namesilo("dnsAddRecord", { domain: domain.name, ...dnsParams(body) }));
  return listDns(userId, name);
}

async function updateDns(userId, name, recordId, body) {
  const domain = await ownedDomain(userId, name);
  assertOk(await namesilo("dnsUpdateRecord", { domain: domain.name, rrid: recordId, ...dnsParams(body) }));
  return listDns(userId, name);
}

async function deleteDns(userId, name, recordId) {
  const domain = await ownedDomain(userId, name);
  assertOk(await namesilo("dnsDeleteRecord", { domain: domain.name, rrid: recordId }));
  return listDns(userId, name);
}

async function changeNameservers(userId, name, nameservers) {
  const domain = await ownedDomain(userId, name);
  const list = (nameservers || []).map((item) => String(item).trim()).filter(Boolean);
  if (list.length < 2 || list.length > 13) throw http(400, "Provide 2 to 13 nameservers");
  const params = { domain: domain.name };
  list.forEach((ns, index) => {
    params[`ns${index + 1}`] = ns;
  });
  assertOk(await namesilo("changeNameServers", params));
  domain.nameservers = list;
  await domain.save();
  return list;
}

async function listEmailForwards(userId, name) {
  const domain = await ownedDomain(userId, name);
  const reply = assertOk(await namesilo("listEmailForwards", { domain: domain.name }));
  return asArray(reply.addresses).map((row) => ({
    email: row.email,
    forwardsTo: asArray(row.forwards_to),
  }));
}

async function saveEmailForward(userId, name, body) {
  const domain = await ownedDomain(userId, name);
  const mailbox = String(body.email || "").trim().toLowerCase().split("@")[0];
  const forwards = asArray(body.forwards).map((item) => String(item).trim()).filter(Boolean).slice(0, 5);
  if (!mailbox || forwards.length === 0) throw http(400, "Enter a mailbox and at least one destination");
  const params = { domain: domain.name, email: mailbox };
  forwards.forEach((forward, index) => {
    params[`forward${index + 1}`] = forward;
  });
  assertOk(await namesilo("configureEmailForward", params));
  return listEmailForwards(userId, name);
}

async function deleteEmailForward(userId, name, email) {
  const domain = await ownedDomain(userId, name);
  const mailbox = String(email || "").trim().toLowerCase().split("@")[0];
  assertOk(await namesilo("deleteEmailForward", { domain: domain.name, email: mailbox }));
  return listEmailForwards(userId, name);
}

async function saveForward(userId, name, body) {
  const domain = await ownedDomain(userId, name);
  const protocol = body.protocol === "https" ? "https" : "http";
  const method = ["301", "302", "cloaked"].includes(body.method) ? body.method : "301";
  const address = String(body.address || "").trim();
  if (!address) throw http(400, "Destination address is required");
  const subDomain = String(body.subDomain || "").trim();
  if (subDomain) {
    assertOk(await namesilo("domainForwardSubDomain", { domain: domain.name, sub_domain: subDomain, protocol, address, method }));
  } else {
    assertOk(await namesilo("domainForward", { domain: domain.name, protocol, address, method }));
    domain.forwardUrl = `${protocol}://${address}`;
    domain.forwardType = method;
    await domain.save();
  }
  return { protocol, address, method, subDomain };
}

async function deleteForward(userId, name, subDomain) {
  const domain = await ownedDomain(userId, name);
  if (!subDomain) throw http(400, "Apex forwarding is replaced by saving a new destination. Enter a subdomain to delete.");
  assertOk(await namesilo("domainForwardSubDomainDelete", { domain: domain.name, sub_domain: subDomain }));
  return { deleted: subDomain };
}

async function updateContacts(userId, name, body) {
  const domain = await ownedDomain(userId, name);
  const parsed = parseContact(body);
  let contact = domain.contactId ? await Contact.findById(domain.contactId) : null;
  if (!contact) contact = new Contact({ userId, ...parsed });
  else Object.assign(contact, parsed);
  if (contact.namesiloContactId) {
    assertOk(await namesilo("contactUpdate", { contact_id: contact.namesiloContactId, ...parsed }));
  } else {
    const reply = assertOk(await namesilo("contactAdd", parsed));
    contact.namesiloContactId = String(reply.contact_id || "");
  }
  await contact.save();
  assertOk(
    await namesilo("contactDomainAssociate", {
      domain: domain.name,
      registrant: contact.namesiloContactId,
      administrative: contact.namesiloContactId,
      technical: contact.namesiloContactId,
      billing: contact.namesiloContactId,
    })
  );
  domain.contactId = contact._id;
  domain.warning = "";
  await domain.save();
  return domainView(userId, name);
}

async function setLock(userId, name, locked) {
  const domain = await ownedDomain(userId, name);
  assertOk(await namesilo(locked ? "domainLock" : "domainUnlock", { domain: domain.name }), [253]);
  domain.locked = Boolean(locked);
  await domain.save();
  return { locked: domain.locked };
}

async function setPrivacy(userId, name, enabled) {
  const domain = await ownedDomain(userId, name);
  assertOk(await namesilo(enabled ? "addPrivacy" : "removePrivacy", { domain: domain.name }));
  domain.privacy = Boolean(enabled);
  await domain.save();
  return { privacy: domain.privacy };
}

async function requestAuthCode(userId, name) {
  const domain = await ownedDomain(userId, name);
  assertOk(await namesilo("retrieveAuthCode", { domain: domain.name }));
  return {
    message: "NameSilo will email the authorization code to the administrative contact. It is not shown on this site.",
  };
}

async function whois(domain) {
  const name = String(domain || "").trim().toLowerCase();
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(name)) throw http(400, "Enter a valid domain");
  const reply = await namesilo("whois", { domain: name });
  const code = Number(reply.code);
  if (code !== 300) throw http(404, reply.detail || "WHOIS data is not available");
  const safe = { ...reply };
  delete safe.code;
  return { domain: name, whois: safe };
}

module.exports = {
  ownedDomain,
  domainView,
  listDns,
  addDns,
  updateDns,
  deleteDns,
  changeNameservers,
  listEmailForwards,
  saveEmailForward,
  deleteEmailForward,
  saveForward,
  deleteForward,
  updateContacts,
  setLock,
  setPrivacy,
  requestAuthCode,
  whois,
};
