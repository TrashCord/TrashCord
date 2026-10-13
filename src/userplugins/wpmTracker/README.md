# wpmTracker

A Vencord userplugin that displays your current typing speed (WPM) above the Discord chat input and lets you view the WPM of your sent messages from the message context menu.

This is a renderer-only plugin and does not require `native.ts`.

## Quick Setup

Upload the plugin folder to the location where it belongs in your Vencord source tree, then run:

```powershell
Remove-Item -Recurse -Force dist
pnpm build
pnpm inject
```

After injection, enable `wpmTracker` in Vencord if needed.

## Installation

1. Put the plugin folder in `src/userplugins/<Name>/`.
2. Export a default `definePlugin` from `index.tsx` or `index.ts`.
3. You do not need `native.ts`; this plugin is renderer-only.
4. Use Vencord APIs such as `@api/*`, `@utils/*`, and `@webpack/common`.
5. Rebuild/reinject after making changes.

For development, `pnpm watch` can be used instead of a full rebuild.

## How It Works

### Live WPM tracking

- Uses an `8000ms` rolling window (`WINDOW_MS`).
- A capture-phase `input` listener on `document` tracks Discord's Slate chat editor.
- Inputs are ignored unless they belong to an element with `data-slate-editor="true"`.
- The plugin locates the chat input wrapper through `[class*="channelTextArea"]`.
- A small `div.vc-wpm-tracker-root` badge is mounted above the textarea.
- The badge uses Discord CSS variables such as `--text-muted` and `--font-code`.
- The badge is hidden whenever the calculated WPM is `0`.
- `pointer-events: none` keeps the badge from interfering with the chat UI.

### WPM calculation

`computeWpm` removes timestamps older than eight seconds and calculates:

- Words = `character count / 5`
- WPM = words / elapsed minutes
- Minimum elapsed time = `1 / 60000` minutes to prevent division by zero
- Fewer than two characters results in `0 WPM`

### Idle reset

Typing pauses longer than `3000ms` (`IDLE_RESET_MS`) reset the current typing window.

Each keystroke reschedules the idle timer, so typing with gaps greater than three seconds starts a fresh burst.

### Message WPM

When a message is sent with Enter (without Shift):

1. The current WPM is captured.
2. It is stored temporarily as `lastSentWpm`.
3. A `10s` expiry timer prevents stale values from being attached to later messages.
4. The typing tracker is reset.
5. `FluxDispatcher.subscribe("MESSAGE_CREATE", ...)` waits for the created message.
6. If the created message belongs to the current user, its WPM is stored by message ID.

This means WPM is only recorded for messages sent while the plugin is active.

Shift+Enter creates a newline and does not reset the tracker.

### Message context menu

The plugin patches the `message` context menu using `addContextMenuPatch`.

For your own messages that have a recorded WPM, it adds a non-interactive entry:

```text
Typing Speed: <n> WPM
```

The entry is created with `React.createElement`, so the implementation works in `.ts` as well as `.tsx`.

## Cleanup

`stop()` reverses everything registered by `start()`:

- Removes both document listeners.
- Unsubscribes from `MESSAGE_CREATE`.
- Runs the stored context-menu unpatch function.
- Clears the idle and pending-WPM timers.
- Removes the WPM badge.
- Clears the per-message WPM map.

The capture flag used when removing the input listener must match the flag used when registering it.

## Notes

- Renderer-only; no native helper is required.
- No settings are currently exposed.
- Per-message WPM is only available for messages sent while the plugin is active.
- The message WPM map is cleared when the plugin stops.
- Shift+Enter does not reset the tracker; only an actual message send does.
