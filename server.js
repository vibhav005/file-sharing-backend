// server.js
const express = require("express");
const cors = require("cors");
const connectDB = require("./src/config/db");
const http = require("http");
const socketIO = require("socket.io");
const setupWebRTCSignaling = require("./src/services/webrtcService");
// Update this import to use ExpressPeerServer instead of PeerServer
const { ExpressPeerServer } = require("peer");
const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 5000;
const io = socketIO(server, {
  cors: {
    origin: process.env.FRONTEND_URL,
    methods: ["GET", "POST", "PUT", "DELETE"],
  },
});

// Replace these lines:
// const peerServer = PeerServer({
//   path: "/peerjs",
// });
//
// app.use("/peerjs", (req, res, next) => {
//   peerServer(req, res, next);
// });

// With these lines:
const peerServer = ExpressPeerServer(server, {
  port: PORT,
  debug: true,
  path: "/",
  allow_discovery: true,
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

app.use("/peerjs", peerServer);

console.log("✅ PeerJS server running on /peerjs");

// Add listeners to track peer connections
peerServer.on("connection", (client) => {
  console.log(`PeerJS client connected: ${client.id}`);
});

peerServer.on("disconnect", (client) => {
  console.log(`PeerJS client disconnected: ${client.id}`);
});

setupWebRTCSignaling(io);
// Connect Database
connectDB();

app.set("io", io);
// Initialize Middleware
app.use(cors());
app.use(express.json());

// Define Routes
app.use("/api/auth", require("./src/routes/api/auth"));
app.use("/api/files", require("./src/routes/api/files"));
app.use("/api/transfers", require("./src/routes/api/transfers"));

// Enhance Socket.IO connection handling for better peer signaling
io.on("connection", (socket) => {
  console.log("New client connected");

  // Handle transfer room joining
  socket.on("initTransfer", (data) => {
    socket.join(data.roomId);
    io.to(data.roomId).emit("transferReady");
  });

  // Add these new socket events for better peer coordination
  socket.on("joinTransferRoom", (data) => {
    if (data.transferId) {
      socket.join(`transfer-${data.transferId}`);
      console.log(`Client joined transfer room: transfer-${data.transferId}`);
    }
  });

  socket.on("peerReady", (data) => {
    if (data.transferId) {
      console.log(`Peer ready: ${data.role} for transfer ${data.transferId}`);
      io.to(`transfer-${data.transferId}`).emit("peerReady", {
        role: data.role,
        transferId: data.transferId,
      });
    }
  });

  socket.on("leaveTransferRoom", (data) => {
    if (data.transferId) {
      socket.leave(`transfer-${data.transferId}`);
      console.log(`Client left transfer room: transfer-${data.transferId}`);
    }
  });

  socket.on("disconnect", () => {
    console.log("Client disconnected");
  });
});

server.listen(PORT, () => console.log(`Server started on port ${PORT}`));
