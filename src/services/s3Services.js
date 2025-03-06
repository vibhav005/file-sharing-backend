const {
  S3Client,
  DeleteObjectCommand,
  PutObjectCommand,
  GetObjectCommand,
} = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
const multer = require("multer");
const { Readable } = require("stream");

// Configure AWS SDK v3 S3 Client
const s3Client = new S3Client({
  region: process.env.AWS_REGION || "ap-south-1",
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY,
    secretAccessKey: process.env.AWS_SECRET_KEY,
  },
});

// Configure multer storage
const storage = multer.memoryStorage(); // Store file in memory before uploading
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 * 1024 },
}); // 5GB limit

// Function to upload file to S3
const uploadFile = async (file) => {
  const fileKey = `uploads/${Date.now()}-${Math.round(Math.random() * 1e9)}-${
    file.originalname
  }`;

  try {
    const uploadParams = {
      Bucket: process.env.AWS_BUCKET_NAME,
      Key: fileKey,
      Body: file.buffer, // Just use the buffer directly instead of Readable.from()
      ContentType: file.mimetype,
      ContentLength: file.size, // Add the content length
    };

    await s3Client.send(new PutObjectCommand(uploadParams));
    return {
      key: fileKey,
      downloadUrl: `https://${process.env.AWS_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${fileKey}`,
    };
  } catch (error) {
    console.error("Error uploading file to S3:", error);
    throw error;
  }
};

// Function to delete file from S3
const deleteFile = async (key) => {
  try {
    const deleteParams = {
      Bucket: process.env.AWS_BUCKET_NAME,
      Key: key,
    };

    await s3Client.send(new DeleteObjectCommand(deleteParams));
    return true;
  } catch (error) {
    console.error("Error deleting file from S3:", error);
    return false;
  }
};

// Function to generate presigned URL
const generatePresignedUrl = async (key) => {
  try {
    const command = new GetObjectCommand({
      Bucket: process.env.AWS_BUCKET_NAME,
      Key: key,
    });

    const url = await getSignedUrl(s3Client, command, { expiresIn: 3600 }); // 1-hour expiry
    return url;
  } catch (error) {
    console.error("Error generating presigned URL:", error);
    return null;
  }
};

module.exports = {
  upload,
  uploadFile,
  deleteFile,
  generatePresignedUrl,
};
