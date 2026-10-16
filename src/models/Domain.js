const mongoose = require("mongoose");

const domainSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    name: { type: String, required: true, unique: true, lowercase: true },
    orderId: { type: mongoose.Schema.Types.ObjectId, ref: "Order" },
    contactId: { type: mongoose.Schema.Types.ObjectId, ref: "Contact" },
    expires: { type: String, default: "" },
    locked: { type: Boolean, default: true },
    privacy: { type: Boolean, default: true },
    premium: { type: Boolean, default: false },
    nameservers: { type: [String], default: [] },
    forwardUrl: { type: String, default: "" },
    forwardType: { type: String, default: "" },
    status: { type: String, default: "active" },
    warning: { type: String, default: "" },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Domain", domainSchema);
