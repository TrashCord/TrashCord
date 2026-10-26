/*
 * TrashCord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { NavContextMenuPatchCallback } from "@api/ContextMenu";
import { definePluginSettings } from "@api/Settings";
import { HeadingSecondary } from "@components/Heading";
import definePlugin, { OptionType } from "@utils/types";
import { findByPropsLazy } from "@webpack";
import {
    ChannelStore,
    Constants,
    FluxDispatcher,
    GuildMemberStore,
    GuildStore,
    Menu,
    PermissionsBits,
    PermissionStore,
    RestAPI,
    SelectedChannelStore,
    showToast,
    UserStore,
} from "@webpack/common";

const ChannelActionsRaw: { selectVoiceChannel: (...args: any[]) => any; } =
    findByPropsLazy("selectVoiceChannel", "disconnect");

let originalSelectVoiceChannel: ((...args: any[]) => any) | null = null;
let originalPatch: ((...args: any[]) => Promise<any>) | null = null;

// AntiMove helpers: distinguish user clicks from forced moves
let lastUserSelectAt = 0;
let ignoreMoveTo: string | null = null;

const NICK_ENDPOINT_RE1 = /^\/users\/@me\/guilds\/\w+\/profile$/;
const NICK_ENDPOINT_RE2 = /^\/guilds\/\w+\/members\/@me$/;
const NICK_GUILD_RE = /\/guilds\/(\w+)/;

// Called only when the USER (or Discord itself) selects a voice channel.
function patchedSelectVoiceChannel(...args: any[]) {
    lastUserSelectAt = Date.now();
    return (originalSelectVoiceChannel as any)(...args);
}

// Called by the plugin: bypasses the wrapper so it is not seen as a manual action.
function internalSelectVoiceChannel(channelId: string) {
    (originalSelectVoiceChannel ?? ChannelActionsRaw.selectVoiceChannel)(channelId);
}

interface VoiceState {
    userId: string;
    channelId?: string;
    oldChannelId?: string;
    guildId?: string;
    deaf: boolean;
    mute: boolean;
    selfDeaf: boolean;
    selfMute: boolean;
    selfStream: boolean;
    selfVideo: boolean;
    sessionId: string;
    suppress: boolean;
    requestToSpeakTimestamp: string | null;
}

let myUserId: string | null = null;
let manualDisconnect = false;
let retryCount = 0;
let rejoinTimeout: ReturnType<typeof setTimeout> | null = null;
let isRejoining = false;
let voiceFixInFlight = false;

let _antiNickChangerEnabled = false;
let _antiMove = false;
let _antiDisconnect = false;
let _antiMuteServer = false;
let _antiDeafenServer = false;
let _ignoreManualDisconnect = true;

function syncSettingsCache() {
    const s = settings.store;
    _antiNickChangerEnabled = s.antiNickChanger;
    _antiMove = s.antiMove;
    _antiDisconnect = s.antiDisconnect;
    _antiMuteServer = s.antiMuteServer;
    _antiDeafenServer = s.antiDeafenServer;
    _ignoreManualDisconnect = s.ignoreManualDisconnect;
}

const savedNicks = new Map<string, string | null>();
// Nick changes made by YOU: guildId -> the nick you set (expires, so no timers needed)
const selfChangingNicks = new Map<string, { nick: string | null; until: number; }>();
const resettingNickGuilds = new Set<string>();   // restore request in flight
const pendingNickGuilds = new Set<string>();     // changed again while a restore was in flight
const restoreWindow = new Map<string, { start: number; count: number; }>(); // loop guard
let preferProfileEndpoint = true;

let _nickChangerSubscribed = false;

function onGuildMemberUpdate({ guildId, user, nick }: {
    guildId: string;
    user: { id: string; };
    nick: string | null;
}) {
    if (!myUserId || user.id !== myUserId) return;
    const current = nick || null;

    // Your own change: accept it only if it matches what you actually set
    const own = selfChangingNicks.get(guildId);
    if (own && own.until > Date.now() && own.nick === current) {
        selfChangingNicks.delete(guildId);
        savedNicks.set(guildId, current);
        return;
    }

    if (!savedNicks.has(guildId)) {
        savedNicks.set(guildId, current);
        return;
    }

    if (current === savedNicks.get(guildId)) return;

    // Someone else changed it: restore right away
    restoreNick(guildId, current ?? "");
}

function populateSavedNicks() {
    if (!myUserId) return;
    savedNicks.clear();
    const uid = myUserId;
    for (const guildId of Object.keys(GuildStore.getGuilds())) {
        const member = GuildMemberStore.getMember(guildId, uid);
        if (member != null) savedNicks.set(guildId, member.nick || null);
    }
}

function subscribeNickChanger() {
    if (_nickChangerSubscribed) return;
    populateSavedNicks();
    FluxDispatcher.subscribe("GUILD_MEMBER_UPDATE", onGuildMemberUpdate);
    _nickChangerSubscribed = true;
}

function unsubscribeNickChanger() {
    if (!_nickChangerSubscribed) return;
    FluxDispatcher.unsubscribe("GUILD_MEMBER_UPDATE", onGuildMemberUpdate);
    _nickChangerSubscribed = false;
    savedNicks.clear();
    pendingNickGuilds.clear();
}

function SectionSeparator(title: string) {
    return (
        <>
            <hr style={{ width: "100%" }} />
            <HeadingSecondary>{title}</HeadingSecondary>
            <hr style={{ width: "100%" }} />
        </>
    );
}

const settings = definePluginSettings({
    antiDisconnectHeader: {
        type: OptionType.COMPONENT,
        component: () => SectionSeparator("AntiDisconnect"),
    },
    antiDisconnect: {
        type: OptionType.BOOLEAN,
        description: "Automatically rejoin the voice channel if you get disconnected by someone else.",
        default: false,
    },
    rejoinDelay: {
        type: OptionType.NUMBER,
        description: "Delay in milliseconds before attempting to rejoin (0 = instant).",
        default: 250,
    },
    maxRetries: {
        type: OptionType.NUMBER,
        description: "Maximum number of rejoin attempts before giving up (0 = unlimited).",
        default: 0,
    },
    ignoreManualDisconnect: {
        type: OptionType.BOOLEAN,
        description: "Do not rejoin if you manually clicked Disconnect yourself.",
        default: true,
    },
    antiMoveHeader: {
        type: OptionType.COMPONENT,
        component: () => SectionSeparator("AntiMove"),
    },
    antiMove: {
        type: OptionType.BOOLEAN,
        description: "Prevent others from moving you to a different voice channel. Your own manual moves are allowed.",
        default: false,
    },
    antiNickChangerHeader: {
        type: OptionType.COMPONENT,
        component: () => SectionSeparator("AntiNickChanger"),
    },
    antiNickChanger: {
        type: OptionType.BOOLEAN,
        description: "Restore your nickname if someone else changes it. Your own nick changes are respected.",
        default: false,
    },
    antiMuteDeafenServerHeader: {
        type: OptionType.COMPONENT,
        component: () => SectionSeparator("Anti Mute & Deafen Server"),
    },
    antiMuteServer: {
        type: OptionType.BOOLEAN,
        description: "Automatically unmute yourself if server-muted by someone else (requires MUTE_MEMBERS permission).",
        default: false,
    },
    antiDeafenServer: {
        type: OptionType.BOOLEAN,
        description: "Automatically undeafen yourself if server-deafened by someone else (requires DEAFEN_MEMBERS permission).",
        default: false,
    },
    notificationsHeader: {
        type: OptionType.COMPONENT,
        component: () => SectionSeparator("Notifications"),
    },
    showToasts: {
        type: OptionType.BOOLEAN,
        description: "Show toast notifications for all events.",
        default: true,
    },
});

const TOAST_COOLDOWN_MS = 3000;
const toastCooldowns = new Map<string, number>();

// Same key can't show again within the cooldown, so event bursts never spam the screen.
function toast(message: string, type: string, key: string = message) {
    if (!settings.store.showToasts) return;
    const now = Date.now();
    if (now - (toastCooldowns.get(key) ?? 0) < TOAST_COOLDOWN_MS) return;
    if (toastCooldowns.size > 50) toastCooldowns.clear();
    toastCooldowns.set(key, now);
    showToast({ text: message, variant: type } as any);
}

function cancelRejoin() {
    if (rejoinTimeout) { clearTimeout(rejoinTimeout); rejoinTimeout = null; }
    retryCount = 0;
    isRejoining = false;
}

function tryRejoin(channelId: string) {
    const max = settings.store.maxRetries;
    if (max > 0 && retryCount >= max) {
        toast(`AntiDisconnect: Gave up after ${max} attempt(s).`, "failure");
        cancelRejoin();
        return;
    }
    retryCount++;
    isRejoining = true;
    const label = max > 0 ? ` (attempt ${retryCount}/${max})` : "";
    toast(`AntiDisconnect: Rejoining...${label}`, "message", "rejoin");
    internalSelectVoiceChannel(channelId);
}

function scheduleRejoin(channelId: string) {
    const delay = settings.store.rejoinDelay;
    if (rejoinTimeout) clearTimeout(rejoinTimeout);
    if (delay <= 0) {
        if (!SelectedChannelStore.getVoiceChannelId()) tryRejoin(channelId);
        else cancelRejoin();
        return;
    }
    rejoinTimeout = setTimeout(() => {
        rejoinTimeout = null;
        if (!SelectedChannelStore.getVoiceChannelId()) tryRejoin(channelId);
        else cancelRejoin();
    }, delay);
}

// Uses the ORIGINAL patch so our own restore is never mistaken for a manual change.
// Remembers which endpoint works, so only the first call can ever need a fallback.
async function patchOwnNick(guildId: string, nick: string | null) {
    const rest = originalPatch ?? RestAPI.patch.bind(RestAPI);
    const viaProfile = () => rest({ url: `/users/@me/guilds/${guildId}/profile`, body: { nick } });
    const viaMember = () => rest({ url: `/guilds/${guildId}/members/@me`, body: { nick: nick ?? "" } });
    const [first, second] = preferProfileEndpoint ? [viaProfile, viaMember] : [viaMember, viaProfile];
    try {
        await first();
    } catch {
        await second();
        preferProfileEndpoint = !preferProfileEndpoint;
    }
}

function recheckNick(guildId: string) {
    if (!myUserId || !_nickChangerSubscribed) return;
    const current = GuildMemberStore.getMember(guildId, myUserId)?.nick || null;
    const saved = savedNicks.get(guildId);
    if (saved !== undefined && current !== saved) restoreNick(guildId, current ?? "");
}

async function restoreNick(guildId: string, forcedNick: string) {
    // Changed again while restoring: remember it and re-check as soon as the request ends
    if (resettingNickGuilds.has(guildId)) {
        pendingNickGuilds.add(guildId);
        return;
    }

    // Loop guard: never more than 8 restores per 10s per server
    const now = Date.now();
    const rec = restoreWindow.get(guildId);
    if (!rec || now - rec.start > 10000) {
        restoreWindow.set(guildId, { start: now, count: 1 });
    } else if (++rec.count > 8) {
        toast("AntiNickChanger: too many changes in a row, pausing for a moment.", "failure", "nick-loop");
        return;
    }

    resettingNickGuilds.add(guildId);
    const target = savedNicks.get(guildId) ?? null;

    try {
        await patchOwnNick(guildId, target);
        toast(
            target
                ? `AntiNickChanger: nickname restored to "${target}"`
                : "AntiNickChanger: nickname reset to default",
            "success",
            `nick-ok:${guildId}`
        );
    } catch {
        toast("AntiNickChanger: couldn't restore your nickname.", "failure", `nick-fail:${guildId}`);
    } finally {
        resettingNickGuilds.delete(guildId);
        if (pendingNickGuilds.delete(guildId)) recheckNick(guildId);
    }
}

async function patchMember(userId: string, guildId: string, body: object) {
    await RestAPI.patch({
        url: Constants.Endpoints.GUILD_MEMBER(guildId, userId),
        body,
    });
}

function toggleSetting(key: "antiDisconnect" | "antiMove" | "antiMuteServer" | "antiDeafenServer" | "antiNickChanger") {
    (settings.store[key] as boolean) = !settings.store[key];
    syncSettingsCache();
    if (key === "antiNickChanger") {
        if (_antiNickChangerEnabled) subscribeNickChanger();
        else unsubscribeNickChanger();
    }
    const labels: Record<typeof key, string> = {
        antiDisconnect: "AntiDisconnect",
        antiMove: "AntiMove",
        antiNickChanger: "AntiNickChanger",
        antiMuteServer: "AntiMuteServer (Perms)",
        antiDeafenServer: "AntiDeafenServer (Perms)",
    };
    const on = settings.store[key] as boolean;
    toast(`${labels[key]} ${on ? "- Enabled" : "- Disabled"}`, on ? "success" : "failure");
}

const RtcChannelContext: NavContextMenuPatchCallback = children => {
    children.push(
        <Menu.MenuGroup>
            <Menu.MenuCheckboxItem
                id="anti-disconnect-toggle"
                label="AntiDisconnect"
                checked={settings.store.antiDisconnect}
                action={() => toggleSetting("antiDisconnect")}
            />
            <Menu.MenuCheckboxItem
                id="anti-move-toggle"
                label="AntiMove"
                checked={settings.store.antiMove}
                action={() => toggleSetting("antiMove")}
            />
            <Menu.MenuCheckboxItem
                id="anti-nickname-toggle"
                label="AntiNickChanger"
                checked={settings.store.antiNickChanger}
                action={() => toggleSetting("antiNickChanger")}
            />
            <Menu.MenuCheckboxItem
                id="anti-mute-toggle"
                label="AntiMuteServer (Perms)"
                checked={settings.store.antiMuteServer}
                action={() => toggleSetting("antiMuteServer")}
            />
            <Menu.MenuCheckboxItem
                id="anti-deafen-toggle"
                label="AntiDeafenServer (Perms)"
                checked={settings.store.antiDeafenServer}
                action={() => toggleSetting("antiDeafenServer")}
            />
        </Menu.MenuGroup>
    );
};

function resetState() {
    cancelRejoin();
    manualDisconnect = false;
    ignoreMoveTo = null;
    lastUserSelectAt = 0;
    isRejoining = false;
    voiceFixInFlight = false;
    toastCooldowns.clear();
}

export default definePlugin({
    name: "Untouchable",
    description: "Keeps you in control of your voice presence and identity. Rejoins if disconnected, blocks moves, auto-unmutes/undeafens, and restores your nickname if someone else changes it.",
    authors: [{ name: "zfrancesck1", id: 456195985404592149n }],
    tags: ["Privacy", "Utility", "Fun", "Bypass", "Auto"],
    enabledByDefault: false,

    settings,

    contextMenus: { "rtc-channel": RtcChannelContext },

    flux: {
        CONNECTION_OPEN() {
            myUserId = UserStore.getCurrentUser()?.id ?? null;
            syncSettingsCache();
            if (_antiNickChangerEnabled) subscribeNickChanger();
            resetState();
        },

        VOICE_CHANNEL_SELECT({ channelId }: { channelId: string | null; }) {
            manualDisconnect = channelId === null;
        },

        VOICE_STATE_UPDATES({ voiceStates }: { voiceStates: VoiceState[]; }) {
            if (!myUserId) return;

            for (const state of voiceStates) {
                if (state.userId !== myUserId) continue;
                const { channelId, oldChannelId, guildId, mute, deaf } = state;

                const isMove = !!channelId && !!oldChannelId && channelId !== oldChannelId;
                const isJoin = !!channelId && !oldChannelId;
                const isLeave = !channelId && !!oldChannelId;

                if (isMove) {
                    const isOwnMoveBack = channelId === ignoreMoveTo;
                    const isManual = Date.now() - lastUserSelectAt < 3000;
                    if (isOwnMoveBack) ignoreMoveTo = null;

                    if (_antiMove && !isRejoining && !isOwnMoveBack && !isManual) {
                        toast("AntiMove: Moved back to your channel.", "message");
                        const target = oldChannelId!;
                        ignoreMoveTo = target;
                        Promise.resolve().then(() => internalSelectVoiceChannel(target));
                        continue;
                    }
                    if (isRejoining) isRejoining = false;
                    else retryCount = 0;
                    if (rejoinTimeout) { clearTimeout(rejoinTimeout); rejoinTimeout = null; }
                }

                if (isJoin) {
                    manualDisconnect = false;
                    if (isRejoining) isRejoining = false;
                    else retryCount = 0;
                    if (rejoinTimeout) { clearTimeout(rejoinTimeout); rejoinTimeout = null; }
                }

                if (isLeave) {
                    if (_ignoreManualDisconnect && manualDisconnect) {
                        manualDisconnect = false;
                        cancelRejoin();
                        continue;
                    }
                    manualDisconnect = false;
                    if (_antiDisconnect) scheduleRejoin(oldChannelId!);
                }

                if (!channelId || !guildId) continue;

                // `mute`/`deaf` = server-side state; selfMute/selfDeaf are independent (selfDeaf forces selfMute)
                const needsMuteCheck = _antiMuteServer && mute;
                const needsDeafenCheck = _antiDeafenServer && deaf;
                if (!needsMuteCheck && !needsDeafenCheck) continue;

                const channel = ChannelStore.getChannel(channelId);
                if (!channel) continue;

                const body: { mute?: boolean; deaf?: boolean; } = {};
                if (needsMuteCheck && PermissionStore.can(PermissionsBits.MUTE_MEMBERS, channel)) body.mute = false;
                if (needsDeafenCheck && PermissionStore.can(PermissionsBits.DEAFEN_MEMBERS, channel)) body.deaf = false;
                if (!("mute" in body) && !("deaf" in body)) continue;

                if (voiceFixInFlight) continue;
                voiceFixInFlight = true;

                const uid = myUserId;
                const hasMute = "mute" in body;
                const hasDeaf = "deaf" in body;
                const title = hasMute && hasDeaf ? "AntiMute & AntiDeafen" : hasMute ? "AntiMute" : "AntiDeafen";
                const okMsg = hasMute && hasDeaf ? "you're unmuted and undeafened" : hasMute ? "you've been unmuted" : "you've been undeafened";
                const failMsg = hasMute && hasDeaf ? "couldn't unmute and undeafen you" : hasMute ? "couldn't unmute you" : "couldn't undeafen you";
                setTimeout(() => {
                    patchMember(uid, guildId, body)
                        .then(() => toast(`${title}: ${okMsg}`, "success", "voice-fix"))
                        .catch(() => toast(`${title}: ${failMsg}, check your permissions`, "failure", "voice-fix-fail"))
                        .finally(() => { voiceFixInFlight = false; });
                }, 100);
            }
        },
    },

    start() {
        myUserId = UserStore.getCurrentUser()?.id ?? null;
        syncSettingsCache();
        if (_antiNickChangerEnabled) subscribeNickChanger();

        originalSelectVoiceChannel = ChannelActionsRaw.selectVoiceChannel.bind(ChannelActionsRaw);
        ChannelActionsRaw.selectVoiceChannel = patchedSelectVoiceChannel;

        originalPatch = RestAPI.patch.bind(RestAPI);
        RestAPI.patch = (...args: any[]) => {
            try {
                const options = args[0];
                const url = options?.url;
                if (typeof url === "string" && (NICK_ENDPOINT_RE1.test(url) || NICK_ENDPOINT_RE2.test(url))) {
                    const body = options.body;
                    if (body && typeof body === "object" && "nick" in body) {
                        const match = url.match(NICK_GUILD_RE);
                        if (match) {
                            selfChangingNicks.set(match[1], { nick: body.nick || null, until: Date.now() + 10000 });
                        }
                    }
                }
            } catch { }
            return (originalPatch as any)(...args);
        };
    },

    stop() {
        unsubscribeNickChanger();
        if (originalSelectVoiceChannel) {
            ChannelActionsRaw.selectVoiceChannel = originalSelectVoiceChannel;
            originalSelectVoiceChannel = null;
        }
        if (originalPatch) {
            RestAPI.patch = originalPatch;
            originalPatch = null;
        }
        resetState();
        resettingNickGuilds.clear();
        pendingNickGuilds.clear();
        selfChangingNicks.clear();
        restoreWindow.clear();
        savedNicks.clear();
        myUserId = null;
    },
});