const express = require("express");
const rateLimit = require("express-rate-limit");
const { asyncRoute } = require("../lib/http");
const { searchDomains, publicPricing, quoteRegister, getFx } = require("../services/pricing");
const { whois } = require("../services/domains");
const { applyCoupon, findCoupon } = require("../services/orders");
const { money } = require("../lib/money");
const { env } = require("../config/env");

const router = express.Router();

const searchLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many searches. Wait a minute and try again." },
});

router.get("/config", asyncRoute(async (req, res) => {
  res.json({
    paymentsMode: env.paymentsMode,
    registerEnabled: env.registerEnabled,
    fx: await getFx(),
  });
}));

router.get("/pricing", asyncRoute(async (req, res) => {
  res.json(await publicPricing());
}));

router.get("/domains/search", searchLimiter, asyncRoute(async (req, res) => {
  res.json(await searchDomains(req.query.q || ""));
}));

router.get("/domains/whois", searchLimiter, asyncRoute(async (req, res) => {
  res.json(await whois(req.query.domain || ""));
}));

router.post("/coupons/preview", searchLimiter, asyncRoute(async (req, res) => {
  const items = Array.isArray(req.body.items) ? req.body.items : [];
  if (items.length === 0) {
    return res.status(400).json({ error: "Add at least one domain" });
  }
  const quotes = [];
  for (const item of items) quotes.push(await quoteRegister(item.domain, item.years));
  const cost = money(quotes.reduce((sum, quote) => sum + quote.cost, 0));
  const sell = money(quotes.reduce((sum, quote) => sum + quote.sell, 0));
  const coupon = req.body.couponCode ? await findCoupon(req.body.couponCode) : null;
  const priced = applyCoupon(sell, cost, coupon);
  const fx = await getFx();
  res.json({
    fx,
    usdSell: priced.usdSell,
    discount: priced.discount,
    pkr: money(priced.usdSell * fx),
    items: quotes.map((quote) => ({
      domain: quote.domain,
      years: quote.years,
      premium: quote.premium,
      sell: quote.sell,
    })),
  });
}));

module.exports = router;
