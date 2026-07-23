# Soundboard Unlocker

A Vencord plugin that makes soundboard sounds from your other guilds selectable without Nitro.

The plugin patches Discord's client-side Soundboard Everywhere entitlement and removes the Nitro-locked marker from external guild sections. It does not grant guild permissions: you must still be able to view the source guild, join the destination voice channel, and have **Use External Sounds** permission there.

## Install

### Official Vencord Plugin (recommended)

Search for "SoundboardUnlocker" in the "Vencord Settings" -> "Plugins" Discord section, then proceed to install my plugin by clicking on it. 

### Custom plugin
Custom plugins require a Vencord build from source.

1. Clone this repository into Vencord's `src/userplugins` directory under the camel-cased folder name `soundboardUnlocker`:

   ```sh
   git clone https://github.com/adversing/soundboard-unlocker src/userplugins/soundboardUnlocker
   ```

   Alternatively, copy this folder to `src/userplugins/soundboardUnlocker`.

2. From the Vencord repository, rebuild and reinject Vencord:

   ```sh
   pnpm build
   pnpm inject
   ```

3. Restart Discord, open **Settings → Vencord → Plugins**, enable **SoundboardUnlocker**, and restart once more when prompted.


