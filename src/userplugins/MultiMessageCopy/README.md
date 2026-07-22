# MultiMessageCopy

A [Vencord](https://github.com/Vendicated/Vencord) plugin that adds multi-message selection, clean copying, and optional full-chat export to Discord.

> **Unofficial Vencord UserPlugin.** This plugin is not affiliated with, endorsed by, or registered with the Vencord project or Discord Inc.

---

## Features

- **Selection mode** — enter via the message context menu; click messages or drag to select a range
- **Toolbar** — live selected-message counter; copy or clear with one click
- **Preview modal** — inspect formatted text before copying (configurable)
- **Copy formats** — timestamp, author, content, attachments, and embeds; fully configurable
- **Sound effects** — subtle tones on select / deselect / copy (toggleable)
- **Export Chat** *(optional, off by default)* — export the full history of a DM or Group DM as **JSON**, **Plain Text**, or **HTML**
  - HTML export includes Discord-style rendering: custom emoji, stickers, embeds, Tenor GIFs, Markdown, spoilers, lightbox, and a profile popout

---

## Requirements

| Requirement | Version | Notes |
|---|---|---|
| [Vencord](https://github.com/Vendicated/Vencord) | latest `dev` branch | Source install required — not the Desktop app |
| [Git](https://git-scm.com) | any recent | Required to clone Vencord and the plugin |
| [Node.js](https://nodejs.org) | 18 LTS or newer | Required to build Vencord |
| pnpm | 8 or newer | Run `npm install -g pnpm` to install |
| Windows | PowerShell 5.1+ | Only required for the automatic scripts |

---

## Automatic Installer (Windows)

Open **PowerShell** and run:

```powershell
iwr -UseB https://raw.githubusercontent.com/tsx-awtns/MultiMessageCopy/main/setup.ps1 -OutFile setup.ps1
powershell -ExecutionPolicy Bypass -File .\setup.ps1
```

### What the installer does

| Stage | Action |
|---|---|
| 1 | Welcome screen |
| 2 | Checks Git, Node.js, pnpm — offers to install each one if missing |
| 3 | Auto-detects your Vencord source folder — asks if not found |
| 4 | Offers to clone Vencord from GitHub if you do not have it |
| 5 | Creates `src/userplugins` if it does not exist |
| 6 | Downloads the latest MultiMessageCopy ZIP from GitHub into a temp folder |
| 7 | Copies only the runtime files into `src/userplugins/MultiMessageCopy` |
| 8 | Runs `pnpm install` (skipped if `node_modules` already exists) |
| 9 | Runs `pnpm build` then `pnpm inject` |
| — | Saves your Vencord path to `%APPDATA%\MultiMessageCopy\mmc-config.json` |
| — | Shows final installation summary |

After it finishes, **restart Discord completely** (close from the system tray first).

---

## Automatic Updater (Windows)

```powershell
iwr -UseB https://raw.githubusercontent.com/tsx-awtns/MultiMessageCopy/main/update.ps1 -OutFile update.ps1
powershell -ExecutionPolicy Bypass -File .\update.ps1
```

Or, if you still have `update.ps1` from a previous run:

```powershell
powershell -ExecutionPolicy Bypass -File .\update.ps1
```

### What the updater does

| Stage | Action |
|---|---|
| 1 | Checks Git, Node.js, pnpm |
| 2 | Reads saved Vencord path from config — asks if missing |
| 3 | Fetches latest version from GitHub and shows installed vs latest |
| 4 | Downloads latest plugin ZIP from GitHub |
| 5 | Creates a timestamped backup of your current install |
| 6 | Replaces only the runtime plugin files |
| 7 | Runs `pnpm build` |
| 8 | Asks if you want to restart Discord |
| — | Shows update summary with backup path and build status |

---

## Where files are installed

The installer and updater copy **only these runtime files** into your Vencord plugin folder:

| File / Folder | Copied |
|---|---|
| `index.tsx` | Yes |
| `styles.css` | Yes |
| `src/` | Yes |
| `README.md` | Yes |
| `LICENSE` | Yes |
| `setup.ps1` | **No** — installer only, stays in your downloads |
| `update.ps1` | **No** — updater only, stays in your downloads |
| `uninstall.ps1` | **No** — uninstaller only |
| `version.json` | **No** — not needed at runtime |
| `package.json` | **No** — not needed at runtime |
| `.git/` | **No** |
| `.github/` | **No** |

The installed plugin lives at:

```
Vencord/
  src/
    userplugins/
      MultiMessageCopy/
        index.tsx
        styles.css
        src/
        README.md
        LICENSE
```

---

## Manual Installation (all platforms)

### 1. Clone Vencord (if you do not have it)

```bash
git clone https://github.com/Vendicated/Vencord
cd Vencord
pnpm install
```

### 2. Clone the plugin

```bash
git clone https://github.com/tsx-awtns/MultiMessageCopy \
    src/userplugins/MultiMessageCopy
```

### 3. Copy only the runtime files (if not cloning)

If you downloaded the ZIP manually, copy only these into `src/userplugins/MultiMessageCopy/`:

- `index.tsx`
- `styles.css`
- `src/`
- `README.md`
- `LICENSE`

Do **not** copy `setup.ps1`, `update.ps1`, `version.json`, or any other dev files.

### 4. Build and inject

```bash
pnpm build
pnpm inject
```

Restart Discord after injecting.

---

## Manual Update

```bash
cd Vencord/src/userplugins/MultiMessageCopy
git pull
cd ../../..
pnpm build
```

---

## How to Uninstall

### Automatic (Windows)

```powershell
iwr -UseB https://raw.githubusercontent.com/tsx-awtns/MultiMessageCopy/main/uninstall.ps1 -OutFile uninstall.ps1
powershell -ExecutionPolicy Bypass -File .\uninstall.ps1
```

The uninstaller will ask for confirmation, delete only `src/userplugins/MultiMessageCopy`, rebuild Vencord, and offer to restart Discord.

### Manual

1. Delete `Vencord/src/userplugins/MultiMessageCopy/`
2. Run `pnpm build` in your Vencord folder
3. Restart Discord

---

## Safety

All three scripts (`setup.ps1`, `update.ps1`, `uninstall.ps1`) follow these rules:

| Rule | Detail |
|---|---|
| No remote code execution | Scripts never use `Invoke-Expression`, `iex`, or execute any downloaded code |
| Scope-limited deletion | Only `src\userplugins\MultiMessageCopy` is ever deleted — verified by a path safety guard before any delete |
| Parent path check | Both the folder path AND its parent are validated before any file is removed |
| No credentials | Scripts never ask for Discord login, token, password, or any private data |
| Ask before big actions | Cloning Vencord, installing pnpm, restarting Discord — all require explicit confirmation |
| No silent installs | Large dependencies (Git, Node.js) are never installed silently; the script explains and asks |
| Paths with spaces | All paths are quoted throughout |
| Auditable | All three scripts are plain PowerShell — open them in any text editor before running |

---

## Enabling the Plugin

1. Open Discord
2. Go to **User Settings** (gear icon) > **Vencord** > **Plugins**
3. Search for `MultiMessageCopy`
4. Toggle it **on**
5. Click the settings icon to configure options

---

## Settings

| Setting | Default | Description |
|---|---|---|
| Date format | `DD.MM.YYYY, HH:mm:ss` | Timestamp format in copied messages |
| Include attachments | on | Append attachment URLs when copying |
| Include embeds | on | Append embed URLs when copying |
| Media format | `Separate lines` | Place media inline, on separate lines, or at the end |
| Animation speed | `Normal` | Speed of UI transitions |
| Sound effects | on | Subtle tones on select / copy / exit |
| Show preview | on | Open a preview modal before copying |
| Export Chat | off | Adds "Export Chat" to DM / Group DM context menus |
| Export format | `JSON` | File format for chat exports (JSON / TXT / HTML) |

---

## Usage

### Multi-message copy

1. Right-click any message and choose **Select Messages**
2. Click messages to select or deselect; **Shift+click** to range-select
3. Press **C** or click **Copy** in the toolbar
4. Press **Escape** or click **Exit** to leave selection mode

### Export Chat

> Enable the `Export Chat` setting first.

1. Right-click a **DM** or **Group DM** in the sidebar
2. Choose **Export Chat**
3. A progress modal shows while messages are fetched
4. The file downloads automatically when complete

**Supported formats:**

| Format | Extension | Notes |
|---|---|---|
| JSON | `.json` | All metadata, embeds, attachments |
| Plain Text | `.txt` | Human-readable; one message per block |
| HTML | `.html` | Self-contained; Discord-style rendering |

> Server channels and threads are intentionally not exportable.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| `git: command not found` | Install Git from https://git-scm.com — `setup.ps1` will offer to do this automatically |
| `node: command not found` | Install Node.js LTS from https://nodejs.org — `setup.ps1` will offer to do this automatically |
| `pnpm: command not found` | Run `npm install -g pnpm` — `setup.ps1` will offer to do this |
| Vencord folder not found | Run `setup.ps1` and enter the path when prompted, or let it clone Vencord for you |
| `src/userplugins` does not exist | `setup.ps1` and `update.ps1` create it automatically |
| `pnpm build` fails | Run `pnpm install` inside the Vencord folder first, then try `pnpm build` again |
| `pnpm inject` fails | Try running PowerShell as Administrator (Discord may need elevated access) |
| Plugin not showing in Discord | Make sure you ran `pnpm inject` and restarted Discord from the system tray |
| Plugin visible but disabled | Enable it in User Settings > Vencord > Plugins |
| Config path stale on update | Delete `%APPDATA%\MultiMessageCopy\mmc-config.json` and re-run `setup.ps1` |
| Build works but plugin crashes | Check the DevTools console (Ctrl+Shift+I in Discord) for errors |

---

## Development

```bash
# watch mode — rebuilds on file changes
pnpm watch

# type-check only
pnpm tsc --noEmit

# lint
pnpm lint
```

---

## Project Structure

```
index.tsx                     Plugin entry point (definePlugin)
styles.css                    Global UI styles
setup.ps1                     Automatic installer (Windows)
update.ps1                    Automatic updater (Windows)
uninstall.ps1                 Automatic uninstaller (Windows)
version.json                  Machine-readable version metadata
src/
  components/
    CheckboxManager.ts        Per-message checkbox DOM management
    ExportProgressModal.ts    Export progress overlay
    PreviewModal.ts           Pre-copy preview dialog
    Toolbar.ts                Floating action toolbar
  constants/
    index.ts                  Shared selectors and constants
  hooks/
    selectionManager.ts       Selection logic (add, remove, clear, copy)
    selectionState.ts         Reactive selection state (Map<id, Message>)
  patches/
    messageContextMenu.tsx    "Select Messages" context menu entry
    channelContextMenu.tsx    "Export Chat" context menu entry
  settings/
    index.ts                  Plugin settings schema
  types/
    index.ts                  Internal types
    export.ts                 Export document types
  utils/
    clipboard.ts              Clipboard write helper
    domHelpers.ts             DOM utility functions
    exportChat.ts             Message fetching + document assembly
    exportFormatters.ts       Format dispatcher (JSON / TXT / HTML)
    filename.ts               Safe filename generation
    messageFormatter.ts       Single-message text formatter
    notification.ts           Toast notification helper
    sound.ts                  Web Audio API sound effects
    htmlExport/
      index.ts                Public entry point for HTML export
      safety.ts               escapeHtml, isSafeUrl, formatTimestamp
      users.ts                Participant map, avatars, popout data
      content.ts              CDN detection, suppressed URL set
      markdown.ts             Discord Markdown renderer
      media.ts                Attachments, stickers, inline media previews
      embeds.ts               Rich embeds, Tenor/gifv embeds
      messages.ts             Message row HTML builder
      layout.ts               Full HTML document shell
      styles.ts               All CSS (embedded in the HTML export)
      clientScript.ts         Lightbox + popout + spoiler JS (embedded)
```

---

## License

[MultiMessageCopy Custom Source License](https://github.com/tsx-awtns/MultiMessageCopy?tab=License-1-ov-file)

You may view, install, and modify this plugin. You may not claim ownership, remove attribution, or represent this as an official Vencord plugin or official Discord feature.
