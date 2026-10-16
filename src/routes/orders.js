const express = require("express");
const Order = require("../models/Order");
const Domain = require("../models/Domain");
const { asyncRoute, http } = require("../lib/http");
const { requireUser } = require("../middleware/auth");
const { quoteRegister, quoteRenew, quoteTransfer } = require("../services/pricing");
const { buildOrder, presentOrder, parseContact } = require("../services/orders");
const { enqueueOrder } = require("../jobs/worker");
const { env } = require("../config/env");

const router = express.Router();
router.use(requireUser);

async function markPaid(order, confirmation) {
  if (!env.registerEnabled) throw http(403, "Registration is disabled");
  if (order.status !== "awaiting_payment") throw http(400, "This order is not waiting for payment");
  const expected = order.items.map((item) => item.domain).join(", ");
  if (String(confirmation || "") !== expected) {
    throw http(400, "Type the domain names exactly to confirm");
  }
  order.status = "paid";
  await order.save();
  await enqueueOrder(order);
  return order;
}

router.post("/checkout", asyncRoute(async (req, res) => {
  const items = Array.isArray(req.body.items) ? req.body.items : [];
  if (items.length === 0) throw http(400, "Your cart is empty");
  if (items.length > 20) throw http(400, "Checkout supports up to 20 domains at a time");
  const quotes = [];
  for (const item of items) quotes.push(await quoteRegister(item.domain, item.years));
  const order = await buildOrder({
    userId: req.user._id,
    contactInput: req.body.contact,
    quotes,
    couponCode: req.body.couponCode,
  });
  res.status(201).json({ order: presentOrder(order) });
}));

router.post("/transfers", asyncRoute(async (req, res) => {
  const quote = await quoteTransfer(req.body.domain);
  const auth = String(req.body.auth || "").trim();
  if (auth.length < 4) throw http(400, "Enter the authorization code from the current registrar");
  parseContact(req.body.contact);
  const order = await buildOrder({
    userId: req.user._id,
    contactInput: req.body.contact,
    quotes: [quote],
    couponCode: req.body.couponCode,
    eppByDomain: { [quote.domain]: auth },
  });
  res.status(201).json({ order: presentOrder(order) });
}));

router.post("/domains/:domain/renew", asyncRoute(async (req, res) => {
  const name = String(req.params.domain).toLowerCase();
  const owned = await Domain.findOne({ name, userId: req.user._id });
  if (!owned) throw http(404, "Domain not found");
  const quote = await quoteRenew(name, req.body.years, owned.premium);
  const contact = req.body.contact;
  const order = await buildOrder({
    userId: req.user._id,
    contactInput: contact,
    quotes: [quote],
    couponCode: req.body.couponCode,
  });
  res.status(201).json({ order: presentOrder(order) });
}));

router.get("/orders", asyncRoute(async (req, res) => {
  const orders = await Order.find({ userId: req.user._id }).sort({ createdAt: -1 }).limit(50);
  res.json({ orders: orders.map((order) => presentOrder(order)) });
}));

router.get("/orders/:id", asyncRoute(async (req, res) => {
  const order = await Order.findOne({ _id: req.params.id, userId: req.user._id });
  if (!order) throw http(404, "Order not found");
  res.json({
    order: presentOrder(order),
    paymentsMode: env.paymentsMode,
    registerEnabled: env.registerEnabled,
    wholesaleUsd: env.paymentsMode === "test" ? order.usdCost : undefined,
    confirmation: order.items.map((item) => item.domain).join(", "),
  });
}));

router.post("/orders/:id/mark-paid", asyncRoute(async (req, res) => {
  if (env.paymentsMode !== "test") throw http(403, "Test payment is not enabled");
  const order = await Order.findOne({ _id: req.params.id, userId: req.user._id });
  if (!order) throw http(404, "Order not found");
  await markPaid(order, req.body.confirmation);
  res.json({ order: presentOrder(order) });
}));

router.post("/orders/:id/cancel", asyncRoute(async (req, res) => {
  const order = await Order.findOne({ _id: req.params.id, userId: req.user._id });
  if (!order) throw http(404, "Order not found");
  if (order.status !== "awaiting_payment") throw http(400, "Only unpaid orders can be cancelled here");
  order.status = "cancelled";
  await order.save();
  res.json({ order: presentOrder(order) });
}));

module.exports = router;
