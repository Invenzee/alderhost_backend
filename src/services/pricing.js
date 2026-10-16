const mongoose = require("mongoose");
const TldPrice = require("../models/TldPrice");
const Settings = require("../models/Settings");
const { POPULAR_TLDS } = require("../config/tlds");
const { namesilo, assertOk, classifyAvailability } = require("./namesilo");
const { money } = require("../lib/money");
const { http } = require("../lib/http");

const searchCache = new Map();
const SEARCH_TTL_MS = 45_000;
const memoryTlds = new Map();
let memoryFx = 280;

function usingDb() {
  return mongoose.connection.readyState === 1;
}

function blankTld(tld) {
  return { tld, registration: 0, transfer: 0, renew: 0, markupPercent: 25, premiumMarkupPercent: 0, fetchedAt: null };
}

async function ensureCatalog() {
  if (!usingDb()) {
    for (const tld of POPULAR_TLDS) {
      if (!memoryTlds.has(tld)) memoryTlds.set(tld, blankTld(tld));
    }
    return;
  }
  await Settings.updateOne({ key: "fx" }, { $setOnInsert: { key: "fx", usdToPkr: 280 } }, { upsert: true });
  for (const tld of POPULAR_TLDS) {
    await TldPrice.updateOne(
      { tld },
      { $setOnInsert: { tld, markupPercent: 25, premiumMarkupPercent: 0, registration: 0, transfer: 0, renew: 0 } },
      { upsert: true }
    );
  }
}

async function getFx() {
  if (!usingDb()) return memoryFx;
  const settings = await Settings.findOne({ key: "fx" });
  return settings?.usdToPkr || 280;
}

async function setFx(usdToPkr) {
  const rate = money(usdToPkr);
  if (rate <= 0) throw http(400, "Exchange rate must be greater than zero");
  if (!usingDb()) {
    memoryFx = rate;
    return rate;
  }
  await Settings.updateOne({ key: "fx" }, { key: "fx", usdToPkr: rate }, { upsert: true });
  return rate;
}

async function getTld(tld) {
  if (!usingDb()) return memoryTlds.get(tld) || null;
  return TldPrice.findOne({ tld }).lean();
}

async function tldMap() {
  if (!usingDb()) return memoryTlds;
  const rows = await TldPrice.find({ tld: { $in: POPULAR_TLDS } }).lean();
  return new Map(rows.map((row) => [row.tld, row]));
}

function tldOf(domain) {
  return String(domain).toLowerCase().split(".").pop();
}

function markedUp(cost, percent) {
  return money(Number(cost) * (1 + Number(percent) / 100));
}

async function refreshPrices() {
  const reply = assertOk(await namesilo("getPrices"));
  const now = new Date();
  for (const tld of POPULAR_TLDS) {
    const row = reply[tld];
    if (!row) continue;
    const prices = {
      registration: Number(row.registration) || 0,
      transfer: Number(row.transfer) || 0,
      renew: Number(row.renew) || 0,
      fetchedAt: now,
    };
    if (!usingDb()) {
      memoryTlds.set(tld, { ...(memoryTlds.get(tld) || blankTld(tld)), ...prices });
      continue;
    }
    await TldPrice.updateOne({ tld }, { $set: prices });
  }
  return publicPricing();
}

function normalizeLabel(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .split("/")[0]
    .replace(/\s+/g, "");
}

function domainsForQuery(raw) {
  const query = normalizeLabel(raw);
  if (!query) throw http(400, "Enter a domain name");
  const labelPattern = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

  if (query.includes(".")) {
    const parts = query.split(".");
    const tld = parts.pop();
    const label = parts.join(".");
    if (!POPULAR_TLDS.includes(tld)) throw http(400, "That extension is not offered");
    if (!labelPattern.test(label)) throw http(400, "Use letters, numbers, and hyphens");
    const exact = `${label}.${tld}`;
    const rest = POPULAR_TLDS.filter((item) => item !== tld).map((item) => `${label}.${item}`);
    return [exact, ...rest];
  }

  if (!labelPattern.test(query)) throw http(400, "Use letters, numbers, and hyphens");
  return POPULAR_TLDS.map((tld) => `${query}.${tld}`);
}

async function checkLive(domains) {
  const reply = assertOk(await namesilo("checkRegisterAvailability", { domains: domains.join(",") }));
  return classifyAvailability(reply);
}

function priceResult(domain, live, tldRow) {
  const base = { domain, premium: Boolean(live?.premium), duration: live?.duration || 1 };
  if (!live || live.status === "unavailable") {
    return { ...base, status: "unavailable", purchasable: false, sellYear1: null, sellExtraYear: null };
  }
  if (live.status === "invalid") {
    return { ...base, status: "invalid", purchasable: false, sellYear1: null, sellExtraYear: null };
  }

  if (live.premium) {
    if (!Number.isFinite(live.price)) {
      return { ...base, status: "premium", purchasable: false, sellYear1: null, sellExtraYear: null, sellBundle: null };
    }
    const duration = live.duration || 1;
    const sellBundle = markedUp(live.price, tldRow?.premiumMarkupPercent || 0);
    const sellExtraYear = markedUp(tldRow?.renew || 0, tldRow?.premiumMarkupPercent || 0);
    return {
      ...base,
      duration,
      status: "premium",
      purchasable: true,
      sellBundle,
      sellYear1: sellBundle,
      sellExtraYear,
    };
  }

  if (!tldRow?.registration) {
    return { ...base, status: "available", purchasable: false, sellYear1: null, sellExtraYear: null };
  }

  return {
    ...base,
    status: "available",
    purchasable: true,
    sellYear1: markedUp(tldRow.registration, tldRow.markupPercent),
    sellExtraYear: markedUp(tldRow.renew || tldRow.registration, tldRow.markupPercent),
  };
}

async function searchDomains(raw) {
  const domains = domainsForQuery(raw);
  const key = domains.slice().sort().join(",");
  const hit = searchCache.get(key);
  if (hit && hit.expires > Date.now()) return hit.value;

  const [liveMap, rows, fx] = await Promise.all([checkLive(domains), tldMap(), getFx()]);
  const results = domains.map((domain) => priceResult(domain, liveMap.get(domain), rows.get(tldOf(domain))));
  const value = { query: normalizeLabel(raw), fx, results };
  searchCache.set(key, { expires: Date.now() + SEARCH_TTL_MS, value });
  return value;
}

async function quoteRegister(domain, years) {
  const name = normalizeLabel(domain);
  const tld = tldOf(name);
  const row = await getTld(tld);
  if (!row) throw http(400, "That extension is not offered");
  const liveMap = await checkLive([name]);
  const live = liveMap.get(name);
  if (!live || live.status === "unavailable") throw http(400, `${name} is not available`);
  if (live.status === "invalid") throw http(400, `${name} is not a valid domain`);

  const safeYears = Number(years);
  if (!Number.isInteger(safeYears) || safeYears < 1 || safeYears > 10) {
    throw http(400, "Years must be from 1 to 10");
  }

  if (live.premium) {
    if (!Number.isFinite(live.price)) throw http(400, `No live quote for ${name}`);
    const duration = live.duration || 1;
    const extraYears = Math.max(0, safeYears - duration);
    const cost = money(live.price + (row.renew || 0) * extraYears);
    const sell = money(
      markedUp(live.price, row.premiumMarkupPercent) + markedUp(row.renew || 0, row.premiumMarkupPercent) * extraYears
    );
    return { domain: name, years: safeYears, premium: true, cost, sell, action: "register" };
  }

  if (!row.registration) throw http(400, "Wholesale prices are not loaded yet");
  const cost = money(row.registration + (row.renew || row.registration) * (safeYears - 1));
  const sell = money(
    markedUp(row.registration, row.markupPercent) + markedUp(row.renew || row.registration, row.markupPercent) * (safeYears - 1)
  );
  return { domain: name, years: safeYears, premium: false, cost, sell, action: "register" };
}

async function quoteRenew(domainName, years, premium) {
  const row = await getTld(tldOf(domainName));
  if (!row?.renew) throw http(400, "Renewal prices are not loaded yet");
  const safeYears = Number(years);
  if (!Number.isInteger(safeYears) || safeYears < 1 || safeYears > 10) {
    throw http(400, "Years must be from 1 to 10");
  }
  const markup = premium ? row.premiumMarkupPercent : row.markupPercent;
  const cost = money(row.renew * safeYears);
  const sell = money(markedUp(row.renew, markup) * safeYears);
  return { domain: domainName, years: safeYears, premium: Boolean(premium), cost, sell, action: "renew" };
}

async function quoteTransfer(domain) {
  const name = normalizeLabel(domain);
  const tld = tldOf(name);
  if (!POPULAR_TLDS.includes(tld)) throw http(400, "That extension is not offered");
  const row = await getTld(tld);
  if (!row?.transfer) throw http(400, "Transfer prices are not loaded yet");
  const reply = assertOk(await namesilo("checkTransferAvailability", { domains: name }));
  const unavailable = JSON.stringify(reply.unavailable || "").toLowerCase();
  const invalid = JSON.stringify(reply.invalid || "").toLowerCase();
  if (unavailable.includes(name) || invalid.includes(name)) {
    throw http(400, `${name} cannot be transferred`);
  }
  return {
    domain: name,
    years: 1,
    premium: false,
    cost: money(row.transfer),
    sell: markedUp(row.transfer, row.markupPercent),
    action: "transfer",
  };
}

async function publicPricing() {
  const [rows, fx] = await Promise.all([tldMap(), getFx()]);
  const byTld = rows;
  return {
    fx,
    tlds: POPULAR_TLDS.map((tld) => {
      const row = byTld.get(tld);
      return {
        tld,
        sellRegistration: row?.registration ? markedUp(row.registration, row.markupPercent) : null,
        sellRenew: row?.renew ? markedUp(row.renew, row.markupPercent) : null,
        sellTransfer: row?.transfer ? markedUp(row.transfer, row.markupPercent) : null,
      };
    }),
  };
}

async function adminPricing() {
  const byTld = await tldMap();
  return POPULAR_TLDS.map((tld) => byTld.get(tld)).filter(Boolean);
}

module.exports = {
  ensureCatalog,
  getFx,
  setFx,
  refreshPrices,
  searchDomains,
  quoteRegister,
  quoteRenew,
  quoteTransfer,
  publicPricing,
  adminPricing,
  tldOf,
};
