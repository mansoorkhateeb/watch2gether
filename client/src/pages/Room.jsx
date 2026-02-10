import { useParams } from "react-router-dom";
import { useEffect, useState, useRef, useCallback } from "react";
import socket from "../socket";
import YouTubePlayer from "../components/YouTubePlayer";
import HTML5Player from "../components/HTML5Player";
import TorrentPlayer from "../components/TorrentPlayer";
import MediaModeSelector from "../components/MediaModeSelector";
import ChatPanel from "../components/ChatPanel";
import UsernameModal from "../components/UsernameModal";

/**
 * Room — main watch room page (v3).
 *
 * Supports four media source modes:
 *   1. YouTube   — classic YT IFrame player
 *   2. Direct URL — mp4, webm, ogg, m3u8 via HTML5 <video> + HLS.js
 *   3. Local File — user picks a local video, played via blob URL
 *   4. Torrent    — magnet link played via WebTorrent
 *
 * Sync works identically for all modes:
 *   play / pause / seek events carry { roomId, currentTime }.
 *   video-change carries { roomId, sourceType, videoId?, url?, magnetURI? }.
 *
 * Layout: side-by-side (video | chat) on desktop, stacked on mobile.
 */
export default function Room() {
  const { roomId } = useParams();

  // ─── State ─────────────────────────────────────────────────────
  const [username, setUsername] = useState(null); // null = modal still showing
  const [mediaMode, setMediaMode] = useState("youtube"); // youtube | url | local | torrent

  // Source data (one per mode)
  const [videoId, setVideoId] = useState(null); // YouTube
  const [directUrl, setDirectUrl] = useState(null); // Direct URL / Local file blob
  const [magnetURI, setMagnetURI] = useState(null); // Torrent

  // Input fields
  const [urlInput, setUrlInput] = useState("");

  const [users, setUsers] = useState([]);
  const [copied, setCopied] = useState(false);
  const [chatOpen, setChatOpen] = useState(false); // mobile toggle

  // ─── Refs ──────────────────────────────────────────────────────
  // playerRef: for YouTube = YT.Player instance; for HTML5/torrent = <video> element
  const playerRef = useRef(null);

  // Guard: ignore remote events while we're applying a remote command
  const isRemoteAction = useRef(false);

  // Keep a ref to initial sync state so we can apply it when the player is ready
  const syncRef = useRef(null);

  // Seek detection refs (used by both YouTube polling and HTML5 onSeeked)
  const lastTimeRef = useRef(0);
  const seekIntervalRef = useRef(null);

  // ─── Helpers: control whichever player is active ───────────────

  /** Seek the current player to a given time */
  const seekTo = useCallback((time) => {
    const p = playerRef.current;
    if (!p) return;
    // YouTube player has seekTo(); HTML5 <video> has .currentTime
    if (typeof p.seekTo === "function") {
      p.seekTo(time, true);
    } else if ("currentTime" in p) {
      p.currentTime = time;
    }
  }, []);

  /** Play the current player */
  const playPlayer = useCallback(() => {
    const p = playerRef.current;
    if (!p) return;
    if (typeof p.playVideo === "function") {
      p.playVideo();
    } else if (typeof p.play === "function") {
      p.play().catch(() => {}); // autoplay might be blocked
    }
  }, []);

  /** Pause the current player */
  const pausePlayer = useCallback(() => {
    const p = playerRef.current;
    if (!p) return;
    if (typeof p.pauseVideo === "function") {
      p.pauseVideo();
    } else if (typeof p.pause === "function") {
      p.pause();
    }
  }, []);

  // ─── Username callback ─────────────────────────────────────────
  const handleJoin = useCallback((name) => setUsername(name), []);

  // ─── Socket setup (runs once username is set) ──────────────────
  useEffect(() => {
    if (!username) return;

    if (!socket.connected) socket.connect();
    socket.emit("join-room", { roomId, username });

    // Initial state from server (for late joiners)
    socket.on("sync-state", (state) => {
      console.log("[sync-state]", state);
      const mode = state.sourceType || "youtube";
      setMediaMode(mode);

      if (mode === "youtube" && state.videoId) {
        setVideoId(state.videoId);
      } else if (mode === "url" && state.url) {
        setDirectUrl(state.url);
      } else if (mode === "torrent" && state.magnetURI) {
        setMagnetURI(state.magnetURI);
      }
      // local mode: each user must pick their own file, nothing to restore

      syncRef.current = state;
      if (state.users) setUsers(state.users);
    });

    socket.on("users-list", (list) => setUsers(list));

    // Someone changed the video / source
    socket.on("video-change", ({ sourceType, videoId: vid, url, magnetURI: mag }) => {
      console.log("[video-change]", sourceType, vid || url || mag || "(local)");
      isRemoteAction.current = true;

      setMediaMode(sourceType || "youtube");

      if (sourceType === "youtube") {
        setVideoId(vid);
        setTimeout(() => {
          const p = playerRef.current;
          if (p && p.cueVideoById) p.cueVideoById(vid);
          isRemoteAction.current = false;
        }, 100);
      } else if (sourceType === "url") {
        setDirectUrl(url);
        setTimeout(() => (isRemoteAction.current = false), 300);
      } else if (sourceType === "torrent") {
        setMagnetURI(mag);
        setTimeout(() => (isRemoteAction.current = false), 300);
      } else {
        // local — nothing to propagate, each user has their own file
        setTimeout(() => (isRemoteAction.current = false), 100);
      }
    });

    socket.on("play", ({ currentTime }) => {
      console.log("[remote play]", currentTime);
      isRemoteAction.current = true;
      seekTo(currentTime);
      playPlayer();
      setTimeout(() => (isRemoteAction.current = false), 500);
    });

    socket.on("pause", ({ currentTime }) => {
      console.log("[remote pause]", currentTime);
      isRemoteAction.current = true;
      seekTo(currentTime);
      pausePlayer();
      setTimeout(() => (isRemoteAction.current = false), 500);
    });

    socket.on("seek", ({ currentTime }) => {
      console.log("[remote seek]", currentTime);
      isRemoteAction.current = true;
      seekTo(currentTime);
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
  }, [roomId, username, seekTo, playPlayer, pausePlayer]);

  // ─── YouTube player callbacks ──────────────────────────────────

  const onYTStateChange = useCallback(
    (event) => {
      if (isRemoteAction.current) return;
      const p = event.target;
      const currentTime = p.getCurrentTime();
      const state = event.data;
      if (state === 1) socket.emit("play", { roomId, currentTime });
      else if (state === 2) socket.emit("pause", { roomId, currentTime });
    },
    [roomId]
  );

  const onYTReady = useCallback(
    (player) => {
      playerRef.current = player;

      const sync = syncRef.current;
      if (sync && sync.videoId) {
        player.seekTo(sync.currentTime, true);
        if (sync.isPlaying) player.playVideo();
      }

      // Clear any previous interval
      if (seekIntervalRef.current) clearInterval(seekIntervalRef.current);

      // Poll for seek detection every 500ms (YT API has no native seek event)
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

  // ─── HTML5 / Torrent player callbacks ──────────────────────────

  const onHTML5Ready = useCallback(
    (videoEl) => {
      playerRef.current = videoEl;

      const sync = syncRef.current;
      if (sync && (sync.url || sync.magnetURI || sync.sourceType === "local")) {
        videoEl.currentTime = sync.currentTime || 0;
        if (sync.isPlaying) videoEl.play().catch(() => {});
      }
    },
    []
  );

  const onHTML5Play = useCallback(
    (currentTime) => {
      socket.emit("play", { roomId, currentTime });
    },
    [roomId]
  );

  const onHTML5Pause = useCallback(
    (currentTime) => {
      socket.emit("pause", { roomId, currentTime });
    },
    [roomId]
  );

  const onHTML5Seeked = useCallback(
    (currentTime) => {
      socket.emit("seek", { roomId, currentTime });
    },
    [roomId]
  );

  // Cleanup seek interval on unmount
  useEffect(() => () => {
    if (seekIntervalRef.current) clearInterval(seekIntervalRef.current);
  }, []);

  // ─── Video URL handling ────────────────────────────────────────

  const extractYouTubeId = (url) => {
    try {
      const u = new URL(url);
      if (u.hostname.includes("youtu.be")) return u.pathname.slice(1);
      if (u.searchParams.has("v")) return u.searchParams.get("v");
    } catch {
      if (/^[A-Za-z0-9_-]{11}$/.test(url)) return url;
    }
    return null;
  };

  const loadMedia = () => {
    const raw = urlInput.trim();
    if (!raw) return;

    if (mediaMode === "youtube") {
      const vid = extractYouTubeId(raw);
      if (!vid) {
        alert("Invalid YouTube URL. Try pasting a full link or an 11-char video ID.");
        return;
      }
      setVideoId(vid);
      setUrlInput("");
      socket.emit("video-change", { roomId, sourceType: "youtube", videoId: vid });
      const p = playerRef.current;
      if (p && p.cueVideoById) p.cueVideoById(vid);
    } else if (mediaMode === "url") {
      // Validate URL
      try { new URL(raw); } catch {
        alert("Please enter a valid video URL (must start with http:// or https://).");
        return;
      }
      setDirectUrl(raw);
      setUrlInput("");
      socket.emit("video-change", { roomId, sourceType: "url", url: raw });
    } else if (mediaMode === "torrent") {
      if (!raw.startsWith("magnet:")) {
        alert("Please enter a valid magnet link (must start with magnet:).");
        return;
      }
      setMagnetURI(raw);
      setUrlInput("");
      socket.emit("video-change", { roomId, sourceType: "torrent", magnetURI: raw });
    }
  };

  const handleLocalFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const blob = URL.createObjectURL(file);
    setDirectUrl(blob);
    setMediaMode("local");
    // Notify others that the source changed to local (they must pick their own file)
    socket.emit("video-change", { roomId, sourceType: "local" });
  };

  // ─── Copy link ─────────────────────────────────────────────────

  const copyLink = () => {
    const link = `${window.location.origin}/room/${roomId}`;
    navigator.clipboard.writeText(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // ─── Determine what to render in the player area ───────────────

  const hasMedia =
    (mediaMode === "youtube" && videoId) ||
    (mediaMode === "url" && directUrl) ||
    (mediaMode === "local" && directUrl) ||
    (mediaMode === "torrent" && magnetURI);

  const placeholderText = {
    youtube: "Paste a YouTube URL below to start watching",
    url: "Enter a direct video URL below (mp4, webm, m3u8…)",
    local: "Choose a local video file below",
    torrent: "Paste a magnet link below to stream",
  };

  const inputPlaceholder = {
    youtube: "Paste YouTube URL here…",
    url: "https://example.com/video.mp4",
    torrent: "magnet:?xt=urn:btih:…",
  };

  // ─── Render ────────────────────────────────────────────────────

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
        <main className="video-column">
          {/* Mode selector tabs */}
          <MediaModeSelector mode={mediaMode} onChange={setMediaMode} />

          {/* Player area */}
          <div className="player-wrapper">
            {!hasMedia ? (
              <div className="player-placeholder">
                <span>🎬</span>
                {placeholderText[mediaMode]}
              </div>
            ) : mediaMode === "youtube" ? (
              <YouTubePlayer
                videoId={videoId}
                onReady={onYTReady}
                onStateChange={onYTStateChange}
              />
            ) : mediaMode === "torrent" ? (
              <TorrentPlayer
                magnetURI={magnetURI}
                onPlay={onHTML5Play}
                onPause={onHTML5Pause}
                onSeeked={onHTML5Seeked}
                onReady={onHTML5Ready}
                isRemoteRef={isRemoteAction}
              />
            ) : (
              /* url or local — both use HTML5Player with a src */
              <HTML5Player
                src={directUrl}
                onPlay={onHTML5Play}
                onPause={onHTML5Pause}
                onSeeked={onHTML5Seeked}
                onReady={onHTML5Ready}
                isRemoteRef={isRemoteAction}
              />
            )}
          </div>

          {/* Local file notice */}
          {mediaMode === "local" && (
            <div className="media-notice">
              ℹ️ Each person must select the <strong>same video file</strong> on their own device. The file is never uploaded — only playback is synced.
            </div>
          )}

          {/* Input bar — changes based on mode */}
          {mediaMode === "local" ? (
            <div className="url-bar">
              <label className="file-input-wrapper">
                <span className="btn">📁 Choose File</span>
                <input
                  type="file"
                  accept="video/*"
                  onChange={handleLocalFile}
                  hidden
                />
              </label>
              {directUrl && <span className="file-name">✅ File loaded</span>}
            </div>
          ) : (
            <div className="url-bar">
              <input
                type="text"
                placeholder={inputPlaceholder[mediaMode] || ""}
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && loadMedia()}
              />
              <button className="btn" onClick={loadMedia}>
                ▶ Load
              </button>
            </div>
          )}
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
