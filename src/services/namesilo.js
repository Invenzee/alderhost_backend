const { env } = require("../config/env");
const { http } = require("../lib/http");
const { asArray } = require("../lib/money");

function redact(value) {
  let text = String(value ?? "");
  if (env.namesiloApiKey) {
    text = text.split(env.namesiloApiKey).join("[redacted]");
  }
  return text
    .replace(/key=[^&\s]+/gi, "key=[redacted]")
    .replace(/auth=[^&\s]+/gi, "auth=[redacted]")
    .replace(/epp[^:\s]*[:=]\s*\S+/gi, "epp=[redacted]");
}

function replyOf(data) {
  if (data && data.reply && typeof data.reply === "object") return data.reply;
  return data || {};
}

async function namesilo(operation, params = {}) {
  const url = new URL(`https://www.namesilo.com/api/${operation}`);
  url.searchParams.set("version", "1");
  url.searchParams.set("type", "json");
  url.searchParams.set("key", env.namesiloApiKey);
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    url.searchParams.set(key, String(value));
  }

  let response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(25000) });
  } catch {
    throw http(502, `NameSilo ${operation} could not be reached`);
  }

  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw http(502, `NameSilo ${operation} returned an unreadable response`);
  }

  return replyOf(data);
}

function assertOk(reply, extraOk = []) {
  const code = Number(reply.code);
  const detail = String(reply.detail || reply.message || "NameSilo request failed");
  if (code === 300 || extraOk.includes(code) || /already/i.test(detail)) return reply;
  throw http(400, redact(detail));
}

function classifyAvailability(reply) {
  const available = asArray(reply.available?.domain ?? reply.available);
  const unavailable = asArray(reply.unavailable?.domain ?? reply.unavailable);
  const invalid = asArray(reply.invalid?.domain ?? reply.invalid);
  const map = new Map();

  for (const item of available) {
    if (typeof item === "string") {
      map.set(item.toLowerCase(), { status: "available", price: null, premium: false, duration: 1 });
      continue;
    }
    const domain = String(item.domain || "").toLowerCase();
    const premium = Number(item.premium) === 1;
    map.set(domain, {
      status: premium ? "premium" : "available",
      price: item.price == null ? null : Number(item.price),
      premium,
      duration: Number(item.duration) || 1,
    });
  }

  for (const item of unavailable) {
    const domain = String(typeof item === "string" ? item : item.domain || "").toLowerCase();
    if (domain) map.set(domain, { status: "unavailable", price: null, premium: false, duration: 1 });
  }

  for (const item of invalid) {
    const domain = String(typeof item === "string" ? item : item.domain || "").toLowerCase();
    if (domain) map.set(domain, { status: "invalid", price: null, premium: false, duration: 1 });
  }

  return map;
}

module.exports = { namesilo, assertOk, redact, classifyAvailability, asArray };
