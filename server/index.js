/**
 * index.js — WatchTogether server (v2)
 *
 * Responsibilities:
 *  1. Serve REST endpoints for room creation / lookup.
 *  2. Manage Socket.io connections for real-time video sync + chat.
 *
 * Sync philosophy:
 *  - The SERVER is the source of truth for room state.
 *  - When a client triggers play/pause/seek/video-change it sends the event
 *    to the server, which updates state and broadcasts to OTHER clients
 *    (never echo back to the sender, preventing event loops).
 *  - New joiners receive a `sync-state` event with the computed live position.
 *
 * v2 additions:
 *  - Username tracking per socket (users Map instead of Set)
 *  - user-joined / user-left system messages
 *  - users-list broadcast on every join/leave
 *  - send-message / receive-message chat events
 */

const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const { v4: uuidv4 } = require("uuid");
const {
  joinRoom,
  leaveRoom,
  updateRoom,
  getRoomState,
  getUsersList,
  roomExists,
} = require("./rooms");
const { setupTorrentRoutes } = require("./torrent");

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

// ──────────────────────────── REST endpoints ────────────────────────────

// Torrent streaming routes (server-side WebTorrent for TCP/UDP peer access)
setupTorrentRoutes(app);

/**
 * POST /api/rooms — create a new room, returns { roomId }
 */
app.post("/api/rooms", (_req, res) => {
  const roomId = uuidv4().slice(0, 8); // short 8-char code
  // Bootstrap the room so it exists for the GET check
  joinRoom(roomId, "__placeholder__", "__system__");
  res.json({ roomId });
});

/**
 * GET /api/rooms/:roomId — check if room exists + get state
 */
app.get("/api/rooms/:roomId", (req, res) => {
  const { roomId } = req.params;
  if (roomExists(roomId)) {
    const state = getRoomState(roomId);
    return res.json({ exists: true, ...state });
  }
  res.status(404).json({ exists: false });
});

// ──────────────────────────── Socket.io ─────────────────────────────────

/**
 * Helper: broadcast the current users list to everyone in a room.
 */
function broadcastUsersList(roomId) {
  const users = getUsersList(roomId);
  // Filter out the placeholder user
  const filtered = users.filter((u) => u.socketId !== "__placeholder__");
  io.to(roomId).emit("users-list", filtered);
}

io.on("connection", (socket) => {
  console.log(`⚡ Connected: ${socket.id}`);

  /**
   * join-room — client sends { roomId, username }.
   * We add them, send sync-state, then broadcast join to others.
   */
  socket.on("join-room", ({ roomId, username }) => {
    socket.join(roomId);
    socket.roomId = roomId;
    socket.username = username || "Guest";

    // Remove placeholder if present (from POST /api/rooms)
    leaveRoom(roomId, "__placeholder__");
    joinRoom(roomId, socket.id, socket.username);

    const state = getRoomState(roomId);
    console.log(`👤 ${socket.username} (${socket.id}) joined room ${roomId}`);

    // Send the joiner the current state so they can sync video
    socket.emit("sync-state", state);

    // Broadcast "user-joined" system message to everyone else
    socket.to(roomId).emit("user-joined", {
      username: socket.username,
      timestamp: Date.now(),
    });

    // Broadcast updated users list to everyone (including joiner)
    broadcastUsersList(roomId);
  });

  /**
   * video-change — someone loaded new media (YouTube, URL, local, or torrent).
   * Payload: { roomId, sourceType, videoId?, url?, magnetURI? }
   * Reset playback to 0, paused, and broadcast to others.
   */
  socket.on("video-change", ({ roomId, sourceType, videoId, url, magnetURI }) => {
    console.log(`🎬 Video change in ${roomId}: ${sourceType}`, videoId || url || magnetURI || "(local)");
    updateRoom(roomId, {
      sourceType: sourceType || "youtube",
      videoId: videoId || null,
      url: url || null,
      magnetURI: magnetURI || null,
      currentTime: 0,
      isPlaying: false,
    });
    socket.to(roomId).emit("video-change", { sourceType, videoId, url, magnetURI });
  });

  /**
   * play — sender started playing.
   */
  socket.on("play", ({ roomId, currentTime }) => {
    console.log(`▶️  Play in ${roomId} at ${currentTime.toFixed(1)}s`);
    updateRoom(roomId, { currentTime, isPlaying: true });
    socket.to(roomId).emit("play", { currentTime });
  });

  /**
   * pause — sender paused.
   */
  socket.on("pause", ({ roomId, currentTime }) => {
    console.log(`⏸  Pause in ${roomId} at ${currentTime.toFixed(1)}s`);
    updateRoom(roomId, { currentTime, isPlaying: false });
    socket.to(roomId).emit("pause", { currentTime });
  });

  /**
   * seek — sender scrubbed to a new position.
   */
  socket.on("seek", ({ roomId, currentTime }) => {
    console.log(`⏩ Seek in ${roomId} to ${currentTime.toFixed(1)}s`);
    const room = getRoomState(roomId);
    updateRoom(roomId, { currentTime, isPlaying: room?.isPlaying ?? false });
    socket.to(roomId).emit("seek", { currentTime });
  });

  /**
   * send-message — chat message from a user.
   * Broadcast to ALL clients in the room (including sender) as receive-message.
   */
  socket.on("send-message", ({ roomId, text }) => {
    const msg = {
      type: "chat", // "chat" vs "system" for rendering
      username: socket.username || "Guest",
      text,
      timestamp: Date.now(),
    };
    io.to(roomId).emit("receive-message", msg);
  });

  /**
   * disconnect — clean up room membership, broadcast leave.
   */
  socket.on("disconnect", () => {
    console.log(`🔌 Disconnected: ${socket.username || socket.id}`);
    const roomId = socket.roomId;
    if (roomId) {
      const { remaining, username } = leaveRoom(roomId, socket.id);
      if (remaining > 0) {
        // Broadcast "user-left" system message
        io.to(roomId).emit("user-left", {
          username: username || "Guest",
          timestamp: Date.now(),
        });
        // Broadcast updated users list
        broadcastUsersList(roomId);
      }
    }
  });
});

// ──────────────────────────── Start ─────────────────────────────────────

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`🚀 WatchTogether server running on http://localhost:${PORT}`);
});
