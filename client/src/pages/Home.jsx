import { useNavigate } from "react-router-dom";
import { useState, useEffect } from "react";

const STORAGE_KEY = "watchtogether_username";

/**
 * Home — landing page.
 * Shows a name input + "Create Room" button.
 * If localStorage already has a name, pre-fills it.
 */
export default function Home() {
  const navigate = useNavigate();
  const [name, setName] = useState("");

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) setName(saved);
  }, []);

  const createRoom = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    // Persist the name
    localStorage.setItem(STORAGE_KEY, trimmed);
    try {
      const res = await fetch("/api/rooms", { method: "POST" });
      const data = await res.json();
      navigate(`/room/${data.roomId}`);
    } catch (err) {
      console.error("Failed to create room:", err);
      alert("Could not create room. Is the server running?");
    }
  };

  return (
    <div className="home">
      <h1>
        📺 Watch<span>Together</span>
      </h1>
      <p>
        Watch YouTube videos in perfect sync with your friends.
        No sign-up needed — just enter your name, create a room, and share the
        link.
      </p>
      <div className="home__form">
        <input
          type="text"
          className="home__name-input"
          placeholder="Your display name…"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && createRoom()}
          maxLength={24}
        />
        <button className="btn" onClick={createRoom} disabled={!name.trim()}>
          🎬 Create a Room
        </button>
      </div>
    </div>
  );
}
