import { useEffect, useRef, useState, useCallback } from "react";

/**
 * TorrentPlayer — streams video from a magnet link via the SERVER.
 *
 * Architecture:
 *   Browser WebTorrent can only reach WebRTC peers (other browsers).
 *   Regular BitTorrent clients (qBittorrent etc.) use TCP/UDP which
 *   browsers can't access. So we run WebTorrent on the Node.js server,
 *   which connects to ALL peers (TCP + UDP + WebRTC), and streams the
 *   video to the browser over plain HTTP.
 *
 * Flow:
 *   1. POST /api/torrent/add   — tell server to start the torrent
 *   2. GET  /api/torrent/status — poll progress (peers, speed, etc.)
 *   3. GET  /api/torrent/stream — <video src="..."> HTTP stream with Range support
 *
 * Props:
 *   magnetURI, onPlay, onPause, onSeeked, onReady, isRemoteRef
 */

function formatBytes(bytes) {
  if (!bytes || bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return (bytes / Math.pow(k, i)).toFixed(1) + " " + sizes[i];
}

function formatTime(sec) {
  if (!sec || !isFinite(sec) || sec < 0) return "--:--";
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  if (h > 0)
    return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export default function TorrentPlayer({
  magnetURI,
  onPlay,
  onPause,
  onSeeked,
  onReady,
  isRemoteRef,
}) {
  const videoRef = useRef(null);
  const streamReadyRef = useRef(false);

  // Status: connecting | downloading | ready | error | no-video
  const [status, setStatus] = useState("connecting");
  const [statusDetail, setStatusDetail] = useState("Sending magnet to server…");
  const [progress, setProgress] = useState(0);
  const [speed, setSpeed] = useState(0);
  const [peers, setPeers] = useState(0);
  const [fileName, setFileName] = useState("");
  const [fileSize, setFileSize] = useState(0);
  const [downloaded, setDownloaded] = useState(0);
  const [eta, setEta] = useState(null);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!magnetURI) return;
    let destroyed = false;
    const startTime = Date.now();
    streamReadyRef.current = false;

    // Reset state
    setStatus("connecting");
    setStatusDetail("Sending magnet to server…");
    setProgress(0);
    setSpeed(0);
    setPeers(0);
    setFileName("");
    setFileSize(0);
    setDownloaded(0);
    setEta(null);
    setElapsed(0);

    // Elapsed timer
    const elapsedInterval = setInterval(() => {
      if (destroyed) return;
      setElapsed(Math.floor((Date.now() - startTime) / 1000));
    }, 1000);

    let pollInterval = null;

    // Step 1: Tell the server to start downloading the torrent
    fetch("/api/torrent/add", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ magnetURI }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (destroyed) return;
        if (data.error) {
          setStatus("error");
          setStatusDetail(data.error);
          return;
        }

        setStatusDetail("Server is connecting to peers…");

        // Step 2: Poll status until the server has enough data to stream
        pollInterval = setInterval(() => {
          if (destroyed) {
            clearInterval(pollInterval);
            return;
          }

          fetch("/api/torrent/status")
            .then((r) => r.json())
            .then((s) => {
              if (destroyed) return;

              // Update stats
              setProgress(s.progress || 0);
              setSpeed(s.speed || 0);
              setPeers(s.peers || 0);
              setDownloaded(s.downloaded || 0);

              if (s.fileName) setFileName(s.fileName);
              if (s.fileSize) setFileSize(s.fileSize);

              // ETA
              if (s.timeRemaining && isFinite(s.timeRemaining) && s.timeRemaining > 0) {
                setEta(Math.round(s.timeRemaining / 1000));
              } else {
                setEta(null);
              }

              // Handle statuses
              if (s.status === "error") {
                setStatus("error");
                setStatusDetail(s.error || "Server torrent error");
                clearInterval(pollInterval);
                clearInterval(elapsedInterval);
              } else if (s.status === "no-video") {
                setStatus("no-video");
                const fileList = s.files
                  ? s.files.map((f) => f.name).join(", ")
                  : "";
                setStatusDetail(
                  `No video files found.${fileList ? ` Files: ${fileList}` : ""}`
                );
                clearInterval(pollInterval);
                clearInterval(elapsedInterval);
              } else if (s.status === "connecting") {
                setStatus("connecting");
                setStatusDetail("Server is connecting to peers…");
              } else if (
                s.status === "downloading" ||
                s.status === "streaming"
              ) {
                setStatus("downloading");
                if (s.peers > 0) {
                  setStatusDetail(
                    `Downloading from ${s.peers} peer${s.peers !== 1 ? "s" : ""}…`
                  );
                } else {
                  setStatusDetail("Waiting for peers…");
                }

                // Ready to stream? Set the video src
                if (s.ready && !streamReadyRef.current) {
                  streamReadyRef.current = true;
                  setStatus("ready");
                  clearInterval(pollInterval);
                  clearInterval(elapsedInterval);

                  // Point the <video> at the server's stream endpoint
                  if (videoRef.current) {
                    videoRef.current.src = "/api/torrent/stream";
                    videoRef.current.load();
                  }
                }
              }
            })
            .catch((err) => {
              console.error("Status poll error:", err);
            });
        }, 800);
      })
      .catch((err) => {
        if (!destroyed) {
          setStatus("error");
          setStatusDetail(`Failed to reach server: ${err.message}`);
        }
      });

    return () => {
      destroyed = true;
      if (elapsedInterval) clearInterval(elapsedInterval);
      if (pollInterval) clearInterval(pollInterval);
      // Tell server to clean up (fire and forget)
      fetch("/api/torrent/remove", { method: "POST" }).catch(() => {});
    };
  }, [magnetURI]);

  // ─── Event handlers ────────────────────────────────────────────
  const handleLoadedMetadata = useCallback(() => {
    if (onReady) onReady(videoRef.current);
  }, [onReady]);

  const handlePlay = useCallback(() => {
    if (isRemoteRef?.current) return;
    if (onPlay) onPlay(videoRef.current.currentTime);
  }, [onPlay, isRemoteRef]);

  const handlePause = useCallback(() => {
    if (isRemoteRef?.current) return;
    const video = videoRef.current;
    if (video && !video.ended && onPause) onPause(video.currentTime);
  }, [onPause, isRemoteRef]);

  const handleSeeked = useCallback(() => {
    if (isRemoteRef?.current) return;
    if (onSeeked) onSeeked(videoRef.current.currentTime);
  }, [onSeeked, isRemoteRef]);

  return (
    <div className="torrent-player">
      {/* Status overlay — shown until video is ready */}
      {status !== "ready" && (
        <div className="torrent-overlay">
          {/* Step indicator */}
          <div className="torrent-steps">
            <div
              className={`torrent-step ${
                status === "connecting"
                  ? "active"
                  : ["downloading", "ready"].includes(status)
                    ? "done"
                    : ""
              }`}
            >
              <span className="step-dot" />
              <span>Connect</span>
            </div>
            <div className="step-line" />
            <div
              className={`torrent-step ${
                status === "downloading"
                  ? "active"
                  : status === "ready"
                    ? "done"
                    : ""
              }`}
            >
              <span className="step-dot" />
              <span>Download</span>
            </div>
            <div className="step-line" />
            <div className={`torrent-step ${status === "ready" ? "done" : ""}`}>
              <span className="step-dot" />
              <span>Stream</span>
            </div>
          </div>

          {/* Spinner */}
          {status !== "error" && status !== "no-video" && (
            <div className="torrent-spinner" />
          )}

          {/* Main status text */}
          <p className="torrent-status-text">{statusDetail}</p>

          {/* Progress bar */}
          {(status === "connecting" || status === "downloading") && (
            <div className="torrent-progress-bar-wrap">
              <div className="torrent-progress-bar">
                <div
                  className={`torrent-progress-fill ${
                    status === "connecting" ? "indeterminate" : ""
                  }`}
                  style={
                    status === "downloading"
                      ? { width: `${Math.max(progress, 1)}%` }
                      : {}
                  }
                />
              </div>
              {status === "downloading" && progress > 0 && (
                <span className="torrent-progress-pct">
                  {progress.toFixed(1)}%
                </span>
              )}
            </div>
          )}

          {/* Stats row */}
          {(status === "downloading" ||
            (status === "connecting" && peers > 0)) && (
            <div className="torrent-stats">
              {peers > 0 && (
                <span className="torrent-stat">
                  👥 {peers} peer{peers !== 1 ? "s" : ""}
                </span>
              )}
              {speed > 0 && (
                <span className="torrent-stat">
                  ⬇️ {formatBytes(speed)}/s
                </span>
              )}
              {downloaded > 0 && fileSize > 0 && (
                <span className="torrent-stat">
                  📦 {formatBytes(downloaded)} / {formatBytes(fileSize)}
                </span>
              )}
              {eta !== null && eta > 0 && (
                <span className="torrent-stat">
                  ⏱️ ~{formatTime(eta)} left
                </span>
              )}
            </div>
          )}

          {/* File name */}
          {fileName && <p className="torrent-file-name">📄 {fileName}</p>}

          {/* Hint */}
          {status === "connecting" && elapsed > 20 && (
            <p className="torrent-hint">
              Taking a while — the server is searching for peers via DHT &
              trackers.
            </p>
          )}

          {/* Elapsed time */}
          <p className="torrent-elapsed">⏳ Elapsed: {formatTime(elapsed)}</p>

          {/* Error states */}
          {status === "error" && (
            <p className="torrent-error">❌ {statusDetail}</p>
          )}
          {status === "no-video" && (
            <p className="torrent-error">🚫 {statusDetail}</p>
          )}
        </div>
      )}

      <video
        ref={videoRef}
        controls
        className="html5-video"
        onLoadedMetadata={handleLoadedMetadata}
        onPlay={handlePlay}
        onPause={handlePause}
        onSeeked={handleSeeked}
      />
    </div>
  );
}
