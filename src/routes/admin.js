const express = require("express");
const Order = require("../models/Order");
const Job = require("../models/Job");
const TldPrice = require("../models/TldPrice");
const Coupon = require("../models/Coupon");
const { asyncRoute, http } = require("../lib/http");
const { requireUser, requireAdmin } = require("../middleware/auth");
const { namesilo, assertOk } = require("../services/namesilo");
const { adminPricing, refreshPrices, setFx, getFx } = require("../services/pricing");
const { presentOrder } = require("../services/orders");
const { enqueueOrder } = require("../jobs/worker");
const { env } = require("../config/env");
const { POPULAR_TLDS } = require("../config/tlds");
const { money } = require("../lib/money");

const router = express.Router();
router.use(requireUser, requireAdmin);

router.get("/summary", asyncRoute(async (req, res) => {
  const reply = assertOk(await namesilo("getAccountBalance"));
  const balance = Number(reply.balance);
  const awaiting = await Order.countDocuments({ status: "awaiting_funds" });
  res.json({ balance, lowBalance: balance < 20 || awaiting > 0, awaitingFunds: awaiting, fx: await getFx() });
}));

router.get("/orders", asyncRoute(async (req, res) => {
  const orders = await Order.find().sort({ createdAt: -1 }).limit(100);
  res.json({ orders: orders.map((order) => presentOrder(order, { admin: true })) });
}));

router.post("/orders/:id/mark-paid", asyncRoute(async (req, res) => {
  if (!env.registerEnabled) throw http(403, "Registration is disabled");
  const order = await Order.findById(req.params.id);
  if (!order) throw http(404, "Order not found");
  if (order.status !== "awaiting_payment") throw http(400, "This order is not waiting for payment");
  const expected = order.items.map((item) => item.domain).join(", ");
  if (String(req.body.confirmation || "") !== expected) throw http(400, "Type the domain names exactly to confirm");
  order.status = "paid";
  await order.save();
  await enqueueOrder(order);
  res.json({ order: presentOrder(order, { admin: true }) });
}));

router.post("/orders/:id/cancel", asyncRoute(async (req, res) => {
  const order = await Order.findById(req.params.id);
  if (!order) throw http(404, "Order not found");
  if (order.items.some((item) => [300, 301, 302].includes(item.namesiloCode))) {
    throw http(400, "This order already reached the registry and cannot be cancelled");
  }
  if (order.status === "active") throw http(400, "Active orders cannot be cancelled");
  order.status = "cancelled";
  await order.save();
  await Job.updateMany({ orderId: order._id, status: { $in: ["queued", "running"] } }, { status: "cancelled" });
  res.json({ order: presentOrder(order, { admin: true }) });
}));

router.post("/orders/:id/retry", asyncRoute(async (req, res) => {
  const order = await Order.findById(req.params.id);
  if (!order) throw http(404, "Order not found");
  if (["cancelled", "awaiting_payment", "active"].includes(order.status)) {
    throw http(400, "This order cannot be retried");
  }
  await Job.updateMany(
    { orderId: order._id, status: { $in: ["failed", "queued"] } },
    { status: "queued", nextRetryAt: new Date(), lastError: "" }
  );
  const { processDueJobs } = require("../jobs/worker");
  processDueJobs().catch(() => {});
  res.json({ order: presentOrder(order, { admin: true }) });
}));

router.get("/pricing", asyncRoute(async (req, res) => {
  res.json({ tlds: await adminPricing(), fx: await getFx() });
}));

router.post("/pricing/refresh", asyncRoute(async (req, res) => {
  await refreshPrices();
  res.json({ tlds: await adminPricing() });
}));

router.put("/pricing/:tld", asyncRoute(async (req, res) => {
  const tld = String(req.params.tld).toLowerCase();
  if (!POPULAR_TLDS.includes(tld)) throw http(400, "That extension is not offered");
  const markupPercent = Number(req.body.markupPercent);
  const premiumMarkupPercent = Number(req.body.premiumMarkupPercent);
  if (!Number.isFinite(markupPercent) || markupPercent < 0 || markupPercent > 500) {
    throw http(400, "Markup must be between 0 and 500");
  }
  if (!Number.isFinite(premiumMarkupPercent) || premiumMarkupPercent < 0 || premiumMarkupPercent > 500) {
    throw http(400, "Premium markup must be between 0 and 500");
  }
  const row = await TldPrice.findOneAndUpdate(
    { tld },
    { markupPercent, premiumMarkupPercent },
    { new: true }
  );
  res.json({ tld: row });
}));

router.put("/fx", asyncRoute(async (req, res) => {
  res.json({ fx: await setFx(req.body.usdToPkr) });
}));

router.get("/coupons", asyncRoute(async (req, res) => {
  const coupons = await Coupon.find().sort({ createdAt: -1 });
  res.json({ coupons });
}));

router.post("/coupons", asyncRoute(async (req, res) => {
  const code = String(req.body.code || "").trim().toUpperCase();
  const type = req.body.type === "fixed" ? "fixed" : "percent";
  const amount = money(req.body.amount);
  if (!/^[A-Z0-9-]{3,20}$/.test(code)) throw http(400, "Use 3 to 20 letters or numbers for the code");
  if (amount <= 0) throw http(400, "Coupon amount must be greater than zero");
  if (type === "percent" && amount > 100) throw http(400, "Percent coupons cannot exceed 100");
  const coupon = await Coupon.create({
    code,
    type,
    amount,
    active: req.body.active !== false,
    expiresAt: req.body.expiresAt ? new Date(req.body.expiresAt) : null,
  });
  res.status(201).json({ coupon });
}));

router.patch("/coupons/:id", asyncRoute(async (req, res) => {
  const coupon = await Coupon.findById(req.params.id);
  if (!coupon) throw http(404, "Coupon not found");
  if (typeof req.body.active === "boolean") coupon.active = req.body.active;
  await coupon.save();
  res.json({ coupon });
}));

module.exports = router;
