const express = require("express");
const cors = require("cors");
const fs = require("fs");
const http = require("http");
const { Server } = require("socket.io");

const uploadRoutes = require("./routes/uploadRoutes");
const eventRoutes = require("./routes/eventRoutes");

const app = express();
const PORT = 3000;

// Ensure uploads folder exists
if (!fs.existsSync("uploads")) fs.mkdirSync("uploads");

app.use(cors());
app.use(express.json());
app.use("/uploads", express.static("uploads"));
app.use("/api/videos", uploadRoutes);
app.use("/api/videos", eventRoutes);

// Wrap app with http server
const server = http.createServer(app);

// Initialize Socket.IO
const io = new Server(server, { cors: { origin: "*" } });

// Make io globally accessible in routes
app.set("io", io);

io.on("connection", (socket) => {
  console.log("Client connected:", socket.id);
  socket.on("disconnect", () => console.log("Client disconnected:", socket.id));
});

server.listen(PORT, () =>
  console.log(`Server running on http://localhost:${PORT}`)
);
