const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../../.env") });

const missing = [];

function required(name) {
  const value = process.env[name];
  if (!value || !String(value).trim()) {
    missing.push(name);
    return "";
  }
  return String(value).trim();
}

const env = {
  namesiloApiKey: required("NAMESILO_API_KEY"),
  mongoUri: process.env.MONGODB_URI?.trim() || "",
  jwtSecret: required("JWT_SECRET"),
  adminEmail: required("ADMIN_EMAIL").toLowerCase(),
  adminPassword: required("ADMIN_PASSWORD"),
  frontendOrigin: process.env.FRONTEND_ORIGIN?.trim() || "http://localhost:3000",
  paymentsMode: process.env.PAYMENTS_MODE?.trim() || "test",
  registerEnabled: process.env.REGISTER_ENABLED?.trim() === "true",
  port: Number(process.env.PORT || 4000),
  nodeEnv: process.env.NODE_ENV || "development",
};

module.exports = { env, missing };
