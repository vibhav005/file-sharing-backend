// routes/api/transfers.js
const express = require("express");
const router = express.Router();
const auth = require("../../middleware/auth");
const File = require("../../models/File");
const User = require("../../models/User");
const { check, validationResult } = require("express-validator");
const { default: mongoose } = require("mongoose");
const SignalMessage = require("../../models/SignalMessage");
const {
  validateTransferId,
  verifyTransferAccess,
  validateSignalData,
} = require("../../utils/helpers");

// @route   POST api/transfers/initiate
// @desc    Initiate a P2P transfer
// @access  Private
router.post(
  "/initiate",
  [
    auth,
    [
      check("fileName", "File name is required").not().isEmpty(),
      check("fileSize", "File size is required").isNumeric(),
      check("fileType", "File type is required").not().isEmpty(),
      check("recipientEmail", "Valid recipient email is required").isEmail(),
    ],
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { fileName, fileSize, fileType, recipientEmail } = req.body;

      // Check if recipient exists
      const recipient = await User.findOne({ email: recipientEmail });
      if (!recipient) {
        return res.status(404).json({
          msg: "Recipient not found. They must be registered to receive files.",
        });
      }

      // Don't allow sending to self
      if (recipient.email === req.user.email) {
        return res.status(400).json({ msg: "Cannot send file to yourself" });
      }

      // Create a new file record for the transfer
      const newFile = new File({
        fileName,
        fileSize,
        fileType,
        uploadedBy: req.user.id,
        recipient: recipient._id,
        transferMethod: "P2P",
        status: "PENDING",
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours
      });

      await newFile.save();

      // Emit socket event to notify recipient
      req.app.get("io").to(`user_${recipient._id}`).emit("newTransferRequest", {
        transferId: newFile._id,
        sender: req.user.email,
        fileName,
        fileSize,
      });

      res.json({
        transferId: newFile._id,
        status: "initiated",
        recipient: {
          id: recipient._id,
          email: recipient.email,
        },
      });
    } catch (err) {
      console.error("Error initiating transfer:", err);
      res.status(500).send("Server Error");
    }
  }
);

// @route   GET api/transfers/pending
// @desc    Get all pending transfers for the user
// @access  Private
router.get("/pending", auth, async (req, res) => {
  try {
    const user = await User.findOne({ email: req.user.email });

    if (!user) {
      return res.status(404).json({ msg: "User not found" });
    }

    const pendingFiles = await File.find({
      $or: [
        { uploadedBy: req.user.id, status: "PENDING" },
        { recipient: user._id, status: "PENDING" }, // Use user._id here
      ],
    }).populate("uploadedBy", "email");

    res.json(pendingFiles);
  } catch (err) {
    console.error("Error fetching pending transfers:", err);
    res.status(500).send("Server Error");
  }
});

// @route   PUT api/transfers/:transferId/status
// @desc    Update transfer status
// @access  Private
router.put("/:transferId/status", auth, async (req, res) => {
  try {
    const { transferId } = req.params;

    if (
      !transferId ||
      transferId === "null" ||
      !mongoose.Types.ObjectId.isValid(transferId)
    ) {
      return res.status(400).json({ msg: "Invalid transfer ID" });
    }

    const file = await File.findById(transferId);
    if (!file) {
      return res.status(404).json({ msg: "Transfer not found" });
    }

    // Ensure the user is authorized
    // if (
    //   file.uploadedBy.toString() !== req.user.id &&
    //   file.recipient !== req.user.email
    // ) {
    //   return res.status(401).json({ msg: "Not authorized" });
    // }

    file.status = req.body.status;
    await file.save();

    res.json({ file });
  } catch (err) {
    console.error("Error updating transfer status:", err);
    res.status(500).send("Server Error");
  }
});

// @route   GET api/transfers/:transferId
// @desc    Get transfer details
// @access  Private
router.get("/:transferId", auth, async (req, res) => {
  try {
    // Check if transferId exists in the request parameters
    if (!req.params.transferId || req.params.transferId === "undefined") {
      return res.status(400).json({ msg: "Invalid transfer ID" });
    }

    const file = await File.findById(req.params.transferId).populate([
      { path: "uploadedBy", select: "email" },
      { path: "recipient", select: "email" },
    ]);

    if (!file) {
      return res.status(404).json({ msg: "Transfer not found" });
    }

    // Check authorization - compare ObjectId to String
    if (
      file.uploadedBy._id.toString() !== req.user.id &&
      file.recipient._id.toString() !== req.user.id
    ) {
      return res.status(401).json({ msg: "Not authorized" });
    }

    res.json(file);
  } catch (err) {
    console.error("Error fetching transfer details:", err);

    // More specific error handling
    if (err.kind === "ObjectId") {
      return res.status(400).json({ msg: "Invalid transfer ID format" });
    }

    res.status(500).send("Server Error");
  }
});

// @route   PUT api/transfers/:transferId/progress
// @desc    Update transfer progress
// @access  Private
router.put(
  "/:transferId/progress",
  [
    auth,
    check("progress", "Progress percentage is required").isFloat({
      min: 0,
      max: 100,
    }),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { progress } = req.body;
      const file = await File.findById(req.params.transferId);

      if (!file) {
        return res.status(404).json({ msg: "Transfer not found" });
      }

      // Only sender can update progress
      if (file.uploadedBy.toString() !== req.user.id) {
        return res.status(401).json({ msg: "Not authorized" });
      }

      file.progress = progress;
      if (progress === 100) {
        file.status = "COMPLETED";
        file.completedAt = Date.now();
      }

      await file.save();

      // Notify both parties about the progress
      const io = req.app.get("io");
      io.to(`user_${file.uploadedBy}`)
        .to(`user_${file.recipient}`)
        .emit("transferProgress", {
          transferId: file._id,
          progress,
        });

      res.json({ progress });
    } catch (err) {
      console.error("Error updating transfer progress:", err);
      res.status(500).send("Server Error");
    }
  }
);

// @route   DELETE api/transfers/:transferId
// @desc    Cancel transfer
// @access  Private
router.delete("/:transferId", auth, async (req, res) => {
  try {
    const file = await File.findById(req.params.transferId);

    if (!file) {
      return res.status(404).json({ msg: "Transfer not found" });
    }

    // Check authorization
    if (
      file.uploadedBy.toString() !== req.user.id &&
      file.recipient !== req.user.email
    ) {
      return res.status(401).json({ msg: "Not authorized" });
    }

    // Only allow cancellation of pending or in-progress transfers
    if (!["PENDING", "TRANSFERRING"].includes(file.status)) {
      return res
        .status(400)
        .json({ msg: "Cannot cancel completed or failed transfers" });
    }

    file.status = "CANCELLED";
    await file.save();

    // Notify both parties about cancellation
    const io = req.app.get("io");
    io.to(`user_${file.uploadedBy}`)
      .to(`user_${file.recipient}`)
      .emit("transferCancelled", {
        transferId: file._id,
      });

    res.json({ msg: "Transfer cancelled successfully" });
  } catch (err) {
    console.error("Error cancelling transfer:", err);
    res.status(500).send("Server Error");
  }
});

// @route   POST api/transfers/:transferId/signal
// @desc    Send WebRTC signaling data
// @access  Private
router.post(
  "/:transferId/signal",
  auth,
  validateTransferId,
  validateSignalData,
  verifyTransferAccess,
  async (req, res) => {
    const logger = req.app.get("logger") || console;
    logger.info(`POST /api/transfers/${req.params.transferId}/signal`, {
      type: req.body.type,
      role: req.peerRole,
    });

    try {
      const { transferId } = req.params;
      const { type, sdp, candidate } = req.body;

      // Create a new signal message
      const newSignal = new SignalMessage({
        transferId,
        sender: req.user.id,
        recipient: req.peerId,
        type,
        sdp: sdp || null,
        candidate: candidate || null,
        timestamp: Date.now(),
      });

      await newSignal.save();

      // Notify the other party about the new signal via Socket.IO
      const io = req.app.get("io");
      io.to(`user_${req.peerId}`).emit("newSignal", {
        transferId,
        type,
        signalId: newSignal._id,
      });

      res.json({ success: true, signalId: newSignal._id });
    } catch (err) {
      logger.error("Error sending signal:", err);
      res.status(500).json({ msg: "Server Error", error: err.message });
    }
  }
);

// @route   GET api/transfers/:transferId/signal/:type
// @desc    Get WebRTC signaling data
// @access  Private
router.get(
  "/:transferId/signal/:type",
  auth,
  validateTransferId,
  verifyTransferAccess,
  async (req, res) => {
    const logger = req.app.get("logger") || console;

    try {
      const { transferId, type } = req.params;
      logger.info(`GET /api/transfers/${transferId}/signal/${type}`, {
        role: req.peerRole,
      });

      if (!["offer", "answer", "ice-candidate"].includes(type)) {
        return res.status(400).json({ msg: "Invalid signal type" });
      }

      // For ice-candidate type, we need to fetch multiple messages
      if (type === "ice-candidate") {
        const signals = await SignalMessage.find({
          transferId,
          type: "ice-candidate",
          sender: req.peerId,
          recipient: req.user.id,
        }).sort({ timestamp: 1 });

        // Return the candidates array
        return res.json(signals.map((signal) => signal.candidate));
      }
      // For offer/answer, get the most recent message
      else {
        // Validate proper signal flow:
        // - Recipients request offers (sent by uploaders)
        // - Uploaders request answers (sent by recipients)
        const isValidRequest =
          (type === "offer" && req.isRecipient) ||
          (type === "answer" && req.isUploader);

        if (!isValidRequest) {
          return res.status(400).json({
            msg: `Invalid request: ${req.peerRole} cannot request ${type} signals`,
          });
        }

        // Determine expected sender based on signal type
        const expectedSender =
          type === "offer" ? req.transfer.uploadedBy : req.transfer.recipient;

        const signal = await SignalMessage.findOne({
          transferId,
          type,
          sender: expectedSender,
          recipient: req.user.id,
        }).sort({ timestamp: -1 });

        if (!signal) {
          return res.status(404).json({ msg: `No ${type} signal found` });
        }

        // Return the signal data
        return res.json({
          type: signal.type,
          sdp: signal.sdp,
        });
      }
    } catch (err) {
      logger.error("Error retrieving signal:", err);
      res.status(500).json({ msg: "Server Error", error: err.message });
    }
  }
);
module.exports = router;
