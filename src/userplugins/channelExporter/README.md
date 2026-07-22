# ChannelExporter

A Vencord plugin that adds a toolbar button to export messages from any Discord channel, DM, or group DM directly to your downloads folder.

## Features

- **Toolbar button** - appears in the channel header, only visible to you
- **Works everywhere** - text channels, DMs, and group DMs
- **Multiple export formats** - ZIP (both files), plain text, or JSON
- **Date filtering** - only export messages after a specific date
- **Message limit** - choose how many recent messages to fetch
- **Remembers your settings** - limit, date, and format persist between sessions
- **Private** - no bot required, runs entirely inside your Discord client

## Installation

1. Make sure you have [Vencord][vencord] installed
2. Copy the `channelExporter` folder into your Vencord `src/userplugins/` directory:

```
Vencord/
└── src/
    └── userplugins/
        └── channelExporter/
            ├── index.tsx
            ├── ExportModal.tsx
            ├── fetcher.ts
            ├── utils.ts
            └── types.ts
```

3. Rebuild Vencord:

```bash
pnpm build
pnpm inject
```
4. Fully restart Discord
5. Go to **Settings > Vencord > Plugins** search for **ChannelExporter** and enable it

## Usage

1. Navigate to any channel, DM, or group DM
2. Click the **download icon** in the channel header toolbar
3. Set your options in the modal:
    - **Message Limit** - number of most recent messages to export (default is 100)
    - **Since** - optionally only export messages after a given date
    - **Export Format** - choose ZIP, text only, or JSON only
4. Click **Export** - the file will download to your browser downloads folder

## Export Formats

| Format | Description |
|--------|-------------|
| ZIP | A `.zip` containing both `.txt` and `.json` files |
| Text | Human readable `.txt` with timestamps, authors, and content |
| JSON | Raw message data for processing or archiving |

### Text format example
```
Channel: #general
Exported: 2024-03-15 10:00:00 UTC
Total messages: 50
[2024-03-14 09:15:32 UTC] Alice
Hey everyone!
[2024-03-14 09:17:45 UTC] Bob
Hey! How's it going?
screenshot.png: https://cdn.discordapp.com/attachments/...
```

### Date filter format
```
YYYY-MM-DD
YYYY-MM-DD HH:MM
YYYY-MM-DD HH:MM:SS
```

## Notes

- All times are in **UTC**
- Exports only include messages you have permission to read
- The plugin runs entirely client side - no data is sent anywhere
- Requires Vencord to be running (the plugin does not work standalone)

## License

GPL-3.0 — see [LICENSE][license]

<!-- LINKS -->
[vencord]: https://vencord.dev
[license]: LICENSE