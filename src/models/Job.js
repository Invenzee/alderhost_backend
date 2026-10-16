const mongoose = require("mongoose");

const jobSchema = new mongoose.Schema(
  {
    orderId: { type: mongoose.Schema.Types.ObjectId, ref: "Order", required: true, index: true },
    itemId: { type: mongoose.Schema.Types.ObjectId, required: true },
    action: { type: String, required: true },
    status: { type: String, enum: ["queued", "running", "done", "failed", "cancelled"], default: "queued" },
    attempts: { type: Number, default: 0 },
    nextRetryAt: { type: Date, default: () => new Date(), index: true },
    lastError: { type: String, default: "" },
  },
  { timestamps: true }
);

jobSchema.index({ orderId: 1, itemId: 1 }, { unique: true });

module.exports = mongoose.model("Job", jobSchema);
