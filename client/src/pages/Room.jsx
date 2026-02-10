import { useParams } from "react-router-dom";
import { useEffect, useState, useRef, useCallback } from "react";
import socket from "../socket";
import YouTubePlayer from "../components/YouTubePlayer";
import ChatPanel from "../components/ChatPanel";
import UsernameModal from "../components/UsernameModal";

/**
 * Room — main watch room page (v2).
 *
 * Lifecycle:
 *  1. Show UsernameModal (skipped if localStorage has a name)
 *  2. Connect the socket & emit "join-room" with { roomId, username }
 *  3. Receive "sync-state" with current video / time / playing / users
 *  4. Load the YouTube player and seek to the right spot
 *  5. Forward local play/pause/seek events to the server
 *  6. React to remote events by controlling the player
 *
 * Layout: side-by-side (video | chat) on desktop, stacked on mobile.
 */
export default function Room() {
  const { roomId } = useParams();

  // ─── State ─────────────────────────────────────────────────────
  const [username, setUsername] = useState(null); // null = modal still showing
  const [videoId, setVideoId] = useState(null);
  const [urlInput, setUrlInput] = useState("");
  const [users, setUsers] = useState([]);
  const [copied, setCopied] = useState(false);
  const [chatOpen, setChatOpen] = useState(false); // mobile toggle

  // Ref to the YouTube player instance (from YT IFrame API)
  const playerRef = useRef(null);

  // Guard: ignore remote events while we're applying a remote command,
  // so that the player's own state-change callback doesn't re-emit.
  const isRemoteAction = useRef(false);

  // Keep a ref to initial sync state so YouTubePlayer can use it on ready
  const syncRef = useRef(null);

  // ─── Username callback (from modal or localStorage) ────────────
  const handleJoin = useCallback(
    (name) => {
      setUsername(name);
    },
    []
  );

  // ─── Socket setup (runs once username is set) ──────────────────
  useEffect(() => {
    if (!username) return; // wait for the modal

    if (!socket.connected) socket.connect();
    socket.emit("join-room", { roomId, username });

    // Initial state from server (for new joiners)
    socket.on("sync-state", (state) => {
      console.log("[sync-state]", state);
      if (state.videoId) {
        setVideoId(state.videoId);
        syncRef.current = state;
      }
      if (state.users) setUsers(state.users);
    });

    // Users list updates
    socket.on("users-list", (list) => setUsers(list));

    socket.on("video-change", ({ videoId: vid }) => {
      console.log("[video-change]", vid);
      setVideoId(vid);
      isRemoteAction.current = true;
      setTimeout(() => {
        const p = playerRef.current;
        if (p && p.cueVideoById) p.cueVideoById(vid);
        isRemoteAction.current = false;
      }, 100);
    });

    socket.on("play", ({ currentTime }) => {
      console.log("[remote play]", currentTime);
      const p = playerRef.current;
      if (!p) return;
      isRemoteAction.current = true;
      p.seekTo(currentTime, true);
      p.playVideo();
      setTimeout(() => (isRemoteAction.current = false), 500);
    });

    socket.on("pause", ({ currentTime }) => {
      console.log("[remote pause]", currentTime);
      const p = playerRef.current;
      if (!p) return;
      isRemoteAction.current = true;
      p.seekTo(currentTime, true);
      p.pauseVideo();
      setTimeout(() => (isRemoteAction.current = false), 500);
    });

    socket.on("seek", ({ currentTime }) => {
      console.log("[remote seek]", currentTime);
      const p = playerRef.current;
      if (!p) return;
      isRemoteAction.current = true;
      p.seekTo(currentTime, true);
      setTimeout(() => (isRemoteAction.current = false), 500);
    });

    return () => {
      socket.off("sync-state");
      socket.off("users-list");
      socket.off("video-change");
      socket.off("play");
      socket.off("pause");
      socket.off("seek");
      socket.disconnect();
    };
  }, [roomId, username]);

  // ─── Local player event handlers ───────────────────────────────

  /**
   * Called by YouTubePlayer when local user plays/pauses.
   * We only emit if it's NOT a remote action (prevents loops).
   */
  const onPlayerStateChange = useCallback(
    (event) => {
      if (isRemoteAction.current) return;
      const p = event.target;
      const currentTime = p.getCurrentTime();
      const state = event.data;
      // YT.PlayerState: PLAYING = 1, PAUSED = 2
      if (state === 1) {
        socket.emit("play", { roomId, currentTime });
      } else if (state === 2) {
        socket.emit("pause", { roomId, currentTime });
      }
    },
    [roomId]
  );

  /**
   * Seek detection via polling (YT API has no native seek event).
   * Detects time jumps > 2s.
   */
  const lastTimeRef = useRef(0);
  const seekIntervalRef = useRef(null);

  const onPlayerReady = useCallback(
    (player) => {
      playerRef.current = player;

      // If we have an initial sync state, apply it
      const sync = syncRef.current;
      if (sync && sync.videoId) {
        player.seekTo(sync.currentTime, true);
        if (sync.isPlaying) {
          player.playVideo();
        }
      }

      // Clear any previous interval
      if (seekIntervalRef.current) clearInterval(seekIntervalRef.current);

      // Poll for seek detection every 500ms
      seekIntervalRef.current = setInterval(() => {
        if (!player.getCurrentTime) return;
        const t = player.getCurrentTime();
        const diff = Math.abs(t - lastTimeRef.current);
        if (diff > 2 && !isRemoteAction.current) {
          socket.emit("seek", { roomId, currentTime: t });
        }
        lastTimeRef.current = t;
      }, 500);
    },
    [roomId]
  );

  // Cleanup seek interval on unmount
  useEffect(() => {
    return () => {
      if (seekIntervalRef.current) clearInterval(seekIntervalRef.current);
    };
  }, []);

  // ─── Video URL handling ────────────────────────────────────────

  const extractVideoId = (url) => {
    try {
      const u = new URL(url);
      if (u.hostname.includes("youtu.be")) return u.pathname.slice(1);
      if (u.searchParams.has("v")) return u.searchParams.get("v");
    } catch {
      if (/^[A-Za-z0-9_-]{11}$/.test(url)) return url;
    }
    return null;
  };

  const loadVideo = () => {
    const vid = extractVideoId(urlInput.trim());
    if (!vid) {
      alert("Invalid YouTube URL. Try pasting a full link.");
      return;
    }
    setVideoId(vid);
    setUrlInput("");
    socket.emit("video-change", { roomId, videoId: vid });
    const p = playerRef.current;
    if (p && p.cueVideoById) {
      p.cueVideoById(vid);
    }
  };

  // ─── Copy link ─────────────────────────────────────────────────

  const copyLink = () => {
    const link = `${window.location.origin}/room/${roomId}`;
    navigator.clipboard.writeText(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // ─── Render ────────────────────────────────────────────────────

  // If username hasn't been set yet, show the modal
  if (!username) {
    return (
      <div className="room room--loading">
        <UsernameModal onJoin={handleJoin} />
      </div>
    );
  }

  return (
    <div className="room">
      {/* Header */}
      <header className="room-header">
        <div className="room-header__left">
          <h2>📺 WatchTogether</h2>
          <span className="room-id">{roomId}</span>
        </div>
        <div className="room-header__right">
          <span className="room-header__user">Hi, {username}</span>
          <span className="user-count">
            <span className="dot" /> {users.length} online
          </span>
          <button className="btn btn-sm btn-outline" onClick={copyLink}>
            {copied ? "✅ Copied!" : "🔗 Copy Link"}
          </button>
          {/* Mobile chat toggle */}
          <button
            className="btn btn-sm btn-outline chat-mobile-toggle"
            onClick={() => setChatOpen(!chatOpen)}
          >
            💬
          </button>
        </div>
      </header>

      {/* Main content: video + chat side by side */}
      <div className="room-body">
        {/* Left: video + URL bar */}
        <main className="video-column">
          <div className="player-wrapper">
            {videoId ? (
              <YouTubePlayer
                videoId={videoId}
                onReady={onPlayerReady}
                onStateChange={onPlayerStateChange}
              />
            ) : (
              <div className="player-placeholder">
                <span>🎬</span>
                Paste a YouTube URL below to start watching
              </div>
            )}
          </div>

          <div className="url-bar">
            <input
              type="text"
              placeholder="Paste YouTube URL here..."
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && loadVideo()}
            />
            <button className="btn" onClick={loadVideo}>
              ▶ Load
            </button>
          </div>
        </main>

        {/* Right: chat panel */}
        <ChatPanel
          roomId={roomId}
          username={username}
          users={users}
          isMobileOpen={chatOpen}
          onToggleMobile={() => setChatOpen(false)}
        />
      </div>
    </div>
  );
}
