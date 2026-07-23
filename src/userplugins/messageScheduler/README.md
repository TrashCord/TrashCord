# MessageScheduler - Vencord / Equicord Plugin

Schedule Discord messages via a full UI or slash commands.  
Supports repeat, random pools, saved templates, import/export, and 1-minute warnings.

---

## Features

- Clock icon in the chat bar for quick access
- Preset times: 5s, 30s, 5m, 10m, 30m, 1h, 2h, 1d, 1w, 1 month
- Schedule by exact date and time (datetime picker)
- Custom time input (seconds, minutes, hours, days, months)
- Repeat messages - set a count or repeat forever
- Random messages - add a pool, one is picked randomly each fire
- Send to any text channel in the current server
- Save messages as reusable templates
- Search through the pending queue
- Edit a pending message without cancelling it
- Export / Import all data as JSON
- Toast notification 1 minute before a message fires
- Slash commands for quick scheduling without opening the UI
- English and Arabic language support

---

## Installation

**Requirements:** Git · Node.js LTS · pnpm (`npm i -g pnpm`)

```bash
# 1. Download and set up Vencord
cd Desktop\Vencord-main
pnpm install --frozen-lockfile

# 2. Place the plugin
# Create: src\plugins\MessageScheduler\
# Drop index.tsx inside it

# 3. Build and inject
git init
git config --global user.email "any@email.com"
git config --global user.name "user"
git add .
git commit -m "init"
git remote add origin https://github.com/Vendicated/Vencord
pnpm build
pnpm inject
```

**Enable:** Discord → Settings → Plugins → search **MessageScheduler** → enable ✅

---

## UI Usage

| Step | Action |
|------|--------|
| 1 | Click the 🕐 clock icon in the chat bar |
| 2 | Type your message (or enable Random and add a pool) |
| 3 | Pick a preset, exact date, or custom amount |
| 4 | Optionally enable Repeat and set a count (0 = forever) |
| 5 | Optionally pick a different channel from the dropdown |
| 6 | Click **Schedule Message** |

---

## Tabs

| Tab | Description |
|-----|-------------|
| Schedule | Create a new scheduled message |
| Saved | Reusable message templates |
| Queue | All pending messages - search, edit, cancel |

---

## Slash Commands

| Command | Description |
|---------|-------------|
| `/schedule message: <text> time: <when>` | Schedule a message |
| `/scheduled` | List pending messages in this channel |
| `/cancel-scheduled index: <n>` | Cancel message at index from `/scheduled` |

**Time formats for `/schedule`:**  
Relative - `30s`, `5m`, `1h30m`, `2d`  
Exact - `3:30pm`, `15:45`, `8am`

---

## Settings

| Setting | Description |
|---------|-------------|
| Language | Switch between English and Arabic |
| Show Notifications | Toggle toast notifications on schedule/send/warn |

---

## Data

- Scheduled messages survive plugin reloads via `globalThis` storage.
- All messages are cleared when the plugin is **disabled** (`stop()`).
- Use **Export Data** to back up your queue and saved templates as JSON.
- Use **Import Data** to restore from a backup file.

---

## Author

**hmood** - [CodeFlow Developments](https://github.com/CodeFlowDevelopments)

## License

GPL-3.0