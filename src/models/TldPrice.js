const mongoose = require("mongoose");

const tldPriceSchema = new mongoose.Schema(
  {
    tld: { type: String, required: true, unique: true },
    registration: { type: Number, default: 0 },
    transfer: { type: Number, default: 0 },
    renew: { type: Number, default: 0 },
    markupPercent: { type: Number, default: 25 },
    premiumMarkupPercent: { type: Number, default: 0 },
    fetchedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model("TldPrice", tldPriceSchema);
