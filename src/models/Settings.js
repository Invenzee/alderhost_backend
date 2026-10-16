const mongoose = require("mongoose");

const settingsSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true },
    usdToPkr: { type: Number, default: 280 },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Settings", settingsSchema);
