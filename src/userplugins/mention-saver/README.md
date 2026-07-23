<div align="center">

# 🔔 Mention Saver

**A [Vencord](https://github.com/Vendicated/Vencord) plugin that catches and stores every Discord mention — so you never miss one again.**

[![Made with TypeScript](https://img.shields.io/badge/TypeScript-007ACC?style=flat&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Vencord](https://img.shields.io/badge/Vencord-Plugin-5865F2?style=flat)](https://vencord.dev/)
[![Author](https://img.shields.io/badge/by-Mika%20Jonkovič-pink?style=flat)](https://github.com/Squiddoo)

</div>

---

## Overview

Discord's built-in inbox is great — until you accidentally dismiss a mention and it's gone forever. **Mention Saver** fixes that. It runs silently in the background, intercepts every message that mentions you, and stores it locally. A small bell icon lives in your Discord title bar, ready whenever you need it.

**Especially useful when:**
- 💣 A channel gets **nuked** before you had the chance to read your mention
- 🚪 You get **kicked from a group chat** and lose access to the message
- 👻 A message gets **deleted** right after you were mentioned
- 📵 You were **offline** and mentions piled up in a busy server

## Features

| | |
|---|---|
| 🔔 | **Title bar button** — a subtle bell icon right next to Discord's native controls |
| 🔴 | **Live badge counter** — see your unread mention count at a glance |
| 💾 | **Persistent storage** — mentions survive Discord restarts |
| ✕ | **One-click clear** — wipe all saved mentions instantly |
| ⚙️ | **Settings panel** — tweak max storage, timestamps, and auto-clear |
| 🐱 | *Made with love by Mika Jonkovič* |

## Installation

> ⚠️ Requires Vencord **built from source**. Not compatible with the standard Vencord installer.

**Prerequisites:** [Git](https://git-scm.com/) · [Node.js LTS](https://nodejs.org/) · [pnpm](https://pnpm.io/)

```bash
# 1. Clone Vencord
git clone https://github.com/Vendicated/Vencord
cd Vencord
pnpm install --frozen-lockfile

# 2. Add this plugin
cd src/userplugins
git clone https://github.com/Squiddoo/mention-saver mentionSaver
cd ../..

# 3. Build & inject (close Discord first!)
pnpm build
pnpm inject
```

Then open Discord → **Settings → Vencord → Plugins** → search `Mention Saver` → enable ✅

## Settings

| Option | Default | Description |
|---|---|---|
| Max Mentions | `100` | Maximum number of mentions to keep in storage |
| Clear on Start | `false` | Wipe all mentions every time Discord launches |
| Show Timestamps | `true` | Display date and time on each mention |

## Updating

```bash
cd src/userplugins/mentionSaver
git pull

cd ../..
pnpm build
# Then press Ctrl+R in Discord
```

## License

[MIT](LICENSE) — free to use, modify and share.

---

<div align="center">
<sub>Made by <a href="https://github.com/Squiddoo">Mika Jonkovič</a> 🐱</sub>
</div>
