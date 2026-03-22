# 🔥 Flare

**Ephemeral stories and encrypted DMs on Nostr.**

No servers. No accounts. No algorithms. Just your keys and 24 hours.

[![Live](https://img.shields.io/badge/live-flarenos.pages.dev-f97316?style=flat-square)](https://flarenos.pages.dev)
[![Nostr](https://img.shields.io/badge/built%20on-nostr-8b5cf6?style=flat-square)](https://nostr.com)
[![License](https://img.shields.io/badge/license-MIT-22c55e?style=flat-square)](LICENSE)

---

## What is Flare?

Flare is a Snapchat-style social app built entirely on the Nostr protocol. Stories disappear after 24 hours. Messages are end-to-end encrypted. Your identity is a keypair — no email, no phone number, no central server can take it from you.

---

## Features

- **📸 Stories** — Post photos and videos that expire after 24h. Kind 30923 with NIP-40 expiration.
- **✏️ Story editor** — Text overlays, freehand drawing, emoji stickers.
- **👻 Snap DMs** — Send photos and videos directly inside a chat thread. Choose View Once (disappears after opening) or Keep in Chat before sending.
- **🔒 Encrypted DMs** — Full NIP-17 implementation: kind 14 rumors sealed in kind 13, gift-wrapped in kind 1059 with ephemeral keys.
- **📬 Inbox routing** — Publishes to each recipient's kind 10050 DM relay list.
- **🗺️ Outbox model** — Reads from NIP-65 relay lists, publishes to your write relays.
- **🗂️ Media hosting** — Blossom (BUD-02) with SHA-256 auth.
- **📱 PWA** — Installable on iOS and Android as a standalone app.
- **🔑 Flexible auth** — Browser extension (NIP-07), nsec, or remote bunker (NIP-46).

---

## Screens

| Screen | Description |
|--------|-------------|
| **Camera** | Native viewfinder — tap for photo, hold for video (up to 30s), pinch to zoom, flash toggle, self-timer |
| **Story Editor** | Drag-and-drop text overlays, freehand draw, emoji stickers, send to Story / DM / both |
| **Stories** | Story ring feed with 24h expiry, full-screen viewer with reply |
| **Explore** | Masonry grid of public stories from the network |
| **Messages** | NIP-17 encrypted DM threads, inline story previews, snap DMs with view-once |
| **Profile** | Edit kind 0 metadata, manage live stories, story deletion |

---

## Snap DMs

The core Snapchat mechanic — sending a photo or video directly to someone inside a chat thread.

- Tap the camera icon inside any chat to open the snap composer
- Tap to take a photo, hold to record video
- Before sending, choose **View Once** (👻) or **Keep in Chat** (💬)
- View Once snaps arrive blurred with a "Tap to open" prompt — after the recipient opens it, it's gone from both sides
- Keep in Chat snaps stay in the thread like a normal message
- All snaps are NIP-17 gift-wrapped with a `view-once` tag on the kind 14 rumor

---

## Stack

| Layer | Tech |
|-------|------|
| Framework | React 19 + TypeScript + Vite |
| Styling | Tailwind CSS |
| State | Zustand |
| Nostr | @nostrify/nostrify, nostr-tools |
| Accounts | applesauce-accounts, applesauce-signers |
| Reactive data | applesauce-core (EventStore) |
| Media | Blossom (blossom.primal.net) |
| Hosting | Cloudflare Pages |

---

## Nostr NIPs used

| NIP | Purpose |
|-----|---------|
| NIP-01 | Basic protocol, keypair identity |
| NIP-07 | Browser extension signing |
| NIP-17 | Private direct messages + snap DMs |
| NIP-33 | Parameterized replaceable events (stories) |
| NIP-40 | Expiration timestamp on stories |
| NIP-44 | Encrypted payloads (NIP-17 seals) |
| NIP-46 | Nostr Connect / remote bunker signing |
| NIP-51 | Lists (follow list for DM picker) |
| NIP-65 | Relay list metadata (outbox model) |
| Kind 10050 | DM inbox relay list |
| Kind 30923 | Ephemeral stories (see [nip-30923](https://github.com/OGSleepy/nip-30923-ephemeral-stories)) |
| BUD-02 | Blossom media uploads with SHA-256 auth |

---

## Getting started

```bash
git clone https://github.com/OGSleepy/Flare.git
cd Flare
npm install
npm run dev
```

Open `http://localhost:5173` — create an account or sign in with your Nostr key.

---

## Deployment

Flare deploys automatically to Cloudflare Pages on every push to `main`.

**Build command:** `npm run build`
**Output directory:** `dist`

---

## Project structure

```
src/
├── components/
│   ├── SnapComposer.tsx   # Inline snap camera — tap=photo, hold=video, view-once toggle
│   ├── StoryEditor.tsx    # Photo/video editor — text, draw, stickers, send sheet
│   ├── StoryViewer.tsx    # Full-screen story player with progress bars + reply
│   ├── ChatThread.tsx     # NIP-17 DM thread with snap bubbles and story previews
│   ├── ProfileEditor.tsx  # Edit kind 0 metadata + avatar upload
│   └── BottomNav.tsx      # Camera-centered bottom nav
├── screens/
│   ├── CameraScreen.tsx   # Viewfinder — tap=photo, hold=video, flash, timer
│   ├── StoriesScreen.tsx  # Story ring feed
│   ├── ChatScreen.tsx     # Conversations list + NIP-17 DM subscription
│   ├── ExploreScreen.tsx  # Public story discovery grid
│   ├── LoginScreen.tsx    # Create account / nsec / extension / bunker
│   └── ProfileScreen.tsx  # Profile + story management + logout
├── lib/
│   ├── nostr.ts           # NPool, relay routing, NIP-65, kind 10050 discovery
│   ├── nip17.ts           # NIP-17 send/decrypt + sendSnap with view-once tag
│   ├── upload.ts          # Blossom BUD-02 uploads with SHA-256
│   └── accountManager.ts  # applesauce AccountManager with localStorage persistence
├── store/
│   └── appStore.ts        # Zustand store — auth, stories, messages, follow list
└── types/
    └── index.ts           # TypeScript interfaces
```

---

## Contributing

PRs welcome. Open an issue first for anything significant.

---

## License

MIT — see [LICENSE](LICENSE).

---

Built by [@OGSleepy](https://github.com/OGSleepy)
