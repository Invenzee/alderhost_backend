const { z } = require("zod");
const Coupon = require("../models/Coupon");
const Contact = require("../models/Contact");
const Order = require("../models/Order");
const { money } = require("../lib/money");
const { http } = require("../lib/http");
const { getFx } = require("./pricing");
const { toCountryCode } = require("../lib/country");

const contactSchema = z.object({
  fn: z.string().trim().min(1).max(60),
  ln: z.string().trim().min(1).max(60),
  ad: z.string().trim().min(1).max(120),
  ad2: z.string().trim().max(120).optional().default(""),
  cy: z.string().trim().min(1).max(60),
  st: z.string().trim().min(1).max(40),
  zp: z.string().trim().min(1).max(20),
  ct: z.string().trim().length(2, "Country must be a 2-letter code, such as PK"),
  em: z.email(),
  ph: z.string().trim().min(1, "Enter a phone number").max(20),
  cp: z.string().trim().max(80).optional().default(""),
});

function parseContact(input) {
  const ct = toCountryCode(input?.ct);
  if (!ct) throw http(400, "Country must be a 2-letter code, such as PK. Pakistan is PK.");
  const contact = contactSchema.parse({ ...input, ct });
  const digits = contact.ph.replace(/\D/g, "");
  if (contact.ct === "US" || contact.ct === "CA") {
    if (!/^[A-Z]{2}$/.test(contact.st.toUpperCase())) {
      throw http(400, "Use a 2-letter state code for the US or Canada");
    }
    if (digits.length !== 10) throw http(400, "US and Canada phone numbers must be 10 digits, without a country code");
    contact.st = contact.st.toUpperCase();
  } else if (digits.length < 6 || digits.length > 15) {
    throw http(400, "Enter the phone number without a country calling code");
  }
  contact.ph = digits;
  contact.em = contact.em.toLowerCase();
  return contact;
}

async function findCoupon(code) {
  if (!code) return null;
  const coupon = await Coupon.findOne({ code: String(code).trim().toUpperCase() });
  if (!coupon || !coupon.active) throw http(400, "Coupon is not active");
  if (coupon.expiresAt && coupon.expiresAt.getTime() < Date.now()) throw http(400, "Coupon has expired");
  return coupon;
}

function applyCoupon(sell, cost, coupon) {
  if (!coupon) return { discount: 0, usdSell: money(sell) };
  const discount = coupon.type === "percent" ? money(sell * (coupon.amount / 100)) : money(coupon.amount);
  const usdSell = money(Math.max(0, sell - discount));
  if (usdSell < money(cost)) throw http(400, "This coupon drops the price below cost");
  return { discount: Math.min(discount, sell), usdSell };
}

function customerStatus(status) {
  if (status === "awaiting_payment") return "awaiting_payment";
  if (status === "cancelled") return "cancelled";
  if (status === "active") return "active";
  if (status === "action_required") return "needs_attention";
  return "processing";
}

function presentOrder(order, { admin = false } = {}) {
  return {
    id: String(order._id),
    status: admin ? order.status : customerStatus(order.status),
    customerStatus: customerStatus(order.status),
    usdSell: order.usdSell,
    usdCost: admin ? order.usdCost : undefined,
    margin: admin ? money(order.usdSell - order.usdCost) : undefined,
    discount: order.discount,
    fx: order.fx,
    pkr: order.pkr,
    couponCode: order.couponCode || "",
    warning: admin ? order.warning : "",
    createdAt: order.createdAt,
    items: order.items.map((item) => ({
      id: String(item._id),
      domain: item.domain,
      action: item.action,
      years: item.years,
      premium: item.premium,
      sellQuote: item.sellQuote,
      costQuote: admin ? item.costQuote : undefined,
      namesiloCode: admin ? item.namesiloCode : undefined,
      transferStatus: admin ? item.transferStatus : undefined,
      warning: admin ? item.warning : undefined,
    })),
  };
}

async function buildOrder({ userId, contactInput, quotes, couponCode, eppByDomain = {} }) {
  const contactData = parseContact(contactInput);
  const contact = await Contact.create({ userId, ...contactData });
  const cost = money(quotes.reduce((sum, quote) => sum + quote.cost, 0));
  const sellBefore = money(quotes.reduce((sum, quote) => sum + quote.sell, 0));
  const coupon = await findCoupon(couponCode);
  const { discount, usdSell } = applyCoupon(sellBefore, cost, coupon);
  const fx = await getFx();
  const order = await Order.create({
    userId,
    contactId: contact._id,
    status: "awaiting_payment",
    usdCost: cost,
    usdSell,
    discount,
    fx,
    pkr: money(usdSell * fx),
    couponCode: coupon?.code || "",
    items: quotes.map((quote) => ({
      domain: quote.domain,
      action: quote.action,
      years: quote.years,
      premium: quote.premium,
      costQuote: quote.cost,
      sellQuote: quote.sell,
      eppCode: eppByDomain[quote.domain] || "",
    })),
  });
  return order;
}

async function previewCoupon(code, sell, cost) {
  const coupon = await findCoupon(code);
  return applyCoupon(sell, cost, coupon);
}

module.exports = {
  parseContact,
  findCoupon,
  applyCoupon,
  presentOrder,
  buildOrder,
  previewCoupon,
  customerStatus,
};
