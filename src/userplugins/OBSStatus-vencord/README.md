# OBSStatus

A [Vencord](https://vencord.dev) userplugin that **automatically changes your Discord custom status when OBS Studio is running** — perfect for streamers who want people to see they're live without setting it manually every time.

Open OBS → your status switches to your custom "live" message. Close OBS → it clears. That's it.

---

## ✨ Features

- 🔴 Auto-detects when OBS Studio is running and updates your Discord custom status
- 💬 Fully custom status message — set it to whatever you want
- 😀 Supports normal emojis **and** custom/animated server emotes (Nitro)
- 🧹 Automatically clears your status when you close OBS
- ⚙️ Configurable check interval and OBS WebSocket port
- 🪶 Lightweight — uses OBS's built-in WebSocket, no extra software needed

---

## 📋 Requirements

- A **Vencord dev build** (or **Vesktop** pointed at a custom Vencord build) — userplugins don't work on the normal one-click Vencord installer
- **OBS Studio 28 or newer** (WebSocket server is built in)
- **Discord Nitro** *only if* you want to use a custom/animated emote (normal emojis work without Nitro)

---

## 📥 Installation

1. Download `OBSStatus.tsx`
2. Place it in your Vencord folder under:
   ```
   Vencord/src/userplugins/OBSStatus.tsx
   ```
   (create the `userplugins` folder inside `src` if it doesn't exist)
3. Build Vencord:
   ```
   pnpm build
   ```
4. Restart Discord (or press `Ctrl+R` in Vesktop)
5. Go to **Settings → Plugins**, search **OBSStatus**, and enable it

---

## 🎥 OBS Setup

The plugin detects OBS through its WebSocket server, so you need to turn that on once:

1. In OBS: **Tools → WebSocket Server Settings**
2. Check **Enable WebSocket Server**
3. Make sure the **Server Port** is **4455**
4. **Uncheck Enable Authentication** (easiest), then click **OK**

That's all — open OBS and your status updates within a few seconds.

---

## ⚙️ Settings

| Setting | What it does |
|---|---|
| **Status Message** | The text shown when OBS is running. Change it to whatever you want (default is the author's channel; change it to your own). |
| **Emoji Name** | For a normal emoji, use its unicode name (e.g. `red_circle` → 🔴). For a custom emote, use its name **without** colons (e.g. `alert`). |
| **Emoji ID** | Leave **blank** for normal emojis. For a custom emote, paste its ID here (see below). |
| **Emoji Animated** | Turn ON if your custom emote is animated. |
| **Check Interval** | How often (in seconds) to check if OBS is running. Default `5`. |
| **Clear On Stop** | Clears your custom status when you close OBS. |
| **OBS WebSocket Port** | Must match the port in OBS. Default `4455`. |

---

## 😀 Using a custom / animated emote

By default the plugin uses a normal emoji (`red_circle` 🔴), which works for everyone.

If you want a **custom server emote** (like `:alert:`) in your status:

1. You must have **Discord Nitro** and have access to that emote.
2. In any Discord chat, type the emote with a backslash in front and send it:
   ```
   \:alert:
   ```
   Discord will reply with something like:
   ```
   <a:alert:750810249853796434>
   ```
3. From that:
   - **Emoji Name** = the name in the middle → `alert`
   - **Emoji ID** = the long number → `750810249853796434`
   - **Emoji Animated** = ON if it starts with `a:` (animated), OFF if it starts with just `:` (static)

> **Note:** Animated emotes only animate for you and other Nitro users. Non-Nitro viewers see a static image. This is a Discord limitation, not the plugin.

---

## ❓ Troubleshooting

- **Status doesn't change when OBS opens** → make sure the WebSocket server is enabled in OBS, the port matches (`4455`), and authentication is off.
- **Custom emote won't show** → you need Nitro, and you must have access to that emote. Double-check the Emoji ID and that the Animated toggle matches (`a:` = animated).
- **Check the console** → in Discord press `Ctrl+Shift+I` → Console tab, and look for `[OBSStatus]` messages. They'll tell you if OBS is being detected.

---

## 👤 Author

Made by **tomper** — come say hi on stream!
- Twitch: https://twitch.tv/tomperyeeter

## 📝 License

GPL-3.0 — same as Vencord. Free to use, modify, and share.
