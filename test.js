const { PeerServer } = require("peer");

const peerServer = PeerServer({ port: 9000, path: "/peerjs" });

peerServer.on("connection", (client) => {
  console.log(`New peer connected: ${client.id}`);
});

peerServer.on("disconnect", (client) => {
  console.log(`Peer disconnected: ${client.id}`);
});
