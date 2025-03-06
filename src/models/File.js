// models/File.js
const mongoose = require("mongoose");

const FileSchema = new mongoose.Schema({
  fileName: {
    type: String,
    required: true,
  },
  fileSize: {
    type: Number,
    required: true,
  },
  fileType: {
    type: String,
    required: true,
  },
  uploadedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  recipient: {
    type: String,
    ref: "User",
    required: true,
  },
  downloadUrl: {
    type: String,
  },
  transferMethod: {
    type: String,
    enum: ["P2P", "CLOUD"],
    required: true,
  },
  status: {
    type: String,
    enum: [
      "PENDING",
      "TRANSFERRING",
      "COMPLETED",
      "FAILED",
      "CANCELLED",
      "ACCEPTED",
    ],
    default: "PENDING",
  },
  s3Key: {
    type: String,
    required: function () {
      return this.transferMethod === "CLOUD";
    },
  },
  expiresAt: {
    type: Date,
    required: true,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

module.exports = mongoose.model("File", FileSchema);
