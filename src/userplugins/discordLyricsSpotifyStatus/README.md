<div align="center">

<img src="https://capsule-render.vercel.app/api?type=waving&color=0:09090d,50:7f1d1d,100:dc2626&height=200&section=header&text=discordLyricsSpotifyStatus&fontSize=46&fontColor=f5f5f5&animation=fadeIn&fontAlignY=38&desc=Enhanced%20Equicord%20fork&descAlignY=58&descSize=16&descColor=a3a3a3" width="100%"/>

<br/>

[![Equicord](https://img.shields.io/badge/Equicord-dc2626?style=for-the-badge&logo=discord&logoColor=white&labelColor=09090d)](https://github.com/Equicord/Equicord)
[![Original](https://img.shields.io/badge/Original-dc2626?style=for-the-badge&logo=github&logoColor=white&labelColor=09090d)](https://github.com/Shiin2ii/discordLyricsSpotifyStatus)
[![GitHub](https://img.shields.io/badge/GitHub-dc2626?style=for-the-badge&logo=github&logoColor=white&labelColor=09090d)](https://github.com/Naxiwow)

</div>

---

## About

Enhanced fork of [Shiin2ii/discordLyricsSpotifyStatus](https://github.com/Shiin2ii/discordLyricsSpotifyStatus) for [Equicord](https://github.com/Equicord/Equicord).

I did **not** write the original plugin. All credit goes to [Tona Shiin](https://github.com/Shiin2ii).  
This fork fixes silent failures, adds new settings, and improves sync accuracy.

---

## What changed

<details>
<summary><b>Artist name normalization</b> — lrclib query fix</summary>

<br/>

Spotify sends featured artists as `"Rae Sremmurd, Gucci Mane"` — lrclib stores `"Rae Sremmurd feat. Gucci Mane"`. The original query returned 404 for any track with featured artists.

```diff
+ function primaryArtist(artistName: string): string {
+     return artistName.split(/,|\s+feat\.|\s+ft\./i)[0].trim();
+ }

  const params = new URLSearchParams({
      track_name: trackName,
-     artist_name: artistName,
+     artist_name: primaryArtist(artistName),
  });
```

</details>

<details>
<summary><b>Multi-attempt lyrics fetch</b> — fuzzy search fallback</summary>

<br/>

Original used only `/api/get` (exact match). Now tries three strategies in order:

```diff
- const res = await fetch(`${BASE_URL}/get?track_name=...&artist_name=...&album_name=...`);
- if (res.status === 404) return null;

+ // 1. exact match with primary artist + album
+ // 2. /search fuzzy with primary artist (no album)  
+ // 3. /search fuzzy with track name only
+ for (const { endpoint, params } of attempts) {
+     const res = await fetch(`${BASE_URL}/${endpoint}?${params}`);
+     if (res.status === 404) continue;
+     const data = await res.json();
+     const syncedLyrics = endpoint === "search"
+         ? data.find(r => r?.syncedLyrics)?.syncedLyrics
+         : data?.syncedLyrics;
+     if (syncedLyrics) return syncedLyrics;
+ }
```

</details>

<details>
<summary><b>CSP gate removed</b> — silent blocking fix</summary>

<br/>

Original gated all network access on `VencordNative.csp.isDomainAllowed`. If the domain wasn't pre-approved, lyrics were silently blocked forever — no error, no fallback attempt.

```diff
- const allowed = await VencordNative.csp.isDomainAllowed(url, directives).catch(() => false);
- if (!allowed) {
-     networkAccess = "blocked";
-     return null;  // silent, permanent failure
- }

+ // request override once, then fetch directly
+ // CSP errors are caught and logged — no silent permanent block
+ try {
+     await VencordNative.csp.requestAddOverride(url, directives, "DiscordLyricsSpotifyStatus");
+ } catch { /* VencordNative.csp may not exist in all builds */ }
```

</details>

<details>
<summary><b>Sync offset setting</b> — compensates for status PATCH latency</summary>

<br/>

Discord status PATCH requests take 100–500ms to propagate. Lyrics were always visibly behind the music. New `syncOffsetMs` setting shifts playback position forward before starting the scheduler.

```diff
- scheduler.start(track.progressMs);

+ // default 250ms — advance position to compensate for PATCH latency
+ const offsetMs = settings.store.syncOffsetMs ?? 250;
+ scheduler.start(track.progressMs + offsetMs);
```

</details>

<details>
<summary><b>New settings</b> — full list</summary>

<br/>

| Setting | Type | Default | Description |
|---|---|---|---|
| `lyricPrefix` | string | `♪` | Prefix before each lyric line |
| `cleanInstrumentals` | boolean | `true` | Replace `[Instrumental]` / empty lines with prefix |
| `clearOnStop` | boolean | `true` | Clear status when Spotify pauses |
| `pollIntervalMs` | slider | `500` | Poll interval in ms (250–2000) |
| `syncOffsetMs` | slider | `250` | Timing offset to compensate latency (0–1000) |
| `trackSwitchBoost` | boolean | `true` | Poll at 180ms for 3s after track switch |
| `forceRefreshOnTrackSwitch` | boolean | `true` | Bypass cache on track change |
| `debugMode` | boolean | `false` | Verbose console logs |

</details>

<details>
<summary><b>Fallback format</b> — aesthetic improvement</summary>

<br/>

When no synced lyrics are found, the status shows a clean fallback with the configurable prefix.

```diff
- setCustomStatus(`${track.trackName} - ${track.artistName}`);
+ const prefix = settings.store.lyricPrefix ? `${settings.store.lyricPrefix} ` : "";
+ setCustomStatus(`${prefix}${track.trackName} · ${track.artistName}`);
```

</details>

---

## Installation

Drop the `discordLyricsSpotifyStatus` folder into `src/userplugins/` in your Equicord source, then:

```bash
pnpm build
```

Restart Discord — enable **DiscordLyricsSpotifyStatus** in Equicord Settings → Plugins.

> First launch may prompt you to allow `lrclib.net` in CSP settings. Accept and restart Discord once.

---

## Credits

- [Tona Shiin](https://github.com/Shiin2ii) — original plugin author
- [lrclib.net](https://lrclib.net) — open-source synced lyrics API
- [Equicord](https://github.com/Equicord/Equicord) — the client mod

---

<div align="center">
<img src="https://capsule-render.vercel.app/api?type=waving&color=0:dc2626,50:7f1d1d,100:09090d&height=120&section=footer" width="100%"/>
</div>
