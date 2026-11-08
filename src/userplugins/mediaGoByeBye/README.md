<p align="center">
  <img src="https://raw.githubusercontent.com/ItzMeShadow999/My-assets/main/mediaGoByeBye.png" width="150" alt="MediaGoByeBye icon">
</p>

<h1 align="center">MediaGoByeBye</h1>

<p align="center">
  <img src="https://img.shields.io/badge/license-GPL--3.0--or--later-2F3437?style=flat-square&labelColor=191919" alt="License GPL-3.0-or-later">
  <img src="https://img.shields.io/badge/Vencord-userplugin-2F3437?style=flat-square&labelColor=191919" alt="Vencord userplugin">
  <img src="https://img.shields.io/badge/Equicord-userplugin-2F3437?style=flat-square&labelColor=191919" alt="Equicord userplugin">
  <img src="https://img.shields.io/badge/language-TypeScript-2F3437?style=flat-square&labelColor=191919" alt="TypeScript">
  <img src="https://img.shields.io/badge/installer-Windows%20PowerShell-2F3437?style=flat-square&labelColor=191919" alt="Windows PowerShell installer">
</p>

A [Vencord](https://github.com/Vencord/Vencord) / [Equicord](https://github.com/Equicord/Equicord) plugin that blurs, covers or completely removes media in chat. Videos, images, GIFs, stickers and link embeds can each be controlled on their own, or all at once with one global mode.

## ▸ Modes

| Mode | What it does |
| --- | --- |
| Blur | The media is blurred. Hover over it to reveal it. |
| Spoiler | The media is covered by a Spoiler overlay. Click once to reveal it. |
| Bye Bye | The media is removed completely. Nothing is shown. |

## ▸ Settings

Open Settings > Plugins > MediaGoByeBye.

| Setting | What it does |
| --- | --- |
| Global mode | The mode used by every enabled media type that follows the global setting. |
| Blur strength | Blur size in pixels, used by Blur and Spoiler. |
| Enable (per type) | Turns the plugin on or off for that media type. Only Videos is on by default. |
| Use global mode (per type) | On by default. Turn it off to give that type its own mode. |
| Own mode (per type) | The mode that type uses when it does not follow the global mode. |

Media types: Videos, Images, GIFs, Stickers and Link embeds.

A few ways to use it:

- Set the global mode to Spoiler and enable everything, so all media is covered until you click it.
- Enable only Videos and set it to Bye Bye, so videos never show up.
- Keep the global mode on Blur, then give Images their own mode of Bye Bye.

## ▸ Install

MediaGoByeBye is a user plugin. You need a [Vencord development setup](https://docs.vencord.dev/installing/custom-plugins/).

### Quick install (Windows)

Run this in PowerShell. It installs Git, Node.js and pnpm if they are missing, clones Vencord or Equicord, adds the plugin, builds, injects and enables it.

```
irm https://raw.githubusercontent.com/ItzMeShadow999/mediaGoByeBye/main/install.ps1 | iex
```

### Manual install

1. Clone Vencord and go into the folder.
2. Put this plugin at `src/userplugins/mediaGoByeBye/index.ts`.
3. Build and inject:
   ```
   pnpm install
   pnpm build
   pnpm inject
   ```
4. Restart Discord and enable **MediaGoByeBye** in Settings > Plugins.

For Equicord, put it in `src/userplugins/mediaGoByeBye/` in the Equicord source and build the same way.

## ▸ How it works

The plugin injects a small stylesheet that targets Discord's media containers. Discord's class names are hashed (for example `imageWrapper_a1b2c3`), so the selectors match the stable prefix of each class instead of the full name.

- Blur applies a CSS blur and removes it on hover.
- Bye Bye sets `display: none` on the matching elements.
- Spoiler draws an overlay on top of the media. A click listener catches the first click, reveals the media and stops the click from opening the lightbox or starting playback.

Changing a setting rebuilds the stylesheet right away, so no reload is needed.

## ▸ Notes

- The GIF and sticker selectors are best effort. If Discord changes how they render, adjust the `MEDIA` block at the top of `index.ts`.
- Spoiler reveals are not remembered. If Discord re-renders a message, the cover comes back.
- If Discord renames the classes, a media type may stop being affected. The selectors in the `MEDIA` block are the only thing to update.

## ▸ License

GPL-3.0-or-later. See [LICENSE](LICENSE).

Copyright (c) 2026 ItzMeShadow999
