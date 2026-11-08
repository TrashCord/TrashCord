<img src="avatar.jpg" width="96" align="right" alt="lyix">

# AutoMuteDiscord

A Vencord user plugin by **lyix** that auto-mutes people in voice calls (only for you) when they:

- go over a loudness threshold (loud mics / earrape)
- use a stereo mic (detected by bitrate, or marked by you and remembered)
- talk non-stop for too long
- fake deafen / fake mute (show as deafened but still send voice)

You get a notification at the top of Discord when it happens, and you can right-click anyone to unmute or re-mute them. There's a toggle to never mute your friends.

## Install

1. Build Vencord from source: https://docs.vencord.dev/installing/
2. Download `index.tsx` from this repo (click it, then the download button), make a folder called `autoMuteDiscord` in `Vencord/src/userplugins/`, and put `index.tsx` inside it
3. Run `pnpm build` then `pnpm inject`, and restart Discord
4. Enable **AutoMuteDiscord** in Settings → Vencord → Plugins

If the build fails because of a *different* user plugin, put a `_` in front of that plugin's folder name so the build skips it.

## Right-click menu

- **Unmute / Mute &lt;reason&gt;** (Stereo Mic, Prepare For Earrape, Talking Too Long, Fake Deafen)
- **Mark As Stereo Mic / Unmark Stereo Mic** (saved, muted in every call)
- **Force Unmute / Force Mute**

## Settings

Threshold, attack time, stay muted, talk limit and mute length (0 = forever), stereo bitrate limit, ignore friends, notifications, and a debug mode that logs everyone's levels to the console (Ctrl+Shift+I) so you can tune things.

Muting uses Discord's own per-user Mute, so you can always undo it from Discord's normal right-click menu too.

[COMPLTELY VIBE CODED]
