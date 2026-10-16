const mongoose = require("mongoose");

const orderItemSchema = new mongoose.Schema({
  domain: { type: String, required: true },
  action: { type: String, enum: ["register", "renew", "transfer"], required: true },
  years: { type: Number, required: true },
  premium: { type: Boolean, default: false },
  costQuote: { type: Number, required: true },
  sellQuote: { type: Number, required: true },
  eppCode: { type: String, default: "" },
  namesiloCode: { type: Number, default: null },
  namesiloDetail: { type: String, default: "" },
  transferStatus: { type: String, default: "" },
  warning: { type: String, default: "" },
});

const orderSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    contactId: { type: mongoose.Schema.Types.ObjectId, ref: "Contact", required: true },
    status: {
      type: String,
      enum: ["awaiting_payment", "paid", "registering", "awaiting_funds", "active", "action_required", "cancelled"],
      default: "awaiting_payment",
    },
    usdCost: { type: Number, required: true },
    usdSell: { type: Number, required: true },
    discount: { type: Number, default: 0 },
    fx: { type: Number, required: true },
    pkr: { type: Number, required: true },
    couponCode: { type: String, default: "" },
    warning: { type: String, default: "" },
    items: { type: [orderItemSchema], required: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Order", orderSchema);
