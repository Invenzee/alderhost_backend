const { env } = require("./config/env");
const { connectDb } = require("./db");
const { seed } = require("./seed");
const { createApp } = require("./app");
const { startWorker } = require("./jobs/worker");

async function main() {
  const connected = await connectDb();
  await seed();
  const app = createApp();
  const server = app.listen(env.port, "0.0.0.0");
  server.on("listening", () => {
    console.log(`Alderhost API listening on ${env.port}`);
  });
  server.on("error", (error) => {
    console.error(`API listen failed: ${error.message}`);
    process.exit(1);
  });
  if (connected) startWorker();
}

main().catch((error) => {
  const { redact } = require("./services/namesilo");
  const message = redact(error.message || "API failed to start").replace(/mongodb(\+srv)?:\/\/\S+/gi, "mongodb://[redacted]");
  console.error(message);
  process.exit(1);
});
