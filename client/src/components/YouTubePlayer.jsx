import { useEffect, useRef } from "react";

/**
 * YouTubePlayer — wraps the YouTube IFrame Player API.
 *
 * Props:
 *   videoId       – YouTube video ID to load
 *   onReady       – called with the YT player instance when ready
 *   onStateChange – called on every YT state change event
 *
 * The component:
 *  1. Dynamically loads the IFrame API script (once).
 *  2. Creates a new YT.Player targeting a <div>.
 *  3. Cleans up on unmount.
 *
 * The parent (Room) holds the player ref and uses it for remote sync.
 */
let apiReady = false;
let apiLoading = false;
const apiCallbacks = [];

function loadYouTubeAPI() {
  return new Promise((resolve) => {
    if (apiReady) return resolve();
    apiCallbacks.push(resolve);
    if (apiLoading) return;
    apiLoading = true;

    const tag = document.createElement("script");
    tag.src = "https://www.youtube.com/iframe_api";
    document.body.appendChild(tag);

    window.onYouTubeIframeAPIReady = () => {
      apiReady = true;
      apiCallbacks.forEach((cb) => cb());
      apiCallbacks.length = 0;
    };
  });
}

export default function YouTubePlayer({ videoId, onReady, onStateChange }) {
  const containerRef = useRef(null);
  const playerInstanceRef = useRef(null);
  const prevVideoIdRef = useRef(videoId);

  useEffect(() => {
    let destroyed = false;

    loadYouTubeAPI().then(() => {
      if (destroyed) return;

      playerInstanceRef.current = new window.YT.Player(containerRef.current, {
        videoId,
        playerVars: {
          autoplay: 0,
          controls: 1,
          modestbranding: 1,
          rel: 0,
          fs: 1,
        },
        events: {
          onReady: (e) => {
            if (!destroyed) onReady(e.target);
          },
          onStateChange: (e) => {
            if (!destroyed) onStateChange(e);
          },
        },
      });
    });

    return () => {
      destroyed = true;
      if (playerInstanceRef.current && playerInstanceRef.current.destroy) {
        playerInstanceRef.current.destroy();
      }
    };
    // We intentionally only run this once on mount.
    // Video changes are handled imperatively via cueVideoById.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // When videoId prop changes (not on initial mount), cue the new video
  useEffect(() => {
    if (prevVideoIdRef.current !== videoId && playerInstanceRef.current) {
      playerInstanceRef.current.cueVideoById(videoId);
      prevVideoIdRef.current = videoId;
    }
  }, [videoId]);

  return <div ref={containerRef} />;
}
