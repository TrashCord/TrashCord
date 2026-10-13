# Camera Unlock

Camera Unlock is a small Discord plugin that unlocks the camera and Go Live buttons in voice channels where you do not have the Stream permission. The buttons become usable, so you can start your camera or a stream in places where Discord would normally gray them out.

## What it does

- Removes the client-side Stream permission check from the voice channel camera and Go Live controls.
- Nothing else changes. The buttons look and behave normally once unlocked.

## How it works

Discord decides whether to show the camera and Go Live buttons with a permission check in the voice channel component. The plugin patches that check to always pass. It is a single patch on the expression that combines the Stream permission with the channel check.

## Important note

This removes the client-side check only. Discord's servers can still refuse the camera or the stream, and if they do, your own preview starts but nobody else sees it. The plugin does not grant a permission you do not have. It only stops the client from hiding the controls, which is useful in channels where the server actually allows streaming but the client state or permission cache is wrong.

## Installation

Camera Unlock is a user plugin for Vencord or Equicord, and it is built into Kurtcord.

For Vencord or Equicord:

1. Clone the plugin into the userplugins folder:
   ```
   git clone https://github.com/kurtzonaudio/camera-unlock src/userplugins/CameraUnlock
   ```
2. Build the client:
   ```
   pnpm build
   ```
3. Restart Discord. The camera and Go Live buttons appear where they were hidden.

## Notes and limits

- Client-side only. Server-side permission checks still apply.
- If a server refuses the stream, you will see your own preview but others will not. That is Discord's behavior, not the plugin's.
- Use it where you have permission but the client hides the button. Do not use it to get around a server rule.

## Kurtzon's Discord plugins

This plugin is part of the Kurtzon's Discord plugins set, which ships with [Kurtcord](https://github.com/kurtzonaudio/kurtcord) and also works in Vencord and Equicord:

- [Stereo Guard](https://github.com/kurtzonaudio/stereo-guard): locally mutes anyone whose audio is not fully mono.
- [Mic Spam Guard](https://github.com/kurtzonaudio/mic-spam-guard): locally mutes anyone who gets too loud or spams their mic.
- [Voice State Fix](https://github.com/kurtzonaudio/voice-state-fix): corrects stuck mute and deafen states on Discord's side.
- [Voice VU Meters](https://github.com/kurtzonaudio/voice-vu-meters): live volume meters next to everyone in a call.
- [Kurtcord Voice Panel](https://github.com/kurtzonaudio/kurtcord-voice-panel): a live Voice & Video panel in the user area.
- [Kurtcord Theme](https://github.com/kurtzonaudio/kurtcord-theme): the Kurtcord wallpaper theme.
- [Camera Unlock](https://github.com/kurtzonaudio/camera-unlock): unlocks the camera and Go Live buttons without the Stream permission.
- [Click To Unmute](https://github.com/kurtzonaudio/click-to-unmute): click a locally muted user's mute icon to unmute them.
- [Auto Cam Off](https://github.com/kurtzonaudio/auto-cam-off): turns your camera off when a staff member joins.

## License

MIT. Copyright (c) 2026 Kurtzon (Kurtzon Audio). See [LICENSE](LICENSE).

Built and maintained by Kurtzon.
