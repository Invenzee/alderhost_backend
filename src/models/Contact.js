const mongoose = require("mongoose");

const contactSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    namesiloContactId: { type: String, default: "" },
    fn: { type: String, required: true },
    ln: { type: String, required: true },
    ad: { type: String, required: true },
    ad2: { type: String, default: "" },
    cy: { type: String, required: true },
    st: { type: String, required: true },
    zp: { type: String, required: true },
    ct: { type: String, required: true },
    em: { type: String, required: true },
    ph: { type: String, required: true },
    cp: { type: String, default: "" },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Contact", contactSchema);
