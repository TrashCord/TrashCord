# SilentGroupCall — Design Spec

A Vencord plugin that lets you start a Discord call **without ringing** the other
members. They can still see and join the call; they just don't get the incoming-call
notification/sound.

> **Handoff note:** This is the design/brain doc (authored by Fable 5). The
> implementer (Opus 4.8) should treat the webpack module/property names below as
> *hypotheses to verify at build time* — Discord's minified internals shift, so
> confirm the real names before committing to them.

---

## 1. How Discord ringing works (the core mechanism)

Pressing the call button in a DM or group DM does **two independent things**:

1. **Joins the voice call** — establishes the voice connection; a persistent
   "Join Call" bar appears in the channel for all members.
2. **Rings the members** — a **separate, client-initiated** HTTP request that tells
   Discord to push the incoming-call notification (sound + popup) to recipients.

Ringing is **not automatic server-side** — the client fires it. The relevant
endpoints:

- `POST /channels/{channel_id}/call/ring` — body `{"recipients": null}` rings
  everyone, or pass a list of user IDs.
- `POST /channels/{channel_id}/call/stop-ringing` — body `{"recipients": [...]}`
  cancels the ring.

**Consequence:** if the client never fires `ring`, no ringing happens — but you're
still connected and the call is still joinable. That's the whole trick.

---

## 2. Strategy

- **Primary — block the ring (Strategy A):** intercept the client's `ring` call and
  neutralize it when the call is in scope. Result: zero ring, no flicker, no
  notification pushed at all.
- ~~**Safety net — stop-ringing (Strategy B)**~~ — **removed after security review
  (2026-07-17).** Firing `stopRinging` for a ring that never happened is the only
  *extra* request the plugin would ever send, at a moment the vanilla client never
  sends it. Blocking the ring makes it redundant anyway. Dropping it gives the plugin
  its key safety property: **it only ever omits traffic the client would have sent —
  it never generates any.**

---

## 3. Settings (the toggle the user asked for)

Two boolean switches, which together produce all four requested states:

| `silenceGroupCalls` | `silenceDMCalls` | Effective behavior      |
|---------------------|------------------|-------------------------|
| true                | true             | Both silenced           |
| true                | false            | Group calls only        |
| false               | true             | 1-on-1 DM calls only    |
| false               | false            | None (plugin idle)      |

Vencord `definePluginSettings`:

```ts
const settings = definePluginSettings({
    silenceGroupCalls: {
        type: OptionType.BOOLEAN,
        description: "Don't ring members when you start a group call",
        default: true,
    },
    silenceDMCalls: {
        type: OptionType.BOOLEAN,
        description: "Don't ring the other person when you start a 1-on-1 DM call",
        default: false,
    },
});
```

Add a third switch for development:

```ts
    debugLogs: {
        type: OptionType.BOOLEAN,
        description: "Log plugin activity to the console (DevTools → Console, filter 'SilentGroupCall')",
        default: false,
    },
```

**Scope decision at ring-time:** look up the channel by `channelId` via `ChannelStore`,
read its `type`:

- `type === 3` → `GROUP_DM` → silence if `settings.store.silenceGroupCalls`
- `type === 1` → `DM` → silence if `settings.store.silenceDMCalls`
- anything else → do nothing (let it ring normally)

Use Vencord's channel type constants rather than hardcoded ints if available
(`Constants.ChannelTypes.GROUP_DM` / `.DM`).

---

## 4. Implementation plan

**Location:** `src/userplugins/silentGroupCall/index.ts`

**Approach — runtime monkeypatch (preferred over regex `patches`).** Discord's
minified code churns, so a runtime wrap in `start()` / restore in `stop()` is more
durable than a brittle source-regex patch.

### Steps

1. **Find the calls-actions module.** Hypothesis: `findByProps("ring", "stopRinging")`
   exposing `ring(channelId, recipients?)` and `stopRinging(channelId, recipients?)`.
   Verify the real property names and the `ring` signature.
2. **Find `ChannelStore`** (`findStoreLazy("ChannelStore")` or `findByProps`) to resolve
   `channelId → channel.type`.
3. **In `start()`:** save `original = module.ring`, then replace `module.ring` with a
   wrapper:
   - Resolve the channel type from `channelId`.
   - If it's in scope per settings → **skip** the original ring (optionally call
     `stopRinging(channelId, null)` as the safety net) and return.
   - Otherwise → call `original.apply(this, args)` unchanged.
4. **In `stop()`:** restore `module.ring = original` so disabling cleanly reverts.

### Skeleton

```ts
import definePlugin, { OptionType } from "@utils/types";
import { definePluginSettings } from "@api/Settings";
import { findByPropsLazy, findStoreLazy } from "@webpack";

const settings = definePluginSettings({ /* see §3 */ });

const CallActions = findByPropsLazy("ring", "stopRinging"); // VERIFY names
const ChannelStore = findStoreLazy("ChannelStore");

let originalRing: ((...args: any[]) => any) | null = null;

function shouldSilence(channelId: string): boolean {
    const channel = ChannelStore.getChannel(channelId);
    if (!channel) return false;
    if (channel.type === 3) return settings.store.silenceGroupCalls; // GROUP_DM
    if (channel.type === 1) return settings.store.silenceDMCalls;    // DM
    return false;
}

export default definePlugin({
    name: "SilentGroupCall",
    description: "Start DM/group calls without ringing the other members.",
    authors: [{ name: "you", id: 0n }],
    settings,

    start() {
        originalRing = CallActions.ring;
        CallActions.ring = function (channelId: string, ...rest: any[]) {
            if (shouldSilence(channelId)) {
                // Strategy B safety net (optional):
                try { CallActions.stopRinging?.(channelId, null); } catch {}
                return; // Strategy A: never ring
            }
            return originalRing!.call(this, channelId, ...rest);
        };
    },

    stop() {
        if (originalRing) CallActions.ring = originalRing;
        originalRing = null;
    },
});
```

---

## 5. Dev logging (see what's working and what isn't)

Use Vencord's `Logger` (`new Logger("SilentGroupCall")` from `@utils/Logger`) — it
prefixes and colors messages so they're easy to filter in DevTools (Ctrl+Shift+I →
Console → filter `SilentGroupCall`).

Two tiers:

- **Always logged (errors/lifecycle):** `logger.info` / `logger.error` — these fire
  regardless of the debug toggle, because a silently-broken patch is the worst
  failure mode.
- **Debug-only (per-call detail):** gated behind `settings.store.debugLogs` via a
  small helper: `const debug = (...args) => settings.store.debugLogs && logger.info(...args);`

### Log points

| When | Level | Message (include the data shown) |
|---|---|---|
| `start()` succeeds | info | `"patched ring()"` — confirms the module was found and hooked |
| Module lookup fails | **error** | `"could not find ring/stopRinging module — plugin inactive"` (this is the #1 thing that breaks after a Discord update) |
| `ring` intercepted | debug | `channelId`, resolved channel `type`, settings state, and the **decision** (`"silencing"` / `"passing through"`) |
| Channel not found in store | debug | `"unknown channel <id> — passing through"` |
| Safety-net `stopRinging` fired | debug | `"stopRinging sent for <channelId>"` |
| `stopRinging` throws | **error** | the caught error (don't swallow it silently) |
| Passthrough to original `ring` | debug | `"ringing normally: <channelId>"` |
| `stop()` | info | `"unpatched ring()"` |

### Example wrapper with logging

```ts
import { Logger } from "@utils/Logger";
const logger = new Logger("SilentGroupCall");
const debug = (...args: any[]) => settings.store.debugLogs && logger.info(...args);

CallActions.ring = function (channelId: string, ...rest: any[]) {
    const channel = ChannelStore.getChannel(channelId);
    debug("ring() called", { channelId, type: channel?.type, settings: { ...settings.store } });
    if (shouldSilence(channelId)) {
        debug("→ silencing (skipping ring)");
        try {
            CallActions.stopRinging?.(channelId, null);
            debug("→ safety-net stopRinging sent");
        } catch (e) {
            logger.error("stopRinging failed", e);
        }
        return;
    }
    debug("→ passing through to original ring");
    return originalRing!.call(this, channelId, ...rest);
};
```

**Why this matters for testing:** with `debugLogs` on, every call attempt prints the
channel type, the settings snapshot, and the decision taken — so if ringing behaves
unexpectedly you can immediately see *which* branch ran (module never patched? wrong
channel type? setting off?) instead of guessing from the second account's behavior.

---

## 6. Must-verify at build time (do not assume)

- Exact module + real property names for `ring` / `stopRinging`.
- The `ring` function signature — confirm `channelId` is the first arg and how
  recipients are passed.
- That blocking `ring` still leaves you **connected** to the call and the
  **"Join Call" bar visible** to members.
- Whether `stopRinging` takes `null` for "all recipients" or needs an explicit list.

---

## 7. Test plan

Use a 2-person group DM (and a 1-on-1 DM) with a second account.

1. Enable plugin, `silenceGroupCalls = true`. Start the group call.
   - You are connected. ✅
   - Second account gets **no** ring/notification. ✅
   - Second account can still see and **join** the call. ✅
2. Set `silenceGroupCalls = false`, `silenceDMCalls = true`. Start a 1-on-1 DM call.
   - Other person is **not** rung; a group call **would** ring normally.
3. Both false → normal ringing everywhere.
4. Disable the plugin → normal ringing restored (monkeypatch cleanly removed).

---

## 8. Risks / notes

- Client mods and automating call behavior violate Discord's ToS. Low risk for
  personal use, but nonzero — the user has been informed.
- Prefer the runtime monkeypatch over regex `patches` for durability across Discord
  updates.
- If Vencord's plugin loader requires the plugin under `src/plugins` in a given build,
  place it wherever that build's userplugin convention expects.
