// services/webrtcService.js
const { Server } = require("socket.io");

function setupWebRTCSignaling(io) {
  // Keep track of connected peers
  const peers = new Map();

  io.on("connection", (socket) => {
    console.log("New peer connected:", socket.id);

    // Store socket information
    peers.set(socket.id, {
      socket: socket,
      userId: null,
      transferIds: new Set(),
    });

    // Handle user authentication for WebRTC
    socket.on("auth", ({ userId }) => {
      const peer = peers.get(socket.id);
      if (peer) {
        peer.userId = userId;
        socket.join(`user_${userId}`);
        console.log(`User ${userId} authenticated for WebRTC`);
      }
    });

    // Handle initial connection request
    socket.on("initTransfer", async ({ transferId, recipientId, fileInfo }) => {
      try {
        console.log(`Initiating transfer ${transferId} to ${recipientId}`);

        // Create a unique room for this transfer
        const roomId = `transfer_${transferId}`;
        socket.join(roomId);

        // Store transfer info
        const peer = peers.get(socket.id);
        if (peer) {
          peer.transferIds.add(transferId);
        }

        // Notify recipient
        io.to(`user_${recipientId}`).emit("transferRequest", {
          transferId,
          senderId: peer?.userId,
          roomId,
          fileInfo,
        });
      } catch (error) {
        console.error("Error initiating transfer:", error);
        socket.emit("transferError", {
          transferId,
          error: "Failed to initiate transfer",
        });
      }
    });

    // Handle recipient accepting transfer
    socket.on("acceptTransfer", ({ transferId, roomId }) => {
      socket.join(roomId);
      io.to(roomId).emit("transferAccepted", { transferId });
    });

    // Handle recipient rejecting transfer
    socket.on("rejectTransfer", ({ transferId, roomId }) => {
      io.to(roomId).emit("transferRejected", { transferId });
    });

    // WebRTC Signaling
    socket.on("offer", ({ offer, transferId, roomId }) => {
      socket.to(roomId).emit("offer", {
        offer,
        transferId,
        from: socket.id,
      });
    });

    socket.on("answer", ({ answer, transferId, roomId }) => {
      socket.to(roomId).emit("answer", {
        answer,
        transferId,
        from: socket.id,
      });
    });

    socket.on("iceCandidate", ({ candidate, transferId, roomId }) => {
      socket.to(roomId).emit("iceCandidate", {
        candidate,
        transferId,
        from: socket.id,
      });
    });

    // Handle transfer progress updates
    socket.on("transferProgress", ({ transferId, progress, roomId }) => {
      io.to(roomId).emit("transferProgress", {
        transferId,
        progress,
      });
    });

    // Handle transfer completion
    socket.on("transferComplete", ({ transferId, roomId }) => {
      io.to(roomId).emit("transferComplete", { transferId });

      // Clean up the room
      io.in(roomId).socketsLeave(roomId);
    });

    // Handle transfer errors
    socket.on("transferError", ({ transferId, error, roomId }) => {
      io.to(roomId).emit("transferError", {
        transferId,
        error,
      });
    });

    // Handle disconnection
    socket.on("disconnect", () => {
      const peer = peers.get(socket.id);
      if (peer) {
        // Notify all active transfer rooms about disconnection
        peer.transferIds.forEach((transferId) => {
          const roomId = `transfer_${transferId}`;
          io.to(roomId).emit("peerDisconnected", {
            transferId,
            peerId: socket.id,
          });
        });
        peers.delete(socket.id);
      }
      console.log("Peer disconnected:", socket.id);
    });
  });
}

module.exports = setupWebRTCSignaling;
