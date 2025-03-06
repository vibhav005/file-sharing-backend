// routes/api/files.js
const express = require("express");
const router = express.Router();
const auth = require("../../middleware/auth");
const File = require("../../models/File");
const {
  upload,
  deleteFile,
  generatePresignedUrl,
  uploadFile,
} = require("../../services/s3Services");
const { formatBytes } = require("../../utils/helpers");
const User = require("../../models/User");

// @route   POST api/files/upload
// @desc    Upload a file to S3 when P2P is not available
// @access  Private
router.post("/upload", auth, upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ msg: "No file uploaded" });
    }

    // Ensure recipient email is provided
    if (!req.body.recipient) {
      return res.status(400).json({ msg: "Recipient email is required" });
    }

    const recipientUser = await User.findOne({ email: req.body.recipient });
    if (!recipientUser) {
      return res.status(404).json({ msg: "Recipient not found" });
    }

    // Log the upload details
    console.log("Uploading file:", {
      originalname: req.file.originalname,
      size: req.file.size,
      mimetype: req.file.mimetype,
    });

    const { downloadUrl, key } = await uploadFile(req.file);
    console.log("Upload result:", { downloadUrl, key }); // Log the upload result

    const newFile = new File({
      fileName: req.file.originalname,
      fileSize: req.file.size,
      fileType: req.file.mimetype,
      uploadedBy: req.user.id,
      recipient: recipientUser._id,
      downloadUrl: downloadUrl,
      s3Key: key,
      transferMethod: "CLOUD",
      status: "COMPLETED",
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    });

    await newFile.save();
    console.log("Saved file document:", newFile); // Log the saved document

    req.app
      .get("io")
      .to(req.body.recipient)
      .emit("fileUploaded", {
        fileId: newFile._id,
        fileName: newFile.fileName,
        fileSize: formatBytes(newFile.fileSize),
      });

    res.json({ newFile, downloadUrl });
  } catch (err) {
    console.error("Error in file upload:", err);
    res.status(500).send("Server Error");
  }
});

// @route   GET api/files/download/:fileId
// @desc    Get download URL for a file
// @access  Private
router.get("/download/:fileId", auth, async (req, res) => {
  try {
    const file = await File.findById(req.params.fileId);
    console.log("File document:", file); // Log the file document

    if (!file) {
      return res.status(404).json({ msg: "File not found" });
    }

    if (
      file.uploadedBy.toString() !== req.user.id &&
      file.recipient.toString() !== req.user.id
    ) {
      return res.status(401).json({ msg: "Not authorized" });
    }

    if (file.transferMethod === "CLOUD") {
      // Extract the key from downloadUrl
      const url = new URL(file.downloadUrl);
      const key = decodeURIComponent(url.pathname.substring(1));
      console.log("Extracted key:", key); // Log the extracted key

      if (!key) {
        return res.status(400).json({ msg: "Invalid file URL" });
      }

      const downloadUrl = await generatePresignedUrl(key);
      if (!downloadUrl) {
        return res.status(500).json({ msg: "Error generating download URL" });
      }
      res.json({ downloadUrl });
    } else {
      res.json({ downloadUrl: file.downloadUrl });
    }
  } catch (err) {
    console.error("Error in file download:", err);
    res.status(500).send("Server Error");
  }
});

// @route   GET api/files/list
// @desc    Get list of files for current user
// @access  Private
router.get("/list", auth, async (req, res) => {
  try {
    const user = await User.findOne({ email: req.user.email });
    if (!user) {
      return res.status(404).json({ msg: "User not found" });
    }

    const files = await File.find({
      $or: [
        { uploadedBy: req.user.id },
        { recipient: user._id }, // Use the ObjectId instead of email
      ],
    }).sort({ createdAt: -1 });

    res.json(files);
  } catch (err) {
    console.error("Error getting file list:", err);
    res.status(500).send("Server Error");
  }
});

// @route   DELETE api/files/:fileId
// @desc    Delete a file
// @access  Private
router.delete("/:fileId", auth, async (req, res) => {
  try {
    const file = await File.findById(req.params.fileId);
    console.log("file:::", file);

    if (!file) {
      return res.status(404).json({ msg: "File not found" });
    }

    if (file.uploadedBy.toString() !== req.user.id) {
      return res.status(401).json({ msg: "Not authorized" });
    }

    if (file.transferMethod === "CLOUD") {
      const key = file.downloadUrl.split("/").pop();
      await deleteFile(key);
    }

    await file.remove();
    res.json({ msg: "File deleted" });
  } catch (err) {
    console.error("Error deleting file:", err);
    res.status(500).send("Server Error");
  }
});
module.exports = router;
