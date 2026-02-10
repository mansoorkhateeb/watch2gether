/**
 * torrent.js — Server-side torrent streaming via WebTorrent.
 *
 * Why server-side?
 *   WebTorrent in the browser can ONLY use WebRTC peers (other browser clients).
 *   Regular BitTorrent clients (qBittorrent, Transmission, etc.) use TCP/UDP,
 *   which browsers cannot access. So a torrent with 100+ TCP seeders will have
 *   ZERO peers visible to a browser-based WebTorrent client.
 *
 *   By running WebTorrent on the Node.js server, we can connect to ALL peers
 *   (TCP + UDP + WebRTC) and stream the video to the browser over plain HTTP.
 *
 * Endpoints (mounted in index.js):
 *   POST /api/torrent/add       — start downloading a magnet URI
 *   GET  /api/torrent/status     — get progress, speed, peers, file info
 *   GET  /api/torrent/stream     — stream the video file (supports Range requests)
 *   POST /api/torrent/remove     — stop and clean up
 */

// WebTorrent v2+ is ESM-only with top-level await, so we CANNOT require() it.
// Instead, we use a lazy dynamic import() and cache the client instance.
let clientPromise = null;

function getClient() {
  if (!clientPromise) {
    clientPromise = import("webtorrent").then((mod) => {
      const WebTorrent = mod.default || mod;
      return new WebTorrent();
    });
  }
  return clientPromise;
}

// We only handle one active torrent at a time for simplicity.
// In a multi-room setup, you'd map roomId -> torrent.
let activeTorrent = null;
let activeFile = null;
let activeMagnet = null;
let addError = null;

const VIDEO_EXTS = [".mp4", ".webm", ".mkv", ".avi", ".ogg", ".m4v", ".mov", ".m2ts", ".ts"];

/**
 * Find the largest video file in a torrent.
 */
function findVideoFile(torrent) {
  return torrent.files
    .filter((f) => VIDEO_EXTS.some((ext) => f.name.toLowerCase().endsWith(ext)))
    .sort((a, b) => b.length - a.length)[0] || null;
}

/**
 * Set up Express routes on the given app.
 */
function setupTorrentRoutes(app) {
  /**
   * POST /api/torrent/add
   * Body: { magnetURI: "magnet:?xt=..." }
   *
   * Starts downloading. Returns immediately; poll /status for progress.
   */
  app.post("/api/torrent/add", async (req, res) => {
    const { magnetURI } = req.body;
    if (!magnetURI) return res.status(400).json({ error: "magnetURI is required" });

    // If same magnet is already active, just return ok
    if (activeMagnet === magnetURI && activeTorrent) {
      return res.json({ ok: true, status: "already-active" });
    }

    const client = await getClient();

    // Remove previous torrent if any
    if (activeTorrent) {
      try { client.remove(activeTorrent); } catch (_) {}
      activeTorrent = null;
      activeFile = null;
      activeMagnet = null;
      addError = null;
    }

    activeMagnet = magnetURI;
    addError = null;

    console.log(`🧲 Adding torrent: ${magnetURI.slice(0, 80)}…`);

    client.add(magnetURI, { destroyStoreOnDestroy: true }, (torrent) => {
      console.log(`✅ Torrent ready: ${torrent.name} (${torrent.files.length} files)`);
      activeTorrent = torrent;
      activeFile = findVideoFile(torrent);

      if (activeFile) {
        // Prioritize the video file so it downloads first
        activeFile.select();
        console.log(`🎬 Video file: ${activeFile.name} (${(activeFile.length / 1024 / 1024).toFixed(1)} MB)`);
      } else {
        console.log(`⚠️  No video file found. Files: ${torrent.files.map(f => f.name).join(", ")}`);
      }

      torrent.on("error", (err) => {
        console.error("Torrent error:", err.message);
        addError = err.message;
      });
    });

    // Listen for add errors (e.g., invalid magnet)
    const onError = (err) => {
      console.error("WebTorrent client error:", err.message);
      addError = err.message;
    };
    client.once("error", onError);

    // Clean up the one-time listener after 30s
    setTimeout(() => client.removeListener("error", onError), 30000);

    res.json({ ok: true, status: "adding" });
  });

  /**
   * GET /api/torrent/status
   *
   * Returns current torrent state: progress, speed, peers, file info.
   */
  app.get("/api/torrent/status", (_req, res) => {
    if (addError) {
      return res.json({
        status: "error",
        error: addError,
      });
    }

    if (!activeTorrent) {
      return res.json({
        status: activeMagnet ? "connecting" : "idle",
        progress: 0,
        speed: 0,
        peers: 0,
        fileName: null,
        fileSize: 0,
      });
    }

    const t = activeTorrent;
    const f = activeFile;

    res.json({
      status: f ? (t.progress >= 0.01 ? "streaming" : "downloading") : "no-video",
      progress: Math.round(t.progress * 10000) / 100, // 2 decimal places
      speed: t.downloadSpeed,
      uploadSpeed: t.uploadSpeed,
      peers: t.numPeers,
      fileName: f ? f.name : null,
      fileSize: f ? f.length : 0,
      downloaded: t.downloaded,
      torrentName: t.name,
      files: t.files.map((f) => ({ name: f.name, size: f.length })),
      ratio: t.ratio,
      timeRemaining: t.timeRemaining,
      ready: f != null && t.progress >= 0.005, // ready to stream
    });
  });

  /**
   * GET /api/torrent/stream
   *
   * Streams the video file over HTTP. Supports Range requests for seeking.
   */
  app.get("/api/torrent/stream", (req, res) => {
    if (!activeFile) {
      return res.status(404).json({ error: "No video file available. Add a torrent first." });
    }

    const file = activeFile;
    const fileSize = file.length;

    // Determine MIME type
    const ext = file.name.split(".").pop().toLowerCase();
    const mimeMap = {
      mp4: "video/mp4",
      webm: "video/webm",
      mkv: "video/x-matroska",
      avi: "video/x-msvideo",
      ogg: "video/ogg",
      m4v: "video/mp4",
      mov: "video/quicktime",
      ts: "video/mp2t",
      m2ts: "video/mp2t",
    };
    const contentType = mimeMap[ext] || "video/mp4";

    const range = req.headers.range;

    if (range) {
      // Parse Range header
      const parts = range.replace(/bytes=/, "").split("-");
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      const chunkSize = end - start + 1;

      res.writeHead(206, {
        "Content-Range": `bytes ${start}-${end}/${fileSize}`,
        "Accept-Ranges": "bytes",
        "Content-Length": chunkSize,
        "Content-Type": contentType,
      });

      const stream = file.createReadStream({ start, end });
      stream.pipe(res);

      stream.on("error", (err) => {
        console.error("Stream error:", err.message);
        if (!res.headersSent) res.status(500).end();
      });
    } else {
      res.writeHead(200, {
        "Content-Length": fileSize,
        "Content-Type": contentType,
        "Accept-Ranges": "bytes",
      });

      const stream = file.createReadStream();
      stream.pipe(res);

      stream.on("error", (err) => {
        console.error("Stream error:", err.message);
        if (!res.headersSent) res.status(500).end();
      });
    }
  });

  /**
   * POST /api/torrent/remove
   *
   * Stop and remove the active torrent.
   */
  app.post("/api/torrent/remove", async (_req, res) => {
    if (activeTorrent) {
      const client = await getClient();
      try { client.remove(activeTorrent); } catch (_) {}
    }
    activeTorrent = null;
    activeFile = null;
    activeMagnet = null;
    addError = null;
    res.json({ ok: true });
  });
}

module.exports = { setupTorrentRoutes };
