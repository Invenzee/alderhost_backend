const bcrypt = require("bcryptjs");
const User = require("./models/User");
const { env } = require("./config/env");
const { mongoConnected } = require("./db");
const { ensureCatalog, refreshPrices } = require("./services/pricing");
const { redact } = require("./services/namesilo");

async function seed() {
  await ensureCatalog();
  if (mongoConnected()) {
    const existing = await User.findOne({ email: env.adminEmail });
    if (!existing) {
      await User.create({
        email: env.adminEmail,
        passwordHash: await bcrypt.hash(env.adminPassword, 12),
        role: "admin",
      });
      console.log("Seeded admin user");
    }
  }
  try {
    await refreshPrices();
    console.log("Loaded NameSilo prices");
  } catch (error) {
    console.error(redact(error.message || "Price refresh failed"));
  }
}

module.exports = { seed };
