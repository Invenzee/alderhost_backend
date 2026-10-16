const mongoose = require("mongoose");
const { env } = require("./config/env");

function mongoConnected() {
  return mongoose.connection.readyState === 1;
}

async function connectDb() {
  const uri = env.mongoUri;
  if (!uri || !/^mongodb(\+srv)?:\/\//.test(uri)) {
    if (uri) console.log("MONGODB_URI is not a Mongo connection string, so the database is skipped.");
    return false;
  }
  mongoose.set("strictQuery", true);
  try {
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
    console.log(`MongoDB connected (${mongoose.connection.name})`);
  } catch (error) {
    const { redact } = require("./services/namesilo");
    console.error(redact(error.message || "MongoDB connection failed"));
    console.log("Search still runs without the database.");
    return false;
  }
  return true;
}

module.exports = { connectDb, mongoConnected };
