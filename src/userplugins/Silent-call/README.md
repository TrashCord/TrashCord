# SilentGroupCall — start Discord calls without ringing anyone

A **Vencord plugin** that lets you start a Discord voice call — in a **DM or group DM** — **silently**, without ringing the other members or sending them the incoming-call notification. When you press the call button, Discord's client normally fires a separate "ring" request that pushes an incoming-call notification (sound + popup) to everyone. This plugin intercepts that request at runtime and skips it when the call is in scope. You still join the call and the "Join Call" bar still appears for everyone — they just don't get buzzed. Nothing else about the call changes; members can see it and join whenever they like.

**Use cases:** start a group call without waking everyone up at night, open a voice channel in a group chat without the ring spam, call a friend without the loud incoming-call sound, or just quietly sit in a call and let people trickle in when they notice.

*If you searched for: discord call without ringing · silent discord call · start group call without notification · discord no ring plugin · disable call ringing — this is that.*

## Install

1. Clone/checkout Vencord and get a working dev build going (see the [Vencord docs](https://docs.vencord.dev/installing/)).
2. Create the folder `src/userplugins/silentGroupCall/` inside your Vencord checkout.
3. Drop `index.ts` (this plugin) into that folder.
4. Build: `pnpm build`
5. Inject into your Discord client: `pnpm inject` — or, if Vencord is already injected, just re-run `pnpm build` and fully restart Discord (Ctrl+R won't reload the plugin bundle).
6. In Discord: **Settings → Plugins**, find **SilentGroupCall**, and enable it.

## Settings

- **Silence group calls** (default: on) — don't ring members when you start a **group DM** call.
- **Silence DM calls** (default: off) — don't ring the other person when you start a **1-on-1 DM** call.
- **Debug logs** (default: off) — print per-call detail to the DevTools console (channel type, settings snapshot, and which decision the plugin made). Leave off for normal use; turn on when troubleshooting.

Both silence switches off = the plugin is effectively idle and everything rings normally.

## Troubleshooting

Open DevTools with **Ctrl+Shift+I**, go to the **Console** tab, and type `SilentGroupCall` in the filter box.

- On startup you should see `[SilentGroupCall] patched ring()`. That confirms the plugin found Discord's call module and hooked it.
- If instead you see `[SilentGroupCall] could not find ring/stopRinging module — plugin inactive`, a Discord update most likely changed the internal module and broke the lookup. The plugin stays inert (it won't crash Discord), but it also won't do anything until the module finder in `index.ts` is updated. This is the #1 thing that breaks after a Discord update.
- Turn on **Debug logs** to see, for each call you start, the channel type, your current settings, and whether the plugin chose to **silence** or **ring normally**. That tells you immediately which branch ran if behavior surprises you.

## Safety notes

- **The plugin is fully passive on the network.** It never sends any request of its own — it only *skips* the one "ring" request your client would normally fire. There is no automation, no loops, no spoofing, and nothing runs without you manually pressing the call button.
- Discord bans are historically triggered by spam, selfbot automation, API flooding, and paid-feature spoofing (e.g. FakeNitro streaming). This plugin does none of those. Per the Vencord FAQ, there are no known cases of bans for merely using a client mod.
- Client mods still technically violate Discord's Terms of Service. If your account is critical to you, weigh that; and avoid posting screenshots that reveal you use a client mod.
