const jwt = require("jsonwebtoken");
const User = require("../models/User");
const { env } = require("../config/env");
const { http } = require("../lib/http");

const COOKIE = "alderhost_token";

function signUser(user) {
  return jwt.sign({ sub: String(user._id), role: user.role }, env.jwtSecret, { expiresIn: "7d" });
}

function setAuthCookie(res, user) {
  res.cookie(COOKIE, signUser(user), {
    httpOnly: true,
    sameSite: "lax",
    secure: env.nodeEnv === "production",
    path: "/",
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });
}

function clearAuthCookie(res) {
  res.clearCookie(COOKIE, { path: "/" });
}

async function requireUser(req, res, next) {
  try {
    const token = req.cookies[COOKIE];
    if (!token) throw http(401, "Sign in required");
    const payload = jwt.verify(token, env.jwtSecret);
    const user = await User.findById(payload.sub);
    if (!user) throw http(401, "Sign in required");
    req.user = user;
    next();
  } catch (error) {
    next(error.status ? error : http(401, "Sign in required"));
  }
}

function requireAdmin(req, res, next) {
  if (req.user?.role !== "admin") return next(http(403, "Admin only"));
  next();
}

function presentUser(user) {
  return { id: String(user._id), email: user.email, role: user.role };
}

module.exports = { requireUser, requireAdmin, setAuthCookie, clearAuthCookie, presentUser };
