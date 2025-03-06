const { param, body, validationResult } = require("express-validator");
const File = require("../models/File");

// utils/helpers.js
const formatBytes = (bytes, decimals = 2) => {
  if (bytes === 0) return "0 Bytes";

  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ["Bytes", "KB", "MB", "GB", "TB"];

  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + " " + sizes[i];
};

// Validation middleware
const validateTransferId = [
  param("transferId").isMongoId().withMessage("Invalid transfer ID format"),
  (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }
    next();
  },
];

const validateSignalData = [
  body("type").notEmpty().withMessage("Signal type is required"),
  (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }
    next();
  },
];

// Helper middleware to verify transfer access
const verifyTransferAccess = async (req, res, next) => {
  try {
    const { transferId } = req.params;
    console.log(transferId);
    const transfer = await File.findById(transferId);
    if (!transfer) {
      return res.status(404).json({ msg: "Transfer not found" });
    }

    // Verify user is part of this transfer
    const isUploader = transfer.uploadedBy.toString() === req.user.id;
    const isRecipient = transfer.recipient.toString() === req.user.id;

    if (!isUploader && !isRecipient) {
      return res.status(401).json({ msg: "Not authorized for this transfer" });
    }

    // Add transfer and role info to the request object
    req.transfer = transfer;
    req.isUploader = isUploader;
    req.isRecipient = isRecipient;
    req.peerRole = isUploader ? "uploader" : "recipient";
    req.peerId = isUploader ? transfer.recipient : transfer.uploadedBy;

    next();
  } catch (err) {
    console.error("Error verifying transfer access:", err);
    res.status(500).json({ msg: "Server Error", error: err.message });
  }
};

module.exports = {
  formatBytes,
  validateTransferId,
  validateSignalData,
  verifyTransferAccess,
};
