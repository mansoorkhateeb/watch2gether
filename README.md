<div align="center">

# 📺 WatchTogether

### Watch YouTube videos in perfect sync with your friends.

[![Node.js](https://img.shields.io/badge/Node.js-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![React](https://img.shields.io/badge/React-61DAFB?style=for-the-badge&logo=react&logoColor=black)](https://react.dev/)
[![Socket.io](https://img.shields.io/badge/Socket.io-010101?style=for-the-badge&logo=socketdotio&logoColor=white)](https://socket.io/)
[![Vite](https://img.shields.io/badge/Vite-646CFF?style=for-the-badge&logo=vite&logoColor=white)](https://vitejs.dev/)
[![Express](https://img.shields.io/badge/Express-000000?style=for-the-badge&logo=express&logoColor=white)](https://expressjs.com/)
[![YouTube API](https://img.shields.io/badge/YouTube_API-FF0000?style=for-the-badge&logo=youtube&logoColor=white)](https://developers.google.com/youtube/iframe_api_reference)

<br />

<p align="center">
  <b>No sign-up. No database. Just create a room, share the link, and watch together.</b>
</p>

<br />

<img src="https://img.shields.io/badge/status-active-brightgreen?style=flat-square" />
<img src="https://img.shields.io/badge/license-MIT-blue?style=flat-square" />
<img src="https://img.shields.io/badge/PRs-welcome-orange?style=flat-square" />

</div>

---

## ✨ Features

| Feature | Description |
|---|---|
| 🎬 **Instant Rooms** | Create a room with one click — no login required |
| 🔗 **Shareable Links** | Copy and share `/room/{id}` links with anyone |
| ▶️ **Real-Time Sync** | Play, pause, seek, and video changes sync across all users |
| 🧑‍🤝‍🧑 **Username Prompt** | Choose your display name — persisted in `localStorage` |
| 💬 **Live Chat** | YouTube-style side panel chat with timestamps |
| 🟢 **Online Users** | See who's in the room with a live user list |
| ⚡ **Quick Messages** | One-tap suggestions: *"Ready?"*, *"Start now"*, *"Pause pls"*, etc. |
| 📢 **System Messages** | Join/leave notifications in the chat |
| 📱 **Responsive** | Desktop: side-by-side layout · Mobile: slide-over chat drawer |
| 🧠 **Smart Late Join** | New joiners auto-sync to the current video, timestamp, and play state |

---

## 🏗️ Tech Stack

<table>
  <tr>
    <td align="center"><b>Frontend</b></td>
    <td>React 18 · React Router · Vite · Socket.io Client · YouTube IFrame API</td>
  </tr>
  <tr>
    <td align="center"><b>Backend</b></td>
    <td>Node.js · Express · Socket.io · UUID</td>
  </tr>
  <tr>
    <td align="center"><b>Storage</b></td>
    <td>In-memory (no database)</td>
  </tr>
  <tr>
    <td align="center"><b>Real-time</b></td>
    <td>WebSockets via Socket.io</td>
  </tr>
</table>

---

## 📂 Project Structure

```
watchtogether/
├── 📁 server/
│   ├── index.js            # Express + Socket.io server
│   └── rooms.js            # In-memory room state management
│
├── 📁 client/
│   ├── index.html
│   ├── vite.config.js
│   └── 📁 src/
│       ├── main.jsx         # React Router setup
│       ├── index.css        # Global styles
│       ├── socket.js        # Socket.io client singleton
│       ├── 📁 pages/
│       │   ├── Home.jsx     # Landing page + room creation
│       │   └── Room.jsx     # Watch room (video + chat layout)
│       └── 📁 components/
│           ├── YouTubePlayer.jsx   # YT IFrame API wrapper
│           ├── ChatPanel.jsx       # Side-panel chat with suggestions
│           └── UsernameModal.jsx   # Name prompt modal
│
├── package.json             # Root scripts (dev, install:all)
└── .gitignore
```

---

## 🚀 Getting Started

### Prerequisites

- **Node.js** ≥ 18
- **npm** ≥ 9

### Installation

```bash
# 1. Clone the repo
git clone https://github.com/mansoorkhateeb/watch2gether.git
cd watch2gether

# 2. Install all dependencies (root + server + client)
npm run install:all
```

### Running in Development

```bash
# Start both server and client concurrently
npm run dev
```

| Service  | URL                      |
|----------|--------------------------|
| Frontend | http://localhost:5173     |
| Backend  | http://localhost:3001     |

> The Vite dev server proxies `/api` and `/socket.io` to the backend automatically.

### Or run them separately

```bash
# Terminal 1 — Backend
npm run server

# Terminal 2 — Frontend
npm run client
```

---

## 🔄 How Sync Works

```
  User A (plays video)
       │
       ▼
  ┌──────────┐    socket.emit("play")    ┌──────────┐
  │  Client A │ ──────────────────────▶  │  Server  │
  └──────────┘                           └────┬─────┘
                                              │
                              socket.to(room).emit("play")
                              (broadcast to everyone EXCEPT sender)
                                              │
                                    ┌─────────┴─────────┐
                                    ▼                   ▼
                              ┌──────────┐        ┌──────────┐
                              │ Client B │        │ Client C │
                              └──────────┘        └──────────┘
```

### Key Design Decisions

| Concept | Implementation |
|---|---|
| **Source of truth** | Server holds room state (`videoId`, `currentTime`, `isPlaying`, `lastUpdate`) |
| **No event loops** | Events are broadcast to *others only* — never echoed back to the sender |
| **Remote action guard** | `isRemoteAction` ref prevents the local player's state-change callback from re-emitting |
| **Seek detection** | 500ms polling detects time jumps > 2s (YT API has no native seek event) |
| **Late joiner sync** | Server computes `currentTime + elapsed since lastUpdate` for accurate positioning |
| **Drift tolerance** | ~1–2 second tolerance to avoid constant re-syncing |

---

## 🔌 Socket Events

| Event | Direction | Payload | Description |
|---|---|---|---|
| `join-room` | Client → Server | `{ roomId, username }` | Join a room |
| `sync-state` | Server → Client | `{ videoId, currentTime, isPlaying, users }` | Initial state for new joiners |
| `video-change` | Bidirectional | `{ videoId }` | New YouTube video loaded |
| `play` | Bidirectional | `{ currentTime }` | Video played |
| `pause` | Bidirectional | `{ currentTime }` | Video paused |
| `seek` | Bidirectional | `{ currentTime }` | Playback position changed |
| `send-message` | Client → Server | `{ roomId, text }` | Chat message sent |
| `receive-message` | Server → Client | `{ type, username, text, timestamp }` | Chat message received |
| `user-joined` | Server → Client | `{ username, timestamp }` | User entered room |
| `user-left` | Server → Client | `{ username, timestamp }` | User left room |
| `users-list` | Server → Client | `[{ socketId, username }]` | Updated user list |

---

## ⚙️ Environment Variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3001` | Backend server port |
| `VITE_SERVER_URL` | `""` (proxy) | Socket.io server URL (for production) |

---

## 🛣️ Roadmap

- [ ] Host controls (only host can change video)
- [ ] Video queue / playlist
- [ ] Emoji reactions overlay
- [ ] Room passwords
- [ ] Persistent rooms with Redis
- [ ] Voice chat integration
- [ ] Custom video player skin

---

## 🤝 Contributing

Contributions are welcome! Feel free to open issues and pull requests.

1. Fork the repo
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

---

## 📄 License

This project is open source and available under the [MIT License](LICENSE).

---

<div align="center">

**Built with ❤️ and WebSockets**

<br />

<a href="https://github.com/mansoorkhateeb/watch2gether/issues">🐛 Report Bug</a>
·
<a href="https://github.com/mansoorkhateeb/watch2gether/issues">💡 Request Feature</a>

</div>
