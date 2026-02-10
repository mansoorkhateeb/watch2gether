import { useEffect, useRef, useCallback } from "react";
import Hls from "hls.js";

/**
 * HTML5Player — native HTML5 <video> player with HLS.js support.
 *
 * Used for:
 *   - Direct URL mode (.mp4, .webm, .ogg, .m3u8)
 *   - Local file mode (blob URLs from URL.createObjectURL)
 *   - Torrent mode (blob URLs from WebTorrent)
 *
 * Props:
 *   src           – video source URL (direct URL, blob, or HLS manifest)
 *   onPlay        – called when user plays locally
 *   onPause       – called when user pauses locally
 *   onSeeked      – called when user seeks locally
 *   onReady       – called with the <video> element ref when metadata is loaded
 *   isRemoteRef   – ref boolean to suppress re-emitting remote actions
 *
 * Sync approach:
 *   The parent (Room) attaches socket listeners that call video.play(),
 *   video.pause(), video.currentTime = X. The isRemoteRef guard prevents
 *   the local event handlers from re-emitting those back to the server.
 */
export default function HTML5Player({ src, onPlay, onPause, onSeeked, onReady, isRemoteRef }) {
  const videoRef = useRef(null);
  const hlsRef = useRef(null);

  // ─── Setup source (handles HLS vs native) ──────────────────────
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !src) return;

    // Destroy previous HLS instance if any
    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }

    const isHLS = src.includes(".m3u8");

    if (isHLS && Hls.isSupported()) {
      const hls = new Hls();
      hls.loadSource(src);
      hls.attachMedia(video);
      hlsRef.current = hls;
    } else {
      // Native playback for mp4, webm, ogg, blob URLs, and Safari HLS
      video.src = src;
    }

    return () => {
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
    };
  }, [src]);

  // ─── Event handlers ────────────────────────────────────────────
  const handleLoadedMetadata = useCallback(() => {
    if (onReady) onReady(videoRef.current);
  }, [onReady]);

  const handlePlay = useCallback(() => {
    if (isRemoteRef?.current) return;
    const video = videoRef.current;
    if (video && onPlay) onPlay(video.currentTime);
  }, [onPlay, isRemoteRef]);

  const handlePause = useCallback(() => {
    if (isRemoteRef?.current) return;
    const video = videoRef.current;
    // Ignore pause events fired at the very end of the video
    if (video && !video.ended && onPause) onPause(video.currentTime);
  }, [onPause, isRemoteRef]);

  const handleSeeked = useCallback(() => {
    if (isRemoteRef?.current) return;
    const video = videoRef.current;
    if (video && onSeeked) onSeeked(video.currentTime);
  }, [onSeeked, isRemoteRef]);

  return (
    <video
      ref={videoRef}
      controls
      className="html5-video"
      onLoadedMetadata={handleLoadedMetadata}
      onPlay={handlePlay}
      onPause={handlePause}
      onSeeked={handleSeeked}
    />
  );
}
