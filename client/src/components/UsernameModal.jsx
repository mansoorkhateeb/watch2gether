import { useState, useEffect } from "react";

/**
 * UsernameModal — shown before a user can enter a room.
 *
 * Checks localStorage for a saved name first. If found, auto-joins.
 * Otherwise, shows a modal prompting for a display name.
 *
 * Props:
 *   onJoin(username) – called when the user submits their name
 */
const STORAGE_KEY = "watchtogether_username";

export default function UsernameModal({ onJoin }) {
  const [name, setName] = useState("");
  const [show, setShow] = useState(true);

  // On mount, check localStorage for a saved name
  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      setShow(false);
      onJoin(saved);
    }
  }, [onJoin]);

  const handleSubmit = (e) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    localStorage.setItem(STORAGE_KEY, trimmed);
    setShow(false);
    onJoin(trimmed);
  };

  if (!show) return null;

  return (
    <div className="modal-overlay">
      <form className="modal" onSubmit={handleSubmit}>
        <h2>👋 Welcome to WatchTogether</h2>
        <p>Enter your name to join the room</p>
        <input
          type="text"
          className="modal__input"
          placeholder="Your display name…"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
          maxLength={24}
        />
        <button type="submit" className="btn modal__btn" disabled={!name.trim()}>
          Join Room
        </button>
      </form>
    </div>
  );
}
