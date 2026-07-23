/*
 * Vencord, a Discord client mod
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
    Toasts,
    UserStore,
} from "@webpack/common";

const ChannelActionsRaw: { selectVoiceChannel: (channelId: string) => void } =
    findByPropsLazy("selectVoiceChannel", "disconnect");

const VoiceActions = findByPropsLazy("toggleSelfMute");

let originalSelectVoiceChannel: ((channelId: string) => void) | null = null;
let originalPatch: ((options: any) => Promise<any>) | null = null;
let calledByPlugin = false;

const NICK_ENDPOINT_RE1 = /^\/users\/@me\/guilds\/\w+\/profile$/;
const NICK_ENDPOINT_RE2 = /^\/guilds\/\w+\/members\/@me$/;
const NICK_GUILD_RE = /\/guilds\/(\w+)/;

function patchedSelectVoiceChannel(channelId: string) {
    calledByPlugin = false;
    originalSelectVoiceChannel!(channelId);
}

function internalSelectVoiceChannel(channelId: string) {
    calledByPlugin = true;
    ChannelActionsRaw.selectVoiceChannel(channelId);
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

let _antiNickChangerEnabled  = false;
let _antiMove                = false;
let _antiDisconnect          = false;
let _antiMuteServer          = false;
let _antiDeafenServer        = false;
let _ignoreManualDisconnect  = true;

function syncSettingsCache() {
    const s = settings.store;
    _antiNickChangerEnabled = s.antiNickChanger;
    _antiMove               = s.antiMove;
    _antiDisconnect         = s.antiDisconnect;
    _antiMuteServer         = s.antiMuteServer;
    _antiDeafenServer       = s.antiDeafenServer;
    _ignoreManualDisconnect = s.ignoreManualDisconnect;
}

const savedNicks = new Map<string, string | null>();
const selfChangingNickGuilds = new Set<string>();
const resettingNickGuilds = new Set<string>();
const nickDebounceTimers = new Map<string, ReturnType<typeof setTimeout>>();

let _nickChangerSubscribed = false;

function onGuildMemberUpdate({ guildId, user, nick }: {
    guildId: string;
    user: { id: string; };
    nick: string | null;
}) {
    if (!myUserId || user.id !== myUserId) return;

    if (selfChangingNickGuilds.has(guildId)) {
        savedNicks.set(guildId, nick);
        selfChangingNickGuilds.delete(guildId);
        return;
    }

    if (!savedNicks.has(guildId)) {
        savedNicks.set(guildId, nick);
        return;
    }

    const savedNick = savedNicks.get(guildId) ?? null;
    if (nick === savedNick) return;

    const existingTimer = nickDebounceTimers.get(guildId);
    if (existingTimer !== undefined) clearTimeout(existingTimer);

    const timer = setTimeout(() => {
        nickDebounceTimers.delete(guildId);
        if (!resettingNickGuilds.has(guildId))
            restoreNick(guildId, nick ?? "");
    }, 2000);

    nickDebounceTimers.set(guildId, timer);
}

function populateSavedNicks() {
    if (!myUserId) return;
    savedNicks.clear();
    const uid = myUserId;
    for (const guildId of Object.keys(GuildStore.getGuilds())) {
        const member = GuildMemberStore.getMember(guildId, uid);
        if (member != null) savedNicks.set(guildId, member.nick ?? null);
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
    nickDebounceTimers.forEach(t => clearTimeout(t));
    nickDebounceTimers.clear();
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
        description: "Prevent others from moving you to a different voice channel.",
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

function toast(message: string, type: number) {
    if (settings.store.showToasts)
        Toasts.show({ message, id: Toasts.genId(), type });
}

function cancelRejoin() {
    if (rejoinTimeout) { clearTimeout(rejoinTimeout); rejoinTimeout = null; }
    retryCount = 0;
    isRejoining = false;
}

function tryRejoin(channelId: string) {
    const max = settings.store.maxRetries;
    if (max > 0 && retryCount >= max) {
        toast(`AntiDisconnect: Gave up after ${max} attempt(s).`, Toasts.Type.FAILURE);
        cancelRejoin();
        return;
    }
    retryCount++;
    isRejoining = true;
    const label = max > 0 ? ` (attempt ${retryCount}/${max})` : "";
    toast(`AntiDisconnect: Rejoining...${label}`, Toasts.Type.MESSAGE);
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

async function restoreNick(guildId: string, forcedNick: string) {
    if (resettingNickGuilds.has(guildId)) return;
    resettingNickGuilds.add(guildId);

    const target = savedNicks.get(guildId) ?? null;

    try {
        try {
            await RestAPI.patch({
                url: `/users/@me/guilds/${guildId}/profile`,
                body: { nick: target },
            });
            toast(`AntiNickChanger: "${forcedNick}" → "${target ?? ""}" restored.`, Toasts.Type.SUCCESS);
            return;
        } catch {}

        await RestAPI.patch({
            url: `/guilds/${guildId}/members/@me`,
            body: { nick: target ?? "" },
        });
        toast(`AntiNickChanger: "${forcedNick}" → "${target ?? ""}" restored.`, Toasts.Type.SUCCESS);
    } catch {
    } finally {
        setTimeout(() => resettingNickGuilds.delete(guildId), 5000);
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
        antiDisconnect:   "AntiDisconnect",
        antiMove:         "AntiMove",
        antiNickChanger:  "AntiNickChanger",
        antiMuteServer:   "AntiMuteServer (Perms)",
        antiDeafenServer: "AntiDeafenServer (Perms)",
    };
    const on = settings.store[key] as boolean;
    toast(`${labels[key]} ${on ? "- Enabled" : "- Disabled"}`, on ? Toasts.Type.SUCCESS : Toasts.Type.FAILURE);
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
    calledByPlugin = false;
    isRejoining = false;
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

        VOICE_CHANNEL_SELECT({ channelId }: { channelId: string | null }) {
            manualDisconnect = channelId === null;
        },

        VOICE_STATE_UPDATES({ voiceStates }: { voiceStates: VoiceState[] }) {
            if (!myUserId) return;

            for (const state of voiceStates) {
                if (state.userId !== myUserId) continue;
                const { channelId, oldChannelId, guildId, mute, selfMute, deaf, selfDeaf } = state;

                const isMove  = !!channelId && !!oldChannelId && channelId !== oldChannelId;
                const isJoin  = !!channelId && !oldChannelId;
                const isLeave = !channelId  && !!oldChannelId;

                if (isMove) {
                    if (_antiMove && !isRejoining) {
                        toast("AntiMove: Moved back to your channel.", Toasts.Type.MESSAGE);
                        const target = oldChannelId!;
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

                const needsMuteCheck   = _antiMuteServer   && mute  && !selfMute;
                const needsDeafenCheck = _antiDeafenServer && deaf  && !selfDeaf;
                if (!needsMuteCheck && !needsDeafenCheck) continue;

                const channel = ChannelStore.getChannel(channelId);
                if (!channel) continue;

                if (needsMuteCheck && PermissionStore.can(PermissionsBits.MUTE_MEMBERS, channel)) {
                    const uid = myUserId;
                    setTimeout(() => {
                        patchMember(uid, guildId, { mute: false })
                            .then(() => toast("AntiMute: Server mute removed.", Toasts.Type.SUCCESS))
                            .catch(() => { try { VoiceActions.toggleSelfMute(); } catch {} });
                    }, 100);
                }

                if (needsDeafenCheck && PermissionStore.can(PermissionsBits.DEAFEN_MEMBERS, channel)) {
                    const uid = myUserId;
                    setTimeout(() => {
                        patchMember(uid, guildId, { deaf: false })
                            .then(() => toast("AntiDeafen: Server deafen removed.", Toasts.Type.SUCCESS))
                            .catch(() => { try { VoiceActions.toggleSelfDeaf(); } catch {} });
                    }, 100);
                }
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
        RestAPI.patch = (options: any) => {
            const body = options?.body;
            if (body != null && "nick" in body) {
                const url: string = options.url ?? "";
                if (NICK_ENDPOINT_RE1.test(url) || NICK_ENDPOINT_RE2.test(url)) {
                    const match = url.match(NICK_GUILD_RE);
                    if (match) {
                        const guildId = match[1];
                        selfChangingNickGuilds.add(guildId);
                        savedNicks.set(guildId, body.nick ?? null);
                        setTimeout(() => selfChangingNickGuilds.delete(guildId), 3000);
                    }
                }
            }
            return originalPatch!(options);
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
        selfChangingNickGuilds.clear();
        savedNicks.clear();
        myUserId = null;
    },
});