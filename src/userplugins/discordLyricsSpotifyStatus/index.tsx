/*
 * Discord Lyrics Spotify Status
 * Author: Naxiwow - https://github.com/Naxiwow
 * Based on original work by Tona Shiin - https://github.com/Shiin2ii
 */

import { definePluginSettings } from "@api/Settings";
import { getUserSettingLazy } from "@api/UserSettings";
import definePlugin, { OptionType } from "@utils/types";
import { RestAPI, PresenceStore, SpotifyStore, UserStore } from "@webpack/common";

interface LyricLine {
    timeMs: number;
    text: string;
}

interface SpotifyTrackState {
    isPlaying: boolean;
    trackId: string;
    trackName: string;
    artistName: string;
    albumName: string;
    progressMs: number;
    durationMs: number;
}

class LyricScheduler {
    private readonly lyrics: LyricLine[];
    private readonly onLineChange: (line: LyricLine) => void;
    private timers: number[] = [];
    private startedAt = 0;
    private startProgressMs = 0;

    constructor(lyrics: LyricLine[], onLineChange: (line: LyricLine) => void) {
        this.lyrics = lyrics;
        this.onLineChange = onLineChange;
    }

    private scheduleLine(line: LyricLine, delay: number) {
        this.timers.push(window.setTimeout(() => this.onLineChange(line), delay));
    }

    start(progressMs: number) {
        this.stop();
        this.startedAt = Date.now();
        this.startProgressMs = progressMs;

        const passed = this.lyrics.filter(l => l.timeMs <= progressMs);
        if (passed.length > 0) this.scheduleLine(passed[passed.length - 1], 0);

        for (const line of this.lyrics) {
            const delay = line.timeMs - progressMs;
            if (delay <= 0) continue;
            this.scheduleLine(line, delay);
        }
    }

    stop() {
        for (const timer of this.timers) window.clearTimeout(timer);
        this.timers = [];
    }

    restart(newProgressMs: number) {
        this.start(newProgressMs);
    }

    get estimatedProgressMs() {
        return this.startProgressMs + (Date.now() - this.startedAt);
    }
}

const settings = definePluginSettings({
    lyricPrefix: {
        type: OptionType.STRING,
        description: "Prefix before each lyric line. Plain text/emoji, or a Discord custom emoji <:name:id> (animated: <a:name:id>) used as the ENTIRE value to set it as the status icon - Discord can't render <:name:id> inline mixed with other text. Leave empty for none.",
        default: "🎵",
        restartNeeded: false,
    },
    fallbackTrackText: {
        type: OptionType.BOOLEAN,
        description: "Show track name when synced lyrics are unavailable",
        default: true,
        restartNeeded: false,
    },
    titlePrefix: {
        type: OptionType.STRING,
        description: "Separate prefix for the song title status only, same rules as lyricPrefix (custom emoji <:name:id>/<a:name:id> must be the whole value to render as the icon). Leave empty to reuse lyricPrefix",
        default: "💿",
        restartNeeded: false,
    },
    cleanInstrumentals: {
        type: OptionType.BOOLEAN,
        description: "Replace empty/instrumental sections with just the prefix instead of showing garbage",
        default: true,
        restartNeeded: false,
    },
    instrumentalPrefix: {
        type: OptionType.STRING,
        description: "Separate prefix for instrumental/empty lyric sections only, same rules as lyricPrefix (custom emoji <:name:id>/<a:name:id> must be the whole value to render as the icon). Leave empty to reuse lyricPrefix",
        default: "",
        restartNeeded: false,
    },
    clearOnStop: {
        type: OptionType.BOOLEAN,
        description: "Clear custom status when Spotify pauses or plugin stops",
        default: true,
        restartNeeded: false,
    },
    restoreStatusOnStop: {
        type: OptionType.BOOLEAN,
        description: "Restore your previous custom status when the song stops, instead of just clearing it (falls back to Clear custom status when disabled or blocked)",
        default: true,
        restartNeeded: false,
    },
    checkRotatorSuite: {
        type: OptionType.BOOLEAN,
        description: "Coordinate with Rotator Suite: prefer its On-Close status for restore when configured, leave status alone if its Cycle Status is rotating with no On-Close set, otherwise restore normally. Does nothing if Rotator Suite isn't found",
        default: true,
        restartNeeded: false,
    },
    detectAnyStatusRotator: {
        type: OptionType.BOOLEAN,
        description: "Generic detection (name-independent): if any status text keeps changing on its own - any rotator plugin, script, or manual habit - back off from restoring/clearing instead of fighting it",
        default: true,
        restartNeeded: false,
    },
    pollIntervalMs: {
        type: OptionType.SLIDER,
        description: "Poll interval (ms) - lower = more accurate, higher = lighter on resources",
        markers: [250, 350, 430, 500, 750, 1000, 1250, 1500, 2000],
        default: 430,
        stickToMarkers: true,
        restartNeeded: false,
    },
    trackSwitchBoost: {
        type: OptionType.BOOLEAN,
        description: "Temporarily poll faster for 3s after a track switch",
        default: true,
        restartNeeded: false,
    },
    syncOffsetMs: {
        type: OptionType.SLIDER,
        description: "Sync offset (ms) - increase if lyrics appear too late, decrease if too early. Lower than before now that status updates apply natively (near-instant) instead of over REST",
        markers: [0, 50, 100, 150, 200, 250, 300, 350, 400, 500, 600, 750, 800, 900, 1000, 1100],
        default: 300,
        stickToMarkers: true,
        restartNeeded: false,
    },
    forceRefreshOnTrackSwitch: {
        type: OptionType.BOOLEAN,
        description: "Bypass lyrics cache when switching tracks",
        default: true,
        restartNeeded: false,
    },
    debugMode: {
        type: OptionType.BOOLEAN,
        description: "Detailed debug logs in console",
        default: false,
        restartNeeded: false,
    },
});

const BOOST_POLL_INTERVAL_MS = 180;
const TRACK_SWITCH_BOOST_WINDOW_MS = 3000;
const SEEK_THRESHOLD_MS = 2000;
const MIN_LYRIC_LENGTH = 2;
const INSTRUMENTAL_RE = /^(\[.*\]|♪+|🎵+|\s*)$/i;
const CUSTOM_EMOJI_RE = /^<(a)?:(\w+):(\d{15,21})>$/;
const EMBEDDED_CUSTOM_EMOJI_RE = /<a?:\w+:\d{15,21}>/;
const CUSTOM_EMOJI_ANYWHERE_RE = /<a?:(\w+):(\d{15,21})>/;
const STATUS_MARKER = "\u200B";
const ROTATOR_SUITE_CLOSE_LS_KEY = "rs_close_v1";

const CustomStatusSetting = getUserSettingLazy<{ text: string; emojiId: string; emojiName: string; expiresAtMs: string; createdAtMs: string; }>("status", "customStatus");

const EXTERNAL_STATUS_ROTATORS: { plugin: string; settingKey: string; }[] = [
    { plugin: "Rotator Suite", settingKey: "statusEnabled" },
];

const GENERIC_ROTATOR_WINDOW_MS = 20000;
const GENERIC_ROTATOR_MIN_HITS = 2;
let lastSeenExternalStatusText: string | null = null;
let externalStatusChangeTimestamps: number[] = [];

function trackExternalStatusChanges() {
    try {
        const current = CustomStatusSetting?.getSetting?.();
        const text = current?.text ?? "";
        const isOurs = !!text && text.includes(STATUS_MARKER);
        if (isOurs) { lastSeenExternalStatusText = null; return; }
        if (text === (lastSeenExternalStatusText ?? "")) return;

        const now = Date.now();
        externalStatusChangeTimestamps.push(now);
        externalStatusChangeTimestamps = externalStatusChangeTimestamps.filter(t => now - t <= GENERIC_ROTATOR_WINDOW_MS);
        lastSeenExternalStatusText = text;
    } catch {}
}

function getGenericRotatorSignal(): { active: boolean; avgIntervalMs: number | null; } {
    if (!settings.store.detectAnyStatusRotator) return { active: false, avgIntervalMs: null };

    const now = Date.now();
    const recent = externalStatusChangeTimestamps.filter(t => now - t <= GENERIC_ROTATOR_WINDOW_MS);
    if (recent.length < GENERIC_ROTATOR_MIN_HITS) return { active: false, avgIntervalMs: null };

    const deltas: number[] = [];
    for (let i = 1; i < recent.length; i++) deltas.push(recent[i] - recent[i - 1]);
    const avgIntervalMs = deltas.length ? deltas.reduce((a, b) => a + b, 0) / deltas.length : null;
    return { active: true, avgIntervalMs };
}

function isExternalStatusRotatorActive(): boolean {
    if (!settings.store.checkRotatorSuite) return false;
    try {
        const pluginSettings = (window as any)?.Vencord?.Settings?.plugins;
        if (!pluginSettings) return false;
        for (const { plugin, settingKey } of EXTERNAL_STATUS_ROTATORS) {
            const entry = pluginSettings[plugin];
            if (entry?.enabled && entry?.[settingKey]) return true;
        }
    } catch {}
    return false;
}

function getRotatorSuiteCloseStatus(): { text: string; emojiName: string; emojiId: string; } | null {
    if (!settings.store.checkRotatorSuite) return null;
    try {
        const raw = localStorage.getItem(ROTATOR_SUITE_CLOSE_LS_KEY);
        if (!raw) return null;
        const cfg = JSON.parse(raw);
        if (!cfg?.closeStatusEnabled) return null;

        const text = String(cfg.closeStatusText ?? "").trim();
        const emojiRaw = String(cfg.closeStatusEmoji ?? "").trim();
        if (!text && !emojiRaw) return null;

        const combined = `${emojiRaw}${text ? ` ${text}` : ""}`.trim();
        const match = combined.match(CUSTOM_EMOJI_ANYWHERE_RE);
        if (match) return { text: combined.replace(match[0], "").trim(), emojiName: match[1], emojiId: match[2] };

        return { text: combined, emojiName: "", emojiId: "0" };
    } catch {
        return null;
    }
}

let currentTrackId: string | null = null;
let scheduler: LyricScheduler | null = null;
let lastProgressMs = 0;
let lastPollTime = 0;
let pollTimer: number | null = null;
let pollingActive = false;
let trackLoadToken = 0;
let boostUntilMs = 0;

const BASE_URL = "https://lrclib.net/api";
const cache = new Map<string, LyricLine[] | null>();
let cspRequested = false;
let debugEnabled = false;

function debugLog(msg: string, extra?: unknown) {
    if (!debugEnabled) return;
    extra === undefined
        ? console.info(`[LyricsStatus] ${msg}`)
        : console.info(`[LyricsStatus] ${msg}`, extra);
}

function setLyricsDebugMode(enabled: boolean) { debugEnabled = enabled; }
function clearLyricsCache(trackId?: string) {
    if (trackId) { cache.delete(trackId); return; }
    cache.clear();
}

function cacheAndReturn(trackId: string, value: LyricLine[] | null) {
    cache.set(trackId, value);
    return value;
}

async function initLyricsNetworkAccess() {
    if (cspRequested) return;
    cspRequested = true;
    const url = "https://lrclib.net";
    const directives = ["connect-src"];
    try {
        const allowed = await VencordNative.csp.isDomainAllowed(url, directives);
        if (!allowed) {
            const result = await VencordNative.csp.requestAddOverride(url, directives, "DiscordLyricsSpotifyStatus");
            if (result === "ok") debugLog("CSP granted for lrclib.net. Restart Discord to apply.");
        }
    } catch {}
}

function parseLrc(lrc: string): LyricLine[] {
    const lines: LyricLine[] = [];
    const regex = /^\[(\d{2}):(\d{2})\.(\d{2,3})\]\s*(.*)$/;
    for (const rawLine of lrc.split("\n")) {
        const match = rawLine.trim().match(regex);
        if (!match) continue;
        const [, mm, ss, cs, text] = match;
        const ms = parseInt(mm, 10) * 60000 + parseInt(ss, 10) * 1000
            + (cs.length === 3 ? parseInt(cs, 10) : parseInt(cs, 10) * 10);
        lines.push({ timeMs: ms, text: text.trim() });
    }
    return lines.sort((a, b) => a.timeMs - b.timeMs);
}

function primaryArtist(artistName: string): string {
    return artistName.split(/,|\s+feat\.|\s+ft\./i)[0].trim();
}

async function fetchSynced(trackName: string, artistName: string, albumName: string, durationMs: number): Promise<string | null> {
    const attempts: { endpoint: string; params: URLSearchParams; }[] = [
        {
            endpoint: "get",
            params: new URLSearchParams({
                track_name: trackName,
                artist_name: primaryArtist(artistName),
                ...(albumName ? { album_name: albumName } : {}),
                ...(durationMs > 0 ? { duration: Math.round(durationMs / 1000).toString() } : {}),
            }),
        },
        {
            endpoint: "search",
            params: new URLSearchParams({ track_name: trackName, artist_name: primaryArtist(artistName) }),
        },
        {
            endpoint: "search",
            params: new URLSearchParams({ track_name: trackName }),
        },
    ];

    for (const { endpoint, params } of attempts) {
        const res = await fetch(`${BASE_URL}/${endpoint}?${params}`);
        if (res.status === 404) continue;
        if (!res.ok) throw new Error(`LRCLIB HTTP ${res.status}`);
        const data = await res.json();

        if (endpoint === "search") {
            const hit = (Array.isArray(data) ? data : []).find((r: any) => r?.syncedLyrics);
            if (hit?.syncedLyrics) return hit.syncedLyrics;
        } else {
            if (data?.syncedLyrics) return data.syncedLyrics;
        }
    }
    return null;
}

async function getLyrics(
    trackId: string,
    trackName: string,
    artistName: string,
    albumName = "",
    durationMs = 0,
    forceRefresh = false,
): Promise<LyricLine[] | null> {
    if (forceRefresh) cache.delete(trackId);
    if (cache.has(trackId)) return cache.get(trackId) ?? null;
    try {
        const syncedLyrics = await fetchSynced(trackName, artistName, albumName, durationMs);
        if (!syncedLyrics) return cacheAndReturn(trackId, null);

        const lines = parseLrc(syncedLyrics);
        debugLog("Lyrics loaded", { trackId, lines: lines.length, artist: primaryArtist(artistName) });
        return cacheAndReturn(trackId, lines);
    } catch (err: any) {
        if (err?.message?.includes("CSP") || err?.message?.includes("net::ERR_BLOCKED")) {
            debugLog("lrclib.net blocked by CSP - add https://lrclib.net (connect-src) in Equicord Settings → CSP");
        } else {
            debugLog("Fetch error", err?.message);
        }
        return cacheAndReturn(trackId, null);
    }
}

type QueueEntry = { body: any; label: string; fallbackBody?: any; };
const queue: QueueEntry[] = [];
let processing = false;
let lastText: string | null = null;
let lastEmojiKey: string | null = null;
let statusDebugEnabled = false;

function setStatusDebugMode(enabled: boolean) { statusDebugEnabled = enabled; }

function debugLogStatus(msg: string, extra?: unknown) {
    if (!statusDebugEnabled) return;
    extra === undefined
        ? console.info(`[DiscordLyricsSpotifyStatus] ${msg}`)
        : console.info(`[DiscordLyricsSpotifyStatus] ${msg}`, extra);
}

function enqueueLatest(entry: QueueEntry) {
    if (!processing) {
        queue.length = 0;
        queue.push(entry);
        debugLogStatus("Queued update", { label: entry.label });
        return;
    }
    const hasHead = queue.length > 0;
    queue.length = hasHead ? 1 : 0;
    queue.push(entry);
    debugLogStatus("Replaced stale queue", { label: entry.label });
}

function enqueueClear(entry: QueueEntry) {
    queue.push(entry);
    debugLogStatus("Queued clear");
}

async function processQueue() {
    if (processing) return;
    processing = true;

    while (queue.length > 0) {
        const entry = queue[0];
        try {
            await RestAPI.patch({ url: "/users/@me/settings", body: entry.body });
            debugLogStatus(`Status: ${entry.label}`);
            queue.shift();
        } catch (error: any) {
            const retryAfterMs = Math.ceil((error?.body?.retry_after ?? 1) * 1000);
            if (error?.status === 429) {
                if (queue.length > 1) { queue.shift(); continue; }
                debugLogStatus(`Rate limited, retrying in ${retryAfterMs}ms`);
                await new Promise(resolve => setTimeout(resolve, retryAfterMs));
                continue;
            }
            if (entry.fallbackBody) {
                queue[0] = { body: entry.fallbackBody, label: entry.label };
                continue;
            }
            debugLogStatus("Failed to update status", error);
            queue.shift();
        }
    }
    processing = false;
}

async function setCustomStatus(text: string, emojiName: string | null = null, emojiId: string | null = null) {
    const emojiKey = `${emojiName ?? ""}|${emojiId ?? ""}`;
    if (text === lastText && emojiKey === lastEmojiKey) return;
    lastText = text;
    lastEmojiKey = emojiKey;
    const sentText = text.slice(0, 127) + STATUS_MARKER;

    if (CustomStatusSetting) {
        try {
            await CustomStatusSetting.updateSetting({
                text: sentText,
                emojiName: emojiName || "",
                emojiId: emojiId || "0",
                createdAtMs: Date.now().toString(),
                expiresAtMs: "0",
            });
            debugLogStatus(`Status (native): ${text}`);
            return;
        } catch (err) {
            debugLogStatus("Native status update failed, falling back to REST", err);
        }
    }

    enqueueLatest({
        body: { custom_status: { text: sentText, emoji_name: emojiName, emoji_id: emojiId, expires_at: null } },
        fallbackBody: { customStatus: { text: sentText, emojiName, emojiId, expiresAt: null } },
        label: text,
    });
    void processQueue();
}

function clearCustomStatus() {
    if (lastText === null && lastEmojiKey === null) return;
    lastText = null;
    lastEmojiKey = null;
    enqueueClear({
        body: { custom_status: null },
        fallbackBody: { customStatus: null },
        label: "(clear)",
    });
    void processQueue();
}

function resetStatusCache() { lastText = null; lastEmojiKey = null; }

let statusManaged = false;
let originalStatus: { text: string; emojiName: string; emojiId: string; } | null = null;
let statusGeneration = 0;

function captureOriginalStatusIfNeeded() {
    if (statusManaged) return;
    statusManaged = true;
    try {
        const current = CustomStatusSetting?.getSetting?.();
        const isOwnStatus = !!current?.text && current.text.includes(STATUS_MARKER);
        const generic = getGenericRotatorSignal();

        if (generic.active) {
            originalStatus = null;
            debugLogStatus(`Skipped capture - another status source appears to be cycling (~${Math.round((generic.avgIntervalMs ?? 0) / 1000)}s interval)`, current);
            return;
        }

        originalStatus = (current && !isOwnStatus)
            ? { text: current.text || "", emojiName: current.emojiName || "", emojiId: current.emojiId || "0" }
            : null;

        if (isOwnStatus) debugLogStatus("Skipped capture - current status was set by this plugin (marker found)", current);
    } catch {
        originalStatus = null;
    }
    debugLogStatus("Captured original status", originalStatus);
}

function shouldRestoreStatus(): boolean {
    return settings.store.restoreStatusOnStop;
}

async function restoreOriginalStatus() {
    const myGeneration = statusGeneration;
    const snap = originalStatus;
    statusManaged = false;
    originalStatus = null;

    const liveNow = CustomStatusSetting?.getSetting?.();
    const isStillOurs = !!liveNow?.text && liveNow.text.includes(STATUS_MARKER);
    if (liveNow?.text && !isStillOurs) {
        debugLogStatus("Status was changed externally since we last set it - leaving it alone", liveNow);
        return;
    }

    const generic = getGenericRotatorSignal();
    if (generic.active) {
        debugLogStatus(`Another status source appears to be cycling on its own (~${Math.round((generic.avgIntervalMs ?? 0) / 1000)}s interval) - leaving status alone`);
        return;
    }

    const closeStatus = getRotatorSuiteCloseStatus();
    const cycleActive = isExternalStatusRotatorActive();

    if (!closeStatus && cycleActive) {
        debugLogStatus("Rotator Suite cycle is active with no On-Close configured - leaving status alone");
        return;
    }

    const target = closeStatus
        ? { text: closeStatus.text, emojiName: closeStatus.emojiName, emojiId: closeStatus.emojiId }
        : snap;

    if (!target || (!target.text && !target.emojiName && (!target.emojiId || target.emojiId === "0"))) {
        if (myGeneration === statusGeneration) clearCustomStatus();
        return;
    }

    debugLogStatus(closeStatus ? "Restoring using Rotator Suite On-Close status" : "Restoring captured original status", target);

    lastText = target.text || null;
    lastEmojiKey = `${target.emojiName || ""}|${(target.emojiId && target.emojiId !== "0") ? target.emojiId : ""}`;

    if (CustomStatusSetting) {
        try {
            await CustomStatusSetting.updateSetting({
                text: target.text,
                emojiName: target.emojiName,
                emojiId: target.emojiId,
                createdAtMs: Date.now().toString(),
                expiresAtMs: "0",
            });
            debugLogStatus("Restored previous status (native)", target);

            if (myGeneration !== statusGeneration) {
                debugLogStatus("A newer track started during restore - re-applying its status");
                const liveTrack = getCurrentTrack();
                if (liveTrack?.isPlaying) setFallbackTrackStatus(liveTrack);
            }
            return;
        } catch (err) {
            debugLogStatus("Native restore failed, falling back to REST", err);
        }
    }

    if (myGeneration !== statusGeneration) {
        debugLogStatus("A newer track started before the REST restore fallback - skipping");
        return;
    }

    const restEmojiId = target.emojiId && target.emojiId !== "0" ? target.emojiId : null;
    enqueueLatest({
        body: { custom_status: { text: target.text || null, emoji_name: target.emojiName || null, emoji_id: restEmojiId, expires_at: null } },
        fallbackBody: { customStatus: { text: target.text || null, emojiName: target.emojiName || null, emojiId: restEmojiId, expiresAt: null } },
        label: "(restore previous status)",
    });
    void processQueue();
}

function clamp(value: number, min: number, max: number) {
    return Math.min(Math.max(value, min), max);
}

function buildTrackId(state: any) {
    const trackId = state.track?.id;
    if (trackId) return trackId;
    const title = state.track?.name ?? "";
    const artist = state.track?.artists?.map((a: any) => a.name).join(", ") ?? "";
    return `${title}::${artist}`.toLowerCase().replace(/\s+/g, "-");
}

function getActivePlayerState(): any | null {
    const active = SpotifyStore.getActiveSocketAndDevice?.();
    const accountId = active?.socket?.accountId;
    if (!accountId) return null;
    return SpotifyStore.getPlayerState?.(accountId) ?? null;
}

function getTrackFromPresence(): SpotifyTrackState | null {
    const me = UserStore.getCurrentUser?.();
    if (!me?.id) return null;

    const activities = PresenceStore.getActivities?.(me.id) ?? [];
    const spotifyActivity = activities.find((a: any) =>
        a?.name === "Spotify" && (a?.details || a?.sync_id)
    );
    if (!spotifyActivity) return null;

    const now = Date.now();
    const start = Number(spotifyActivity?.timestamps?.start ?? now);
    const end = Number(spotifyActivity?.timestamps?.end ?? start);
    const durationMs = Math.max(0, end - start);
    const progressMs = durationMs > 0 ? clamp(now - start, 0, durationMs) : 0;
    const fallbackTrackId = `${spotifyActivity.details || ""}::${spotifyActivity.state || ""}`;

    return {
        isPlaying: durationMs > 0 ? now < (end + 1500) : true,
        trackId: spotifyActivity.sync_id || fallbackTrackId,
        trackName: spotifyActivity.details || "",
        artistName: spotifyActivity.state || "",
        albumName: "",
        progressMs,
        durationMs,
    };
}

function getCurrentTrack(): SpotifyTrackState | null {
    const state = getActivePlayerState();
    if (!state?.track) return getTrackFromPresence();

    const durationMs = state.track.duration ?? 0;
    const progressMs = clamp(Date.now() - state.startTime, 0, durationMs);
    const artistName = (state.track.artists ?? []).map((a: any) => a.name).filter(Boolean).join(", ");

    return {
        isPlaying: state.isPlaying !== false,
        trackId: buildTrackId(state),
        trackName: state.track.name ?? "",
        artistName,
        albumName: state.track.album?.name ?? "",
        progressMs,
        durationMs,
    };
}

function resolvePrefix(raw: string): { emojiName: string | null; emojiId: string | null; text: string; } {
    const trimmed = raw.trim();
    if (!trimmed) return { emojiName: null, emojiId: null, text: "" };

    const match = trimmed.match(CUSTOM_EMOJI_RE);
    if (match) return { emojiName: match[2], emojiId: match[3], text: "" };

    if (EMBEDDED_CUSTOM_EMOJI_RE.test(trimmed)) {
        debugLogStatus("Custom Discord emoji only renders as the status icon when it's the entire prefix value, not mixed with other text - falling back to plain text", trimmed);
    }

    return { emojiName: null, emojiId: null, text: trimmed };
}

function resolveInstrumentalPrefix(): { text: string; emojiName: string | null; emojiId: string | null; } {
    const raw = settings.store.instrumentalPrefix?.trim() ? settings.store.instrumentalPrefix : settings.store.lyricPrefix;
    const resolved = resolvePrefix(raw ?? "");
    const text = resolved.text || (resolved.emojiId ? "" : "♪");
    return { text, emojiName: resolved.emojiName, emojiId: resolved.emojiId };
}

function normalizeLyricLine(line: LyricLine): { text: string; emojiName: string | null; emojiId: string | null; } {
    const raw = line.text?.trim() ?? "";

    if ((settings.store.cleanInstrumentals && INSTRUMENTAL_RE.test(raw)) || raw.length < MIN_LYRIC_LENGTH) {
        const placeholder = resolveInstrumentalPrefix();
        return { text: placeholder.text, emojiName: placeholder.emojiName, emojiId: placeholder.emojiId };
    }

    const prefix = resolvePrefix(settings.store.lyricPrefix ?? "");
    const text = prefix.text ? `${prefix.text} ${raw}` : raw;
    return { text: text.slice(0, 128), emojiName: prefix.emojiName, emojiId: prefix.emojiId };
}

function getNextPollDelayMs() {
    const base = settings.store.pollIntervalMs ?? 500;
    if (!settings.store.trackSwitchBoost) return base;
    return Date.now() < boostUntilMs ? BOOST_POLL_INTERVAL_MS : base;
}

function stopScheduler() {
    if (!scheduler) return;
    scheduler.stop();
    scheduler = null;
}

function onLineChange(line: LyricLine) {
    const { text, emojiName, emojiId } = normalizeLyricLine(line);
    void setCustomStatus(text, emojiName, emojiId);
}

function resetRuntimeState() {
    currentTrackId = null;
    lastProgressMs = 0;
    lastPollTime = 0;
    trackLoadToken = 0;
    boostUntilMs = 0;
    statusManaged = false;
    originalStatus = null;
}

function setFallbackTrackStatus(track: SpotifyTrackState) {
    if (!settings.store.fallbackTrackText) { clearCustomStatus(); return; }
    const raw = settings.store.titlePrefix?.trim() ? settings.store.titlePrefix : settings.store.lyricPrefix;
    const prefix = resolvePrefix(raw ?? "");
    const text = prefix.text
        ? `${prefix.text} ${track.trackName} · ${track.artistName}`
        : `${track.trackName} · ${track.artistName}`;
    void setCustomStatus(text.slice(0, 128), prefix.emojiName, prefix.emojiId);
}

function shouldIgnore(loadToken: number, trackId: string) {
    return loadToken !== trackLoadToken || currentTrackId !== trackId;
}

async function handleTrackChange(track: SpotifyTrackState, now: number) {
    debugLog("Track changed", { from: currentTrackId, to: track.trackId, name: track.trackName });

    stopScheduler();
    statusGeneration++;
    currentTrackId = track.trackId;
    const loadToken = ++trackLoadToken;
    const requestStartedAt = Date.now();

    if (settings.store.trackSwitchBoost) boostUntilMs = now + TRACK_SWITCH_BOOST_WINDOW_MS;

    try {
        captureOriginalStatusIfNeeded();
    } catch (err) {
        debugLogStatus("captureOriginalStatusIfNeeded failed, continuing anyway", err);
    }

    setFallbackTrackStatus(track);

    const lyrics = await getLyrics(
        track.trackId,
        track.trackName,
        track.artistName,
        track.albumName,
        track.durationMs,
        settings.store.forceRefreshOnTrackSwitch,
    );

    const liveTrack = getCurrentTrack();
    if (!liveTrack?.isPlaying || liveTrack.trackId !== track.trackId) {
        debugLog("Dropping lyrics - track changed during fetch");
        return;
    }
    if (shouldIgnore(loadToken, track.trackId)) {
        debugLog("Ignoring stale lyric response");
        return;
    }
    if (!lyrics?.length) {
        debugLog("No synced lyrics found, keeping fallback");
        return;
    }

    const rawProgress = liveTrack.progressMs || (track.progressMs + (Date.now() - requestStartedAt));
    const freshProgressMs = rawProgress + (settings.store.syncOffsetMs ?? 50);
    scheduler = new LyricScheduler(lyrics, onLineChange);
    scheduler.start(freshProgressMs);
    debugLog("Scheduler started", { lines: lyrics.length, progress: freshProgressMs });
}

function syncSchedulerDrift(track: SpotifyTrackState, now: number) {
    if (!scheduler || lastPollTime <= 0) return;
    const drift = Math.abs(track.progressMs - (lastProgressMs + (now - lastPollTime)));
    if (drift <= SEEK_THRESHOLD_MS) return;
    debugLog("Drift detected, resyncing", { drift, progress: track.progressMs });
    scheduler.restart(track.progressMs + (settings.store.syncOffsetMs ?? 50));
}

async function poll() {
    const track = getCurrentTrack();
    const now = Date.now();

    trackExternalStatusChanges();

    if (!track?.isPlaying) {
        if (currentTrackId !== null) {
            stopScheduler();
            currentTrackId = null;
            if (shouldRestoreStatus()) {
                void restoreOriginalStatus();
            } else if (settings.store.clearOnStop) {
                clearCustomStatus();
            }
        }
        lastPollTime = now;
        return;
    }

    if (track.trackId !== currentTrackId) {
        void handleTrackChange(track, now);
    } else {
        syncSchedulerDrift(track, now);
    }

    lastProgressMs = track.progressMs;
    lastPollTime = now;
}

function startPolling() {
    stopPolling();
    resetRuntimeState();
    stopScheduler();
    resetStatusCache();
    setLyricsDebugMode(settings.store.debugMode);
    setStatusDebugMode(settings.store.debugMode);
    pollingActive = true;

    const loop = async () => {
        if (!pollingActive) return;
        await poll();
        if (!pollingActive) return;
        pollTimer = window.setTimeout(() => void loop(), getNextPollDelayMs());
    };

    void loop();
}

function stopPolling() {
    pollingActive = false;
    if (pollTimer !== null) { window.clearTimeout(pollTimer); pollTimer = null; }
}

function forceRefresh() {
    if (!currentTrackId) return;
    clearLyricsCache(currentTrackId);
    trackLoadToken++;
    currentTrackId = null;
    void poll();
}

export default definePlugin({
    name: "DiscordLyricsSpotifyStatus",
    description: "Shows synced Spotify lyrics as your Discord custom status in real time - by Naxiwow (github.com/Naxiwow)",
    authors: [{ name: "Naxiwow", id: 875342291001278504n }, { name: "zfrancesck1", id: 456195985404592149n }],
    tags: ["Spotify", "Media", "Appearance", "Customisation"],
    enabledByDefault: false,
    requiresRestart: false,
    settings,

    start() {
        void initLyricsNetworkAccess();
        (globalThis as any).discordLyricsSpotifyStatusForceRefresh = forceRefresh;
        startPolling();
    },

    stop() {
        stopPolling();
        stopScheduler();
        currentTrackId = null;
        trackLoadToken++;
        delete (globalThis as any).discordLyricsSpotifyStatusForceRefresh;
        if (shouldRestoreStatus()) {
            void restoreOriginalStatus();
        } else if (settings.store.clearOnStop) {
            clearCustomStatus();
        }
    },
});