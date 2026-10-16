const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const cookieParser = require("cookie-parser");
const { ZodError } = require("zod");
const { env } = require("./config/env");
const { mongoConnected } = require("./db");
const { redact } = require("./services/namesilo");
const publicRoutes = require("./routes/public");
const authRoutes = require("./routes/auth");
const orderRoutes = require("./routes/orders");
const manageRoutes = require("./routes/manage");
const adminRoutes = require("./routes/admin");

function createApp() {
  const app = express();
  app.set("trust proxy", 1);
  app.use(helmet());
  app.use(cors({ origin: env.frontendOrigin, credentials: true }));
  app.use(express.json({ limit: "1mb" }));
  app.use(cookieParser());

  app.get("/api/health", (req, res) => {
    res.json({ ok: true, mongo: mongoConnected() });
  });
  app.use("/api", publicRoutes);
  app.use("/api/auth", authRoutes);
  app.use("/api", orderRoutes);
  app.use("/api/domains", manageRoutes);
  app.use("/api/admin", adminRoutes);

  app.use((error, req, res, next) => {
    if (error instanceof ZodError) {
      const message = error.issues?.[0]?.message || "Check the form and try again";
      return res.status(400).json({ error: message });
    }
    const status = error.status || 500;
    const message = redact(error.message || "Something went wrong");
    if (status >= 500) console.error(message);
    if (res.headersSent) return next(error);
    res.status(status).json({ error: status >= 500 ? "Something went wrong" : message });
  });

  return app;
}

module.exports = { createApp };
