# BetterStreamZoom

A [Vencord](https://vencord.dev) user plugin for watching streams whose aspect ratio doesn't match your screen.

If someone with an ultrawide monitor plays a 16:9 video fullscreen and streams their screen, the black bars on the left and right are part of the stream. On a 16:9 monitor you get bars on all four sides, and Discord's zoom keeps the 21:9 frame, so it barely helps.

Right click a stream → **Crop Stream** and pick 16:9. The plugin then treats the middle 16:9 of the stream as the whole picture: it fills your view, and zoom, panning and the minimap all work inside that area. The choice is remembered per streamer.

It also fixes zoom in general when the stream and the view have different aspect ratios:

- panning stops at the edges of the actual picture instead of the black bars
- the minimap rectangle shows what you really see
- optionally, the first zoom step jumps to the level where the stream fills your view, zooming out from there goes back to fit (off by default, enable it in the settings)

## Installation

User plugins need a Vencord build from source. If you don't have one yet, follow the [official guide](https://docs.vencord.dev/installing/), then:

```sh
cd Vencord/src/userplugins
git clone https://github.com/lsscrnls/betterStreamZoom
cd ../..
pnpm build
pnpm inject
```

Restart Discord and enable BetterStreamZoom in Settings → Vencord → Plugins.

To update, run `git pull` in the plugin folder and `pnpm build` again.

## Notes

The plugin patches Discord's stream zoom code, so a Discord update can break it. If something stops working, open an issue and mention your Discord build number (Settings → bottom left).

Written with help from Claude Code.

## License

GPL-3.0-or-later, same as Vencord.
