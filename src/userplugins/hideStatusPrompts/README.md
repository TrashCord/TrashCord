# Vencord: Hide Status Prompts

HideStatusPrompts is a source-only Vencord userplugin that hides Discord's suggested custom-status prompts while preserving the normal **Add Status** row.

Examples of the suggestions it targets include prompts such as `Just finished playing...` or `Favourite collectible?` in Discord's user panel.

## Behavior

- Hides only containers containing a suggested status prompt marked with both Discord's `addStatusPrompt_` and `italicPrompt_` class fragments
- Preserves the normal editable Add Status row because that row is not marked as an italic prompt
- Uses CSS only, with no Discord API calls or webpack patches
- Applies automatically while the plugin is enabled
- Has no commands, settings, or runtime controls

## Current Selectors

The stylesheet currently targets these two user-panel container variants:

```css
div[class*="referenceContainer_"]:has([class*="addStatusPrompt_"][class*="italicPrompt_"]),
div[class*="container_"][class*="editable_"]:has([class*="addStatusPrompt_"][class*="italicPrompt_"])
```

The entire matching prompt container is hidden. The plugin does not hide a parent `::before` bubble and does not target Discord's normal add-status icon.

## Requirements

- Discord desktop
- A working [Vencord development setup](https://docs.vencord.dev/installing/)
- `pnpm`, as used by Vencord

## Installation

This repository contains a Vencord userplugin source folder, not a standalone npm package.

1. Copy the `hideStatusPrompts` folder into `src/userplugins/` in your Vencord checkout.
2. Build Vencord using the instructions for your installation.
3. Enable **HideStatusPrompts** in **Discord Settings > Vencord > Plugins**.

Disable the plugin to restore Discord's suggested prompts.

## Technical Details

- Plugin name: `HideStatusPrompts`
- Author: `saintordevil`
- Entrypoint: `index.ts`
- Stylesheet: `style.css`
- Uses Vencord's `definePlugin` and stylesheet import
- Uses the CSS relational pseudo-class `:has()`
- Makes no network requests

## Maintenance Note

Discord's generated class names and user-panel markup can change. If suggestions reappear or the normal Add Status row is affected after a Discord update, the class fragments in `style.css` may need to be updated.

## License

[GNU General Public License v3.0 or later](LICENSE)
