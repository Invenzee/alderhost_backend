const express = require("express");
const cors = require("cors");
const { env, missing } = require("./config/env");
const { connectDb } = require("./db");
const { seed } = require("./seed");
const { createApp } = require("./app");
const { startWorker } = require("./jobs/worker");

function listen(app) {
  const ports = [...new Set([env.port, 3000, 4000].filter((port) => Number.isInteger(port) && port > 0))];
  for (const port of ports) {
    const server = app.listen(port, "0.0.0.0");
    server.on("listening", () => {
      console.log(`Alderhost API listening on ${port}`);
    });
    server.on("error", (error) => {
      if (error.code === "EADDRINUSE") {
        console.error(`Port ${port} is already in use`);
        return;
      }
      console.error(`API listen failed: ${error.message}`);
      process.exit(1);
    });
  }
}

async function main() {
  if (missing.length) {
    const message = `Missing required environment variable ${missing.join(", ")}`;
    console.error(message);
    const app = express();
    app.use(cors({ origin: env.frontendOrigin, credentials: true }));
    app.use((req, res) => {
      res.status(500).json({ error: message });
    });
    listen(app);
    return;
  }

  const app = createApp();
  listen(app);
  const connected = await connectDb();
  await seed();
  if (connected) startWorker();
}

main().catch((error) => {
  const { redact } = require("./services/namesilo");
  const message = redact(error.message || "API failed to start").replace(/mongodb(\+srv)?:\/\/\S+/gi, "mongodb://[redacted]");
  console.error(message);
  process.exit(1);
});
