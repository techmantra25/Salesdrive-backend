let io;

const initSocket = (server) => {
  const { Server } = require("socket.io");

  io = new Server(server, {
    cors: { origin: "*" },
  });

  console.log("Socket.IO server initialized");

  io.on("connection", (socket) => {
    console.log("New socket connected:", socket.id);

    const { userId, role } = socket.handshake.auth || {};

    // 🔥 Auto Join User Room
    if (userId) {
      const userRoom = `user:${userId}`;
      socket.join(userRoom);
      console.log(`User joined room: ${userRoom}`);
    }

    // 🔥 Auto Join Role Room
    if (role) {
      const roleRoom = `role:${role}`;
      socket.join(roleRoom);
      console.log(`User joined role room: ${roleRoom}`);
    }

    socket.on("disconnect", () => {
      console.log("Socket disconnected:", socket.id);
    });
  });

  return io;
};

const getIO = () => {
  if (!io) {
    throw new Error("Socket.io not initialized!");
  }
  return io;
};

module.exports = { initSocket, getIO, io };
