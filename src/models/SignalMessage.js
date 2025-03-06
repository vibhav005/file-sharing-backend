// models/SignalMessage.js

const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const SignalMessageSchema = new Schema({
  transferId: {
    type: Schema.Types.ObjectId,
    ref: "file",
    required: true,
  },
  sender: {
    type: Schema.Types.ObjectId,
    ref: "user",
    required: true,
  },
  recipient: {
    type: Schema.Types.ObjectId,
    ref: "user",
    required: true,
  },
  type: {
    type: String,
    enum: ["offer", "answer", "ice-candidate"],
    required: true,
  },
  sdp: {
    type: Object,
    default: null,
  },
  candidate: {
    type: Object,
    default: null,
  },
  timestamp: {
    type: Date,
    default: Date.now,
  },
  // Optional: Add an expiry field to automatically delete old signals
  expiresAt: {
    type: Date,
    default: function () {
      return new Date(Date.now() + 60 * 60 * 1000); // 1 hour expiry
    },
  },
});

// Create an index that expires documents based on expiresAt field
SignalMessageSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model("signalMessage", SignalMessageSchema);
