/**
 * rooms.js — In-memory room state management (v3)
 *
 * Each room stores:
 *   sourceType  – "youtube" | "url" | "local" | "torrent"
 *   videoId     – YouTube video ID (when sourceType = "youtube")
 *   url         – direct video URL (when sourceType = "url")
 *   magnetURI   – magnet link (when sourceType = "torrent")
 *   currentTime – playback position (seconds)
 *   isPlaying   – whether the video is playing
 *   lastUpdate  – server timestamp of last state change (for drift calc)
 *   users       – Map<socketId, { username }> for tracking who's in the room
 */

const rooms = new Map();

/**
 * Create a new room with default state.
 */
function createRoom(roomId) {
  const room = {
    sourceType: "youtube", // default mode
    videoId: null,
    url: null,
    magnetURI: null,
    currentTime: 0,
    isPlaying: false,
    lastUpdate: Date.now(),
    users: new Map(), // socketId → { username }
  };
  rooms.set(roomId, room);
  return room;
}

/**
 * Get a room by ID. Returns undefined if not found.
 */
function getRoom(roomId) {
  return rooms.get(roomId);
}

/**
 * Add a user (socket + username) to a room, creating the room if needed.
 * Returns the room object.
 */
function joinRoom(roomId, socketId, username) {
  let room = rooms.get(roomId);
  if (!room) {
    room = createRoom(roomId);
  }
  room.users.set(socketId, { username: username || "Guest" });
  return room;
}

/**
 * Remove a socket from a room. Deletes the room if empty.
 * Returns { remaining, username } — remaining user count and the name that left.
 */
function leaveRoom(roomId, socketId) {
  const room = rooms.get(roomId);
  if (!room) return { remaining: 0, username: null };

  const user = room.users.get(socketId);
  const username = user ? user.username : null;
  room.users.delete(socketId);

  if (room.users.size === 0) {
    rooms.delete(roomId);
    return { remaining: 0, username };
  }
  return { remaining: room.users.size, username };
}

/**
 * Update room state. Accepts any combination of fields.
 * Always stamps lastUpdate so new joiners can compute elapsed time.
 */
function updateRoom(roomId, updates) {
  const room = rooms.get(roomId);
  if (!room) return null;
  if (updates.sourceType !== undefined) room.sourceType = updates.sourceType;
  if (updates.videoId !== undefined) room.videoId = updates.videoId;
  if (updates.url !== undefined) room.url = updates.url;
  if (updates.magnetURI !== undefined) room.magnetURI = updates.magnetURI;
  if (updates.currentTime !== undefined) room.currentTime = updates.currentTime;
  if (updates.isPlaying !== undefined) room.isPlaying = updates.isPlaying;
  room.lastUpdate = Date.now();
  return room;
}

/**
 * Get the list of { socketId, username } for a room.
 */
function getUsersList(roomId) {
  const room = rooms.get(roomId);
  if (!room) return [];
  return Array.from(room.users.entries()).map(([socketId, data]) => ({
    socketId,
    username: data.username,
  }));
}

/**
 * Compute the "live" currentTime for a room.
 * If the video is playing, we add elapsed seconds since lastUpdate
 * so that a new joiner lands at the right spot.
 */
function getRoomState(roomId) {
  const room = rooms.get(roomId);
  if (!room) return null;

  let currentTime = room.currentTime;
  if (room.isPlaying) {
    const elapsed = (Date.now() - room.lastUpdate) / 1000;
    currentTime += elapsed;
  }

  return {
    sourceType: room.sourceType,
    videoId: room.videoId,
    url: room.url,
    magnetURI: room.magnetURI,
    currentTime,
    isPlaying: room.isPlaying,
    userCount: room.users.size,
    users: getUsersList(roomId),
  };
}

/**
 * Check whether a room exists.
 */
function roomExists(roomId) {
  return rooms.has(roomId);
}

module.exports = {
  createRoom,
  getRoom,
  joinRoom,
  leaveRoom,
  updateRoom,
  getUsersList,
  getRoomState,
  roomExists,
};
