# TaskbarStatus

A [Vencord](https://vencord.dev) userplugin that lets you change your Discord status from the Windows taskbar, without opening the window.

- **Hover preview:** four buttons (Online, Idle, Do Not Disturb, Invisible) under the Discord thumbnail, like Spotify's media buttons. The current status is ringed.
- **Right-click jump list:** the same four statuses under "Tasks".

Windows only. Discord's own call buttons (mute, deafen, video, disconnect) keep working alongside the status buttons.

## Install

Vencord userplugins need a source build of Vencord ([guide](https://docs.vencord.dev/installing/custom-plugins/)).

```sh
git clone https://github.com/Vendicated/Vencord
cd Vencord
git clone https://github.com/yusufaf/vencord-taskbar-status src/userplugins/taskbarStatus.discordDesktop
pnpm install
pnpm build
pnpm inject
```

Restart Discord and enable **TaskbarStatus** in Vencord's plugin settings.

## How it works

Taskbar buttons and jump lists live in Electron's main process, which normal plugins can't reach. This plugin's `native.ts` runs there:

- It wraps `BrowserWindow.setThumbarButtons` for the main window and merges Discord's call buttons with the status buttons. Windows allows at most 7 thumbnail buttons, so when all four call buttons are showing the button for your current status is dropped.
- It sets jump-list tasks that launch `Update.exe --processStart ... --process-start-args --taskbar-status=<status>`, which survives Discord updates. A running Discord receives the argument through Electron's `second-instance` event; a cold start reads it from `process.argv`.
- It re-applies the thumbnail buttons whenever the window is shown, because hiding to tray destroys the taskbar button and Windows discards its thumbnail buttons.

## Limitations

- With Discord closed to the tray there is no taskbar button, so no hover buttons. Jump-list tasks still work if Discord is pinned.
- Picking a jump-list task can bring a visible Discord window to the front. The plugin tries to put a minimized or hidden window back as it was, but this is best effort.
- If you enable the plugin while in a voice call, Discord's call buttons reappear the next time Discord updates them (for example on mute or deafen).

## Development

```sh
node --test merge.test.ts
```

## License

GPL-3.0-or-later, matching Vencord.
