import { useState, useEffect, useRef } from "react";
import socket from "../socket";

/**
 * Quick-send suggestion buttons — easily configurable.
 * Just add/remove strings from this array.
 */
const SUGGESTIONS = ["Ready?", "Start now", "Pause pls", "LOL", "Wait a sec", "Skip?"];

/**
 * Chat — YouTube-style side panel chat with:
 *  - Users list at the top
 *  - System messages (join/leave)
 *  - Quick suggestion buttons
 *  - Auto-scroll to latest
 *
 * Props:
 *   roomId   – current room ID
 *   username – the local user's display name
 *   users    – array of { socketId, username } from the room
 *   isMobileOpen – whether the mobile chat drawer is open
 *   onToggleMobile – callback to toggle mobile drawer
 */
export default function Chat({ roomId, username, users, isMobileOpen, onToggleMobile }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const bottomRef = useRef(null);

  useEffect(() => {
    // Chat messages (from other users and self, relayed by server)
    const onReceive = (msg) => {
      setMessages((prev) => [...prev, msg]);
    };

    // System messages for join/leave
    const onJoin = ({ username: who, timestamp }) => {
      setMessages((prev) => [
        ...prev,
        { type: "system", text: `${who} joined the room`, timestamp },
      ]);
    };
    const onLeave = ({ username: who, timestamp }) => {
      setMessages((prev) => [
        ...prev,
        { type: "system", text: `${who} left the room`, timestamp },
      ]);
    };

    socket.on("receive-message", onReceive);
    socket.on("user-joined", onJoin);
    socket.on("user-left", onLeave);

    return () => {
      socket.off("receive-message", onReceive);
      socket.off("user-joined", onJoin);
      socket.off("user-left", onLeave);
    };
  }, []);

  // Auto-scroll on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const send = (text) => {
    const t = (text || input).trim();
    if (!t) return;
    socket.emit("send-message", { roomId, text: t });
    if (!text) setInput(""); // only clear the input box, not quick-send
  };

  const formatTime = (ts) => {
    const d = new Date(ts);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  };

  return (
    <aside className={`chat-panel ${isMobileOpen ? "chat-panel--open" : ""}`}>
      {/* Mobile close button */}
      <button className="chat-panel__mobile-close" onClick={onToggleMobile}>
        ✕
      </button>

      {/* Users list */}
      <div className="chat-users">
        <div className="chat-users__header">
          <span className="chat-users__dot" />
          <span>{users.length} online</span>
        </div>
        <div className="chat-users__list">
          {users.map((u) => (
            <span key={u.socketId} className="chat-users__tag">
              {u.username}
            </span>
          ))}
        </div>
      </div>

      {/* Messages */}
      <div className="chat-messages">
        {messages.length === 0 && (
          <div className="chat-empty">No messages yet — say hi! 👋</div>
        )}
        {messages.map((m, i) =>
          m.type === "system" ? (
            <div key={i} className="chat-msg chat-msg--system">
              {m.text}
            </div>
          ) : (
            <div key={i} className="chat-msg">
              <div className="chat-msg__header">
                <strong>{m.username}</strong>
                <span className="chat-msg__time">{formatTime(m.timestamp)}</span>
              </div>
              <div className="chat-msg__text">{m.text}</div>
            </div>
          )
        )}
        <div ref={bottomRef} />
      </div>

      {/* Quick suggestions */}
      <div className="chat-suggestions">
        {SUGGESTIONS.map((s) => (
          <button key={s} className="chat-suggestion-btn" onClick={() => send(s)}>
            {s}
          </button>
        ))}
      </div>

      {/* Input */}
      <div className="chat-input-row">
        <input
          type="text"
          placeholder={`Message as ${username}…`}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()}
        />
        <button onClick={() => send()}>Send</button>
      </div>
    </aside>
  );
}
