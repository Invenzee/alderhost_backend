const express = require("express");
const Domain = require("../models/Domain");
const { asyncRoute } = require("../lib/http");
const { requireUser } = require("../middleware/auth");
const domains = require("../services/domains");

const router = express.Router();
router.use(requireUser);

router.get("/", asyncRoute(async (req, res) => {
  const list = await Domain.find({ userId: req.user._id }).sort({ name: 1 });
  res.json({
    domains: list.map((domain) => ({
      name: domain.name,
      expires: domain.expires,
      locked: domain.locked,
      privacy: domain.privacy,
      status: domain.status,
    })),
  });
}));

router.get("/:domain", asyncRoute(async (req, res) => {
  res.json(await domains.domainView(req.user._id, req.params.domain));
}));

router.get("/:domain/dns", asyncRoute(async (req, res) => {
  res.json({ records: await domains.listDns(req.user._id, req.params.domain) });
}));

router.post("/:domain/dns", asyncRoute(async (req, res) => {
  res.status(201).json({ records: await domains.addDns(req.user._id, req.params.domain, req.body) });
}));

router.patch("/:domain/dns/:recordId", asyncRoute(async (req, res) => {
  res.json({ records: await domains.updateDns(req.user._id, req.params.domain, req.params.recordId, req.body) });
}));

router.delete("/:domain/dns/:recordId", asyncRoute(async (req, res) => {
  res.json({ records: await domains.deleteDns(req.user._id, req.params.domain, req.params.recordId) });
}));

router.put("/:domain/nameservers", asyncRoute(async (req, res) => {
  res.json({ nameservers: await domains.changeNameservers(req.user._id, req.params.domain, req.body.nameservers) });
}));

router.get("/:domain/email-forwards", asyncRoute(async (req, res) => {
  res.json({ forwards: await domains.listEmailForwards(req.user._id, req.params.domain) });
}));

router.post("/:domain/email-forwards", asyncRoute(async (req, res) => {
  res.status(201).json({ forwards: await domains.saveEmailForward(req.user._id, req.params.domain, req.body) });
}));

router.delete("/:domain/email-forwards", asyncRoute(async (req, res) => {
  res.json({ forwards: await domains.deleteEmailForward(req.user._id, req.params.domain, req.query.email) });
}));

router.put("/:domain/forward", asyncRoute(async (req, res) => {
  res.json({ forward: await domains.saveForward(req.user._id, req.params.domain, req.body) });
}));

router.delete("/:domain/forward", asyncRoute(async (req, res) => {
  res.json(await domains.deleteForward(req.user._id, req.params.domain, req.query.subDomain));
}));

router.put("/:domain/contacts", asyncRoute(async (req, res) => {
  res.json(await domains.updateContacts(req.user._id, req.params.domain, req.body));
}));

router.post("/:domain/lock", asyncRoute(async (req, res) => {
  res.json(await domains.setLock(req.user._id, req.params.domain, Boolean(req.body.locked)));
}));

router.post("/:domain/privacy", asyncRoute(async (req, res) => {
  res.json(await domains.setPrivacy(req.user._id, req.params.domain, Boolean(req.body.enabled)));
}));

router.post("/:domain/auth-code", asyncRoute(async (req, res) => {
  res.json(await domains.requestAuthCode(req.user._id, req.params.domain));
}));

module.exports = router;
