# UserPanelServerProfile

An [Equicord](https://github.com/Equicord/Equicord) userplugin that makes the
account panel in the bottom left show your **server profile** for whatever server
you are currently viewing, instead of always showing your main profile.

![The account panel showing a server profile, with the nameplate and avatar decoration animating](preview.gif)

Discord already lets you set a different avatar, nickname, nameplate, avatar
decoration and display name style per server. Everyone else sees those. You do
not: your own panel keeps showing your global profile no matter where you are.
This fixes that.

## What it swaps

While a server is selected, the panel uses that server's:

* avatar
* nickname
* nameplate
* avatar decoration
* display name style (font and gradient)

In DMs and on Home it shows your main profile, as before. Each field falls back
to your main profile individually, so a server where you only set a nickname
still shows your global avatar.

## Also fixes

Two animation bugs that only show up once the panel starts changing:

* **The nameplate stopped animating after switching servers.** Discord plays the
  nameplate video from an effect whose dependencies are `[animate, loop]`. Those
  never change, so the effect runs once on mount. That was fine while a nameplate
  could never change without a remount, but swapping the video source in place
  leaves the element reloaded and paused with nothing to restart it. The plugin
  adds the animated asset to that dependency array.
* **The avatar decoration was always a still frame.** The panel builds its
  decoration URL without passing `canAnimate`, so it resolves to the static
  asset. Note that AlwaysAnimate cannot fix this: it rewrites `canAnimate` keys
  that already exist at a call site, and this one omits the key entirely.

## Nameplate ink

The plugin also publishes the nameplate's own colour as a CSS variable,
`--np-plate` on the user panel (`section[class*="panels_"]`), so a theme can tint
the panel to match whatever nameplate is active. It used to sit on `<body>`, but
every element inherits from there, so each change restyled the whole app: 284ms,
against 17ms on the panel.

Discord does not expose that colour. `--custom-nameplate` is a black scrim
(`#00000033`) rather than the plate's hue, and the only real colour it publishes,
`--custom-display-name-styles-main-color`, lives on a container nested inside the
title, so the status line and buttons sit above it and cannot inherit it.

So the colour is sampled instead: the nameplate's static asset is drawn into a
32x32 canvas and averaged, weighting each pixel by the square of its saturation
so the plate's accent wins over its dark background. Near-black and near-grey
pixels are skipped outright, and the result is lifted so a dark plate still gives
a usable ink. Results are cached per asset, and the variable is removed when no
nameplate is active so `var(--np-plate, ...)` falls back cleanly.

Sampling failures are caught and logged rather than thrown - a throw in `start()`
would make Vencord drop the plugin's patches and take the whole server profile
with it, and the ink is the least important part of this plugin.

## Requirements

Equicord installed **from source**. Userplugins are compiled into the bundle, so
this will not work on the installer's prebuilt build. See
[Equicord's installation guide](https://github.com/Equicord/Equicord).

## Install

Clone into your Equicord checkout's userplugins folder:

```bash
cd Equicord/src/userplugins
git clone https://github.com/Just-Me-22/UserPanelServerProfile userPanelServerProfile
cd ../..
pnpm build
```

Restart or reload Discord (Ctrl+R), then enable **UserPanelServerProfile** in
Equicord's plugin settings and reload once more. Patches are applied at startup,
so enabling alone does nothing until the next reload.

## How it works

Almost all of it is handing Discord's own functions the argument they were
already prepared to accept but were being called with a default. The nameplate
hook is called with `guildId: void 0`, `getAvatarURL` takes a guild id as its
first parameter and a `canAnimate` flag as its third, and so on. The per-server
data comes straight from `GuildMemberStore.getMember(guildId, userId)`.

That is deliberate: one-token changes inherit Discord's own formatting, palette
and fallback logic, and they tend to survive Discord updates better than
rebuilding the same objects by hand would.

## Known conflicts

`Declutter` and `BannersEverywhere` patch some of the same avatar decoration and
nameplate call sites. If either is enabled you may get patch conflicts.

`AccountPanelServerProfile` is a different plugin and does not conflict. It
changes which profile the account **popout** opens; this one changes the panel
row itself. They work fine together.

## License

GPL-3.0-or-later
