/**
 * socket.js — Singleton Socket.io client
 *
 * In dev the Vite proxy forwards /socket.io to the backend (localhost:3001).
 * In production you'd set VITE_SERVER_URL to the actual backend origin.
 */
import { io } from "socket.io-client";

const SERVER_URL = import.meta.env.VITE_SERVER_URL || "";

const socket = io(SERVER_URL, {
  autoConnect: false, // we connect manually when entering a room
});

export default socket;
