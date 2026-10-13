# Auto Cam Off

Auto Cam Off turns your camera off automatically when a server owner, an administrator, or a moderator joins the voice channel you are in. It is a small privacy guard for calls where you would rather not be on camera in front of staff.

## What it does

- Watches who joins your voice channel.
- If the person is the server owner, has Administrator, or has a moderation or management permission, the plugin turns your camera off.
- Optionally shows a toast explaining why the camera turned off.
- Ignores bots and any user IDs you list, so it does not fire for the wrong people.
- Also checks the channel when you are already in it, so it catches staff who were there before you joined or who joined while the plugin was loading.

## How it works

- It listens to the `VOICE_STATE_UPDATES` event for joins into the voice channel you are in.
- For each joiner, and for everyone already in the channel on startup, it computes their permissions:
  - Server owner: matches the owners setting.
  - Administrator: matches the admins setting.
  - Management and moderation bits (`Manage Server`, `Manage Channels`, `Manage Roles`, `Kick`, `Ban`, `Manage Messages`, `Manage Threads`, `Manage Events`, `Mute Members`, `Deafen Members`, `Move Members`, `Moderate Members`): matches the management setting.
- If the joiner is staff and the matching setting is on, the plugin dispatches `MEDIA_ENGINE_SET_VIDEO_ENABLED` with `enabled: false`, which is the same path Discord's own camera button uses.
- Bots and listed user IDs are skipped before any of that.

## Settings

- **Owners.** Turn the camera off when the server owner joins. Default on.
- **Admins.** Turn the camera off when a member with Administrator joins. Default on.
- **Management.** Turn the camera off when a member with moderation or management permissions joins. Default on.
- **Ignore bots.** Ignore bots. Default on.
- **Ignore users.** User IDs to ignore, separated by commas. Default empty.
- **Notify.** Show a toast when the camera turns off. Default on.

## Installation

Auto Cam Off is a user plugin for Vencord or Equicord, and it is built into Kurtcord, where it can be managed from Plugins, Auto Cam Off.

For Vencord or Equicord:

1. Clone the plugin into the userplugins folder:
   ```
   git clone https://github.com/kurtzonaudio/auto-cam-off src/userplugins/AutoCamOff
   ```
2. Build the client:
   ```
   pnpm build
   ```
3. Restart Discord and enable Auto Cam Off in Settings, Plugins.

## Notes and limits

- It only turns the camera off. It does not turn it back on, and it does not touch your microphone.
- It does not detect screen share and does not stop a stream you already started.
- A person can hold several permissions. Any single matching permission in the enabled category is enough.
- The ignore list takes Discord user IDs, not usernames. Enable Developer Mode in Discord's advanced settings and use Copy User ID to get them.

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
