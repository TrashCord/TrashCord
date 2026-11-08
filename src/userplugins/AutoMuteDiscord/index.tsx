/*
 * TrashCord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { NavContextMenuPatchCallback } from "@api/ContextMenu";
import { definePluginSettings } from "@api/Settings";
import { Logger } from "@utils/Logger";
import definePlugin, { makeRange, OptionType } from "@utils/types";
import { findStoreLazy } from "@webpack";
import type { User } from "@vencord/discord-types";
import { ChannelStore, FluxDispatcher, Menu, SelectedChannelStore, showToast, UserStore } from "@webpack/common";

const MediaEngineStore = findStoreLazy("MediaEngineStore");
const VoiceStateStore = findStoreLazy("VoiceStateStore");
const RelationshipStore = findStoreLazy("RelationshipStore");

const logger = new Logger("AutoMuteDiscord");

const settings = definePluginSettings({
    threshold: {
        type: OptionType.SLIDER,
        description: "Loudness threshold (% of max level). Lower = mutes more easily. Use 'Debug levels' to calibrate.",
        markers: makeRange(5, 100, 5),
        default: 92,
        stickToMarkers: false
    },
    attackMs: {
        type: OptionType.NUMBER,
        description: "How long (ms) someone must stay above the threshold before they get muted. Avoids reacting to single pops.",
        default: 500
    },
    earrapeStayMuted: {
        type: OptionType.BOOLEAN,
        description: "Keep people muted after going over the threshold (until they leave or you unmute them). Off = unmute them once they quiet down.",
        default: true
    },
    releaseMs: {
        type: OptionType.NUMBER,
        description: "Only if 'stay muted' is off: how long (ms) they must be quiet before they get unmuted",
        default: 2000
    },
    ignoreFriends: {
        type: OptionType.BOOLEAN,
        description: "Never mute your friends",
        default: true
    },
    talkLimitSeconds: {
        type: OptionType.NUMBER,
        description: "Mute anyone who talks non-stop for this many seconds (0 = off)",
        default: 10
    },
    talkMuteSeconds: {
        type: OptionType.NUMBER,
        description: "How long (seconds) they stay muted for talking too long (0 = until they leave or you unmute them)",
        default: 15
    },
    talkLevel: {
        type: OptionType.SLIDER,
        description: "Level (%) that counts as talking for the non-stop talking check",
        markers: makeRange(1, 20, 1),
        default: 5,
        stickToMarkers: false
    },
    talkGapMs: {
        type: OptionType.NUMBER,
        description: "A pause longer than this (ms) resets the non-stop talking timer",
        default: 700
    },
    muteFakeDeafen: {
        type: OptionType.BOOLEAN,
        description: "Auto-mute anyone who shows as muted/deafened but is still sending voice (fake deafen / fake mute)",
        default: true
    },
    muteStereo: {
        type: OptionType.BOOLEAN,
        description: "Auto-mute anyone using a stereo mic (stays muted until they leave or you disable the plugin)",
        default: true
    },
    stereoBitrateMultiplier: {
        type: OptionType.SLIDER,
        description: "Stereo detection: flag anyone sending more than this many times the channel's bitrate (stereo mic mods crank bitrate way up)",
        markers: [1.25, 1.5, 2, 2.5, 3],
        default: 1.5,
        stickToMarkers: false
    },
    notify: {
        type: OptionType.BOOLEAN,
        description: "Show a notification at the top of Discord when someone gets muted",
        default: true
    },
    pollMs: {
        type: OptionType.NUMBER,
        description: "How often (ms) to check levels. Lower = faster reaction, slightly more CPU.",
        default: 100,
        restartNeeded: true
    },
    includeStreams: {
        type: OptionType.BOOLEAN,
        description: "Also watch Go Live / screen share audio for loudness (streams are never stereo-muted)",
        default: true
    },
    debug: {
        type: OptionType.BOOLEAN,
        description: "Debug: log levels and each user's raw audio stats to the console (Ctrl+Shift+I)",
        default: false
    },
    // userId -> name of people marked as stereo mic. Saved, so they get muted in every call.
    stereoUsers: {
        type: OptionType.CUSTOM,
        default: {} as Record<string, string>
    }
});

type Conn = {
    context: "default" | "stream";
    getStats(): Promise<any>;
    setLocalVolume(userId: string, volume: number): void;
};

interface Tracker {
    conn: Conn;
    userId: string;
    loudSince: number | null;
    quietSince: number | null;
    muted: boolean;
    reason: Reason | null;
    stereo: boolean;
    dumped: boolean;
    lastBytes: number | null;
    lastPkts: number | null;
    winStart: number;
    winBytes: number;
    winPkts: number;
    overCount: number;
    talkStart: number | null;
    lastSpoke: number | null;
    mutedUntil: number;
    fakeSince: number | null;
    fake: boolean;
}

type Reason = "stereo" | "earrape" | "talking" | "fakedeafen" | "manual";

// key = context:userId
const trackers = new Map<string, Tracker>();
// userId -> reasons you manually unmuted them for. Cleared when they leave the call.
const exempt = new Map<string, Set<Reason>>();
let timer: ReturnType<typeof setInterval> | null = null;
let busy = false;

// Discord reports audioLevel as 0..1
function normalise(level: number) {
    return Number.isFinite(level) ? Math.min(Math.max(level, 0), 1) : 0;
}

// Stereo shows up differently depending on the client, so check every place it could be.
function isStereo(e: any) {
    if (e.channels === 2 || e.codec?.channels === 2 || e.audioChannels === 2) return true;
    const fmtp = e.sdpFmtpLine ?? e.codec?.sdpFmtpLine ?? e.codec?.params ?? e.fmtp ?? "";
    return typeof fmtp === "string" && /stereo=1/.test(fmtp);
}

interface UserAudio { level: number; stereo: boolean; bytes: number; pkts: number; raw: any[]; }

function extractUsers(stats: any): Map<string, UserAudio> {
    const out = new Map<string, UserAudio>();
    const inbound = stats?.rtp?.inbound;
    if (!inbound || typeof inbound !== "object") return out;

    for (const [userId, entries] of Object.entries<any>(inbound)) {
        const list = (Array.isArray(entries) ? entries : [entries])
            .filter(e => e && (!e.type || e.type === "audio"));
        if (!list.length) continue;

        const u: UserAudio = { level: 0, stereo: false, bytes: 0, pkts: 0, raw: list };
        for (const e of list) {
            if (typeof e.bytesReceived === "number") u.bytes += e.bytesReceived;
            if (typeof e.packetsReceived === "number") u.pkts += e.packetsReceived;
            const raw = e.audioLevel ?? e.audio_level ?? e.level;
            if (typeof raw === "number") u.level = Math.max(u.level, normalise(raw));
            if (isStereo(e)) u.stereo = true;
        }
        out.set(userId, u);
    }
    return out;
}

function channelKbps() {
    const id = SelectedChannelStore.getVoiceChannelId();
    const bitrate = id ? (ChannelStore.getChannel(id) as any)?.bitrate : null;
    return (bitrate || 64000) / 1000;
}

const WINDOW_MS = 3000;
const PACKET_SECONDS = 0.02;

// The desktop voice engine doesn't expose the channel count, but stereo mic mods almost always
// push the bitrate far above what Discord allows for the channel. Measure bitrate per *packet*
// (not per second) so silence / DTX doesn't drag the number down.
function checkBitrate(t: Tracker, audio: UserAudio, now: number, debugOut: Record<string, string>, key: string) {
    if (t.lastBytes != null && t.lastPkts != null) {
        const db = audio.bytes - t.lastBytes;
        const dp = audio.pkts - t.lastPkts;
        if (dp > 0 && db >= 0) {
            t.winBytes += db;
            t.winPkts += dp;
        }
    }
    t.lastBytes = audio.bytes;
    t.lastPkts = audio.pkts;

    if (now - t.winStart < WINDOW_MS) return false;

    let flagged = false;
    // need at least ~1s of actual audio in the window to judge
    if (t.winPkts >= 50) {
        const kbps = t.winBytes * 8 / (t.winPkts * PACKET_SECONDS) / 1000;
        const limit = channelKbps() * settings.store.stereoBitrateMultiplier;
        if (settings.store.debug) debugOut[key + " kbps"] = `${Math.round(kbps)} (limit ${Math.round(limit)})`;
        t.overCount = kbps > limit ? t.overCount + 1 : 0;
        flagged = t.overCount >= 2;
    }
    t.winStart = now;
    t.winBytes = 0;
    t.winPkts = 0;
    return flagged;
}

function displayName(userId: string) {
    const u = UserStore.getUser(userId) as any;
    return u?.globalName || u?.username || "Someone";
}

function notify(text: string) {
    if (!settings.store.notify) return;
    try {
        showToast({ text, position: "top" });
    } catch (e) {
        logger.error("showToast failed", e);
    }
}

// Uses Discord's own per-user "Mute" (the checkbox in the right-click menu), so it always shows
// in Discord's UI and can always be undone from there, even if the plugin gets confused.
function setLocalMute(userId: string, context: string, mute: boolean) {
    try {
        if (MediaEngineStore.isLocalMute(userId, context) === mute) return;
        FluxDispatcher.dispatch({ type: "AUDIO_TOGGLE_LOCAL_MUTE", context, userId });
    } catch (e) {
        logger.error("toggle local mute failed", e);
    }
}

// Older versions muted by forcing the connection volume to 0. Put it back to the saved volume.
function restoreVolume(userId: string, context: string, force = false) {
    let normal = MediaEngineStore.getLocalVolume(userId, context) ?? 100;
    if (force && normal <= 0) {
        normal = 100;
        FluxDispatcher.dispatch({ type: "AUDIO_SET_LOCAL_VOLUME", context, userId, volume: normal });
    }
    MediaEngineStore.getMediaEngine()?.eachConnection?.((c: Conn) => {
        if (c.context !== context) return;
        try { c.setLocalVolume(userId, normal); } catch { }
    });
}

// userId -> the last reason they were muted for, so you can mute them back after they get unmuted
const lastReason = new Map<string, Reason>();

function setMuted(t: Tracker, muted: boolean, reason: Reason | null = null) {
    setLocalMute(t.userId, t.conn.context, muted);
    t.muted = muted;
    t.reason = muted ? reason : null;
    if (muted && reason && reason !== "manual") lastReason.set(t.userId, reason);
}

// userId -> reason you manually muted them for. Stays muted until you unmute them or they leave.
const forced = new Map<string, Reason>();

function isIgnoredFriend(userId: string) {
    if (!settings.store.ignoreFriends) return false;
    try {
        return RelationshipStore.isFriend(userId);
    } catch {
        return false;
    }
}

async function tick() {
    if (busy) return;
    busy = true;
    try {
        const { threshold, attackMs, releaseMs, includeStreams, muteStereo, debug } = settings.store;
        const thr = threshold / 100;
        const now = Date.now();

        const conns: Conn[] = [];
        MediaEngineStore.getMediaEngine()?.eachConnection?.((c: Conn) => {
            if (c.context === "stream" && !includeStreams) return;
            conns.push(c);
        });

        const seen = new Set<string>();
        const debugOut: Record<string, string> = {};

        await Promise.all(conns.map(async conn => {
            let stats;
            try { stats = await conn.getStats(); } catch { return; }

            for (const [userId, audio] of extractUsers(stats)) {
                const { level } = audio;
                const key = `${conn.context}:${userId}`;
                seen.add(key);

                let t = trackers.get(key);
                if (!t) {
                    trackers.set(key, t = { conn, userId, loudSince: null, quietSince: null, muted: false, reason: null, stereo: false, dumped: false, lastBytes: null, lastPkts: null, winStart: now, winBytes: 0, winPkts: 0, overCount: 0, talkStart: null, lastSpoke: null, mutedUntil: 0, fakeSince: null, fake: false });
                    // clear any volume left at 0 by an earlier version of the plugin
                    restoreVolume(userId, conn.context);
                }
                t.conn = conn;

                if (debug) {
                    debugOut[key] = `${Math.round(level * 100)}%${audio.stereo ? " (stereo)" : ""}`;
                    if (!t.dumped) {
                        t.dumped = true;
                        logger.info(`raw stats for ${displayName(userId)} (${key})`, audio.raw);
                    }
                }

                const overBitrate = conn.context === "default" && checkBitrate(t, audio, now, debugOut, key);

                if (isIgnoredFriend(userId)) {
                    if (t.muted) setMuted(t, false);
                    continue;
                }

                const forcedReason = forced.get(userId);
                if (forcedReason) {
                    if (!t.muted) setMuted(t, true, forcedReason);
                    continue;
                }

                // you muted them yourself in Discord: leave them alone
                if (!t.muted && MediaEngineStore.isLocalMute(userId, conn.context)) continue;

                const isExempt = (r: Reason) => exempt.get(userId)?.has(r) ?? false;

                const listed = !!settings.store.stereoUsers[userId];
                if (muteStereo && conn.context === "default" && (audio.stereo || overBitrate || listed) && !t.stereo && !isExempt("stereo")) {
                    t.stereo = true;
                    if (!listed) setStereoListed(userId, true);
                    setMuted(t, true, "stereo");
                    notify(`${displayName(userId)} has a stereo mic LOL`);
                    logger.info(`Muted ${key} for stereo mic`);
                    continue;
                }
                if (t.stereo) continue; // stays muted while they're in the call

                // Someone shown as self-muted/deafened shouldn't be sending any voice at all.
                // If audio keeps coming from them for a second, their client is faking it.
                if (settings.store.muteFakeDeafen && conn.context === "default" && !t.fake && !isExempt("fakedeafen")) {
                    const vs = VoiceStateStore.getVoiceStateForUser(userId);
                    const claimsSilent = vs?.selfDeaf || vs?.selfMute;
                    if (claimsSilent && level >= settings.store.talkLevel / 100) {
                        t.fakeSince ??= now;
                        if (now - t.fakeSince >= 1000) {
                            t.fake = true;
                            setMuted(t, true, "fakedeafen");
                            notify(`${displayName(userId)} is fake ${vs.selfDeaf ? "deafened" : "muted"} LOL`);
                            logger.info(`Muted ${key} for fake deafen/mute`);
                            continue;
                        }
                    } else if (!claimsSilent || level < 0.01) {
                        t.fakeSince = null;
                    }
                }
                if (t.fake) continue; // stays muted while they're in the call

                if (t.muted && t.reason === "talking") {
                    if (now >= t.mutedUntil) {
                        setMuted(t, false);
                        t.talkStart = t.lastSpoke = null;
                        logger.info(`Unmuted ${key} (talk timeout over)`);
                    }
                    continue;
                }

                const { talkLimitSeconds, talkMuteSeconds, talkLevel, talkGapMs } = settings.store;
                if (talkLimitSeconds > 0 && conn.context === "default" && !t.muted && !isExempt("talking")) {
                    if (level >= talkLevel / 100) {
                        t.lastSpoke = now;
                        t.talkStart ??= now;
                    } else if (t.lastSpoke == null || now - t.lastSpoke > talkGapMs) {
                        t.talkStart = null;
                    }

                    if (t.talkStart != null && now - t.talkStart >= talkLimitSeconds * 1000) {
                        setMuted(t, true, "talking");
                        t.mutedUntil = talkMuteSeconds > 0 ? now + talkMuteSeconds * 1000 : Infinity;
                        t.talkStart = t.lastSpoke = null;
                        notify(`${displayName(userId)} has been muted for talking too long LOL`);
                        logger.info(`Muted ${key} for talking ${talkLimitSeconds}s straight`);
                        continue;
                    }
                }

                if (level >= thr) {
                    t.quietSince = null;
                    t.loudSince ??= now;
                    if (!t.muted && !isExempt("earrape") && now - t.loudSince >= attackMs) {
                        setMuted(t, true, "earrape");
                        notify(`${displayName(userId)} has been muted for earrape LOL`);
                        logger.info(`Muted ${key} (level ${Math.round(level * 100)}%)`);
                    }
                } else {
                    t.loudSince = null;
                    if (t.muted && t.reason === "earrape" && !settings.store.earrapeStayMuted && !forced.has(userId)) {
                        t.quietSince ??= now;
                        if (now - t.quietSince >= releaseMs) {
                            setMuted(t, false);
                            t.quietSince = null;
                            logger.info(`Unmuted ${key}`);
                        }
                    }
                }
            }
        }));

        if (debug && Object.keys(debugOut).length) logger.info("levels", debugOut, "threshold", `${threshold}%`);

        // people who left the call
        for (const [key, t] of trackers) {
            if (seen.has(key)) continue;
            if (t.muted) setMuted(t, false);
            trackers.delete(key);
        }
        const present = new Set([...trackers.values()].map(t => t.userId));
        for (const userId of [...exempt.keys(), ...forced.keys(), ...lastReason.keys(), ...forceUnmuted]) {
            if (present.has(userId)) continue;
            exempt.delete(userId);
            forced.delete(userId);
            lastReason.delete(userId);
            forceUnmuted.delete(userId);
        }
    } catch (e) {
        logger.error("tick failed", e);
    } finally {
        busy = false;
    }
}

const REASON_NAME: Record<Exclude<Reason, "manual">, string> = {
    stereo: "Stereo Mic",
    talking: "Talking Too Long",
    fakedeafen: "Fake Deafen",
    earrape: "Prepare For Earrape"
};

// users you pressed Force Unmute on (so the menu offers Force Mute next)
const forceUnmuted = new Set<string>();

function userTrackers(userId: string) {
    return [...trackers.values()].filter(t => t.userId === userId);
}

function resetTracker(t: Tracker) {
    t.stereo = false;
    t.fake = false;
    t.fakeSince = null;
    t.loudSince = t.quietSince = null;
    t.overCount = 0;
    t.talkStart = t.lastSpoke = null;
}

function manualUnmute(userId: string, reason: Reason) {
    forced.delete(userId);
    let set = exempt.get(userId);
    if (!set) exempt.set(userId, set = new Set());
    set.add(reason);

    for (const t of userTrackers(userId)) {
        resetTracker(t);
        setMuted(t, false);
    }
    showToast({ text: `Unmuted ${displayName(userId)}`, position: "top" });
}

function manualMute(userId: string, reason: Reason) {
    exempt.get(userId)?.delete(reason);
    forceUnmuted.delete(userId);
    forced.set(userId, reason);

    for (const t of userTrackers(userId)) setMuted(t, true, reason);
    showToast({ text: `Muted ${displayName(userId)}`, position: "top" });
}

function forceUnmute(userId: string) {
    forced.delete(userId);
    exempt.set(userId, new Set<Reason>(["stereo", "earrape", "talking", "fakedeafen"]));
    forceUnmuted.add(userId);

    for (const t of userTrackers(userId)) {
        resetTracker(t);
        t.muted = false;
        t.reason = null;
    }
    for (const ctx of ["default", "stream"]) {
        setLocalMute(userId, ctx, false);
        restoreVolume(userId, ctx, true);
    }
    showToast({ text: `Force unmuted ${displayName(userId)}`, position: "top" });
}

function setStereoListed(userId: string, listed: boolean) {
    const list = { ...settings.store.stereoUsers };
    if (listed) list[userId] = displayName(userId);
    else delete list[userId];
    settings.store.stereoUsers = list;
}

function markStereo(userId: string) {
    setStereoListed(userId, true);
    exempt.get(userId)?.delete("stereo");
    forceUnmuted.delete(userId);
    for (const t of userTrackers(userId)) {
        if (t.conn.context !== "default") continue;
        t.stereo = true;
        setMuted(t, true, "stereo");
    }
    notify(`${displayName(userId)} has a stereo mic LOL`);
}

function unmarkStereo(userId: string) {
    setStereoListed(userId, false);
    if (userTrackers(userId).some(t => t.muted && t.reason === "stereo")) manualUnmute(userId, "stereo");
    else showToast({ text: `${displayName(userId)} removed from stereo list`, position: "top" });
}

function forceMute(userId: string) {
    forceUnmuted.delete(userId);
    forced.set(userId, "manual");
    for (const t of userTrackers(userId)) setMuted(t, true, "manual");
    showToast({ text: `Force muted ${displayName(userId)}`, position: "top" });
}

const UserContextMenuPatch: NavContextMenuPatchCallback = (children, { user }: { user?: User; }) => {
    if (!user) return;
    if (isIgnoredFriend(user.id)) return;
    const ts = userTrackers(user.id);
    if (!ts.length) return;

    const muted = ts.find(t => t.muted && t.reason);
    const reason = muted?.reason ?? lastReason.get(user.id);

    if (reason && reason !== "manual") {
        children.push(muted
            ? <Menu.MenuItem
                id="vc-automute-toggle"
                label={`Unmute ${REASON_NAME[reason]}`}
                action={() => manualUnmute(user.id, reason)}
            />
            : <Menu.MenuItem
                id="vc-automute-toggle"
                label={`Mute ${REASON_NAME[reason]}`}
                action={() => manualMute(user.id, reason)}
            />
        );
    }

    children.push(settings.store.stereoUsers[user.id]
        ? <Menu.MenuItem
            id="vc-automute-stereo-list"
            label="Unmark Stereo Mic"
            action={() => unmarkStereo(user.id)}
        />
        : <Menu.MenuItem
            id="vc-automute-stereo-list"
            label="Mark As Stereo Mic"
            action={() => markStereo(user.id)}
        />
    );

    children.push(forceUnmuted.has(user.id)
        ? <Menu.MenuItem
            id="vc-automute-force"
            label="Force Mute"
            action={() => forceMute(user.id)}
        />
        : <Menu.MenuItem
            id="vc-automute-force"
            label="Force Unmute"
            action={() => forceUnmute(user.id)}
        />
    );
};

const AUTHOR_AVATAR = "data:image/jpeg;base64,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";

function About() {
    return (
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
            <img src={AUTHOR_AVATAR} alt="lyix" width={48} height={48} style={{ borderRadius: "50%" }} />
            <span style={{ color: "var(--text-normal)", fontWeight: 600 }}>Made by lyix</span>
        </div>
    );
}

export default definePlugin({
    name: "AutoMuteDiscord",
    description: "Auto-mutes loud mics, stereo mics, fake deafeners, and people who won't stop talking (only for you), with notifications and right-click unmute.",
    authors: [{ name: "lyix", id: 348635089825169422n }],
    tags: ["Voice", "Utility"],
    enabledByDefault: false,
    settings,
    settingsAboutComponent: About,

    contextMenus: {
        "user-context": UserContextMenuPatch
    },

    start() {
        timer = setInterval(tick, Math.max(30, settings.store.pollMs));
    },

    stop() {
        if (timer) clearInterval(timer);
        timer = null;
        for (const t of trackers.values()) if (t.muted) setMuted(t, false);
        trackers.clear();
        exempt.clear();
        forced.clear();
        lastReason.clear();
        forceUnmuted.clear();
    }
});
