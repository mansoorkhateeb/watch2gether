import { memo } from "react";

/**
 * MediaModeSelector — tab bar to switch between media sources.
 *
 * Props:
 *   mode      – current mode string
 *   onChange  – called with the new mode string
 */

const MODES = [
  { key: "youtube",  label: "YouTube",    icon: "▶" },
  { key: "url",      label: "Direct URL", icon: "🔗" },
  { key: "local",    label: "Local File", icon: "📁" },
  { key: "torrent",  label: "Torrent",    icon: "🧲" },
];

function MediaModeSelector({ mode, onChange }) {
  return (
    <div className="media-mode-selector">
      {MODES.map((m) => (
        <button
          key={m.key}
          className={`mode-tab ${mode === m.key ? "active" : ""}`}
          onClick={() => onChange(m.key)}
          title={m.label}
        >
          <span className="mode-icon">{m.icon}</span>
          <span className="mode-label">{m.label}</span>
        </button>
      ))}
    </div>
  );
}

export default memo(MediaModeSelector);
