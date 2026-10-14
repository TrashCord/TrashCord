# GradientNickname

Vencord/Equicord userplugin: gradient nicknames mimicking Discord's boost role-color effect. Cross-user via invisible zero-width Unicode tag embedded in Discord bio.

## Install

1. Copy the `gradientNickname/` folder into `Vencord/src/userplugins/` (or `Equicord/src/userplugins/`).
2. Build & inject: `pnpm install && pnpm build && pnpm inject`.
3. Enable **GradientNickname** in Vencord plugin settings.

## Configure

Everything is configured in **User Settings → Appearance**, in the "Gradient Nickname" panel that mounts under the theme section.

- **Color stops** — one or more hex colors (`#rrggbb`), draggable to reorder.
- **Animation** — `none`, `slide`, `pulse`, `wave`, `hue`.
- **Slide direction** — `left` / `right` / `up` / `down` (when slide is active).
- **Speed** — 1–10 (maps to 10s … 1s duration).
- **Font** — Discord-native, Google Fonts (lazy-loaded), or system.
- **Glow** — with animated variants (`orbit`, `spin-fast`, `pulse`, `wave`, `bounce`, `flicker`).

Then click **Copy bio tag** and paste the invisible tag into **User Settings → Profiles → About Me**. Other users running the plugin see your gradient within ~60s of viewing your name.

> ⚠️ The plugin does **not** auto-patch your bio. This is intentional — it avoids Discord's automation-rule territory. You must paste the tag manually.

## How it works

- The panel serializes your config to a compact binary blob (`encoding.ts`), encodes it as zero-width Unicode characters, wraps it in U+2063 sentinels, and copies it to your clipboard.
- When any user's profile is fetched, the plugin scans their bio, finds the sentinel-wrapped blob, and decodes it back to a `GradientConfig`.
- A DOM observer walks username elements (`MutationObserver` + React fiber inspection) and paints gradients via `background-clip: text` + CSS animations.
- No bio PATCH, no messages, no automation. Read-only on the network side.

## Local config vs. rendered gradient

The panel's local config (in DataStore) drives only the **preview** and the tag generation. What you actually see rendered on your own name comes from **your bio** — the same path used for other users. So:

- Edit config → panel preview updates immediately.
- Click **Copy bio tag** → paste into About Me → save → your rendered name updates on next fetch (usually within seconds, forced by `USER_PROFILE_UPDATE_SUCCESS`).

## Limits

- Bio limit is 190 chars. The panel shows `XX/190` live and refuses to copy an oversized tag with a failure toast.
- Binary blob is compact: 7 bytes header + 3 bytes per color stop. 8 stops ≈ 31 bytes → 124 zero-width chars + 2 sentinels. Fits comfortably.
- Legacy `[grad:...]` plaintext tags (from earlier versions) are still decoded for backward compat.

## Troubleshooting

- **Gradient not appearing on other users**: they may not be running the plugin, or their bio tag didn't survive Discord's bio sanitizer (rare, but zero-width chars occasionally get stripped).
- **Bio too full**: shorten your bio; the tag needs ~30–130 chars depending on stop count.
- **Font doesn't apply**: Google Fonts fetch may be blocked by Discord CSP. The plugin falls back to Discord's default font and logs `[GradientNickname] font load failed`.
- **Panel doesn't mount**: it anchors to the "Apply theme to other users" text in Appearance settings. If Discord's layout changes, `mountPanelIfAppearance()` in `index.tsx` needs updating.