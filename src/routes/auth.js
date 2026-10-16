const bcrypt = require("bcryptjs");
const { z } = require("zod");
const express = require("express");
const User = require("../models/User");
const { asyncRoute, http } = require("../lib/http");
const { requireUser, setAuthCookie, clearAuthCookie, presentUser } = require("../middleware/auth");

const router = express.Router();

const credentials = z.object({
  email: z.email(),
  password: z.string().min(8).max(100),
});

router.post(
  "/register",
  asyncRoute(async (req, res) => {
    const { email, password } = credentials.parse(req.body);
    const existing = await User.findOne({ email: email.toLowerCase() });
    if (existing) throw http(409, "An account with that email already exists");
    const user = await User.create({
      email: email.toLowerCase(),
      passwordHash: await bcrypt.hash(password, 12),
      role: "customer",
    });
    setAuthCookie(res, user);
    res.status(201).json({ user: presentUser(user) });
  })
);

router.post(
  "/login",
  asyncRoute(async (req, res) => {
    const { email, password } = credentials.parse(req.body);
    const user = await User.findOne({ email: email.toLowerCase() }).select("+passwordHash");
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      throw http(401, "Email or password is incorrect");
    }
    setAuthCookie(res, user);
    res.json({ user: presentUser(user) });
  })
);

router.post("/logout", (req, res) => {
  clearAuthCookie(res);
  res.json({ ok: true });
});

router.get(
  "/me",
  asyncRoute(async (req, res) => {
    const token = req.cookies.alderhost_token;
    if (!token) return res.json({ user: null });
    try {
      await requireUser(req, res, () => {});
    } catch {
      return res.json({ user: null });
    }
    if (!req.user) return res.json({ user: null });
    res.json({ user: presentUser(req.user) });
  })
);

module.exports = router;
