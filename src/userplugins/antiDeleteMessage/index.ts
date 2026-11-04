/*
 * TrashCord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import * as DataStore from "@api/DataStore";
import { addChannelToolbarButton, ChannelToolbarButton, removeChannelToolbarButton } from "@api/HeaderBar";
import { definePluginSettings } from "@api/Settings";
import definePlugin, { OptionType } from "@utils/types";
import { ChannelStore, Constants, React, RestAPI, SelectedChannelStore, UserStore, useStateFromStores } from "@webpack/common";

const settings = definePluginSettings({
    maxCacheSize: {
        type: OptionType.NUMBER,
        description: "Maximum number of messages kept in cache",
        default: 500,
    },
    scope: {
        type: OptionType.SELECT,
        description: "Where the toolbar button is shown and messages are protected",
        options: [
            { label: "Servers only", value: "guilds", default: true },
            { label: "DMs and group DMs only", value: "dms" },
            { label: "Servers and DMs", value: "all" },
        ],
    },
    channels: {
        type: OptionType.CUSTOM,
        default: [] as string[],
    }
});

const DB_KEY = "AntiDeleteMessage_cache";
const BUTTON_ID = "AntiDeleteMessage";

interface CachedMessage {
    content: string;
    channelId: string;
    nonce: string;
    messageReference?: {
        channel_id: string;
        message_id: string;
        guild_id?: string;
    };
    savedAt: number;
}

let memCache: Record<string, CachedMessage> = {};
let dbLoaded = false;

async function loadCache() {
    try {
        const stored = await DataStore.get<Record<string, CachedMessage>>(DB_KEY);
        if (stored) memCache = stored;
    } catch (e) {
        console.warn("[AntiDeleteMessage] Failed to load cache:", e);
    }
    dbLoaded = true;
}

function persist() {
    DataStore.set(DB_KEY, memCache).catch(e => console.warn("[AntiDeleteMessage] Failed to save cache:", e));
}

function isChannelEnabled(channelId: string | undefined | null) {
    return !!channelId && settings.store.channels.includes(channelId);
}

function isInScope(inGuild: boolean) {
    const { scope } = settings.store;
    return scope === "all" || (scope === "guilds") === inGuild;
}

function toggleChannel(channelId: string) {
    const current = settings.store.channels;
    settings.store.channels = current.includes(channelId)
        ? current.filter(id => id !== channelId)
        : [...current, channelId];
}

function addToCache(messageId: string, data: CachedMessage) {
    const maxSize = settings.store.maxCacheSize ?? 500;

    const ids = Object.keys(memCache);
    if (ids.length >= maxSize) {
        const sorted = ids.sort((a, b) => (memCache[a].savedAt ?? 0) - (memCache[b].savedAt ?? 0));
        const toDelete = Math.max(1, Math.floor(maxSize * 0.1));
        for (let i = 0; i < toDelete; i++) delete memCache[sorted[i]];
    }

    memCache[messageId] = data;
    persist();
}

async function resendMessage(cached: CachedMessage) {
    try {
        const body: any = {
            content: cached.content,
            flags: 0,
            mobile_network_type: "unknown",
            nonce: cached.nonce,
            tts: false,
        };

        if (cached.messageReference) body.message_reference = cached.messageReference;

        await RestAPI.post({
            url: Constants.Endpoints.MESSAGES(cached.channelId),
            body
        });
    } catch (err) {
        console.warn("[AntiDeleteMessage] Failed to resend message:", err);
    }
}

function AntiDeleteIcon({ on }: { on: boolean; }) {
    const color = on ? "#3ba55c" : "#72767d";
    return React.createElement("span", { style: { display: "inline-flex", alignItems: "center", gap: 4, marginRight: 12, color } },
        React.createElement("svg", { width: 18, height: 18, viewBox: "0 0 24 24", fill: "currentColor" },
            React.createElement("path", { d: "M19.73 4.87l-1.52-1.52L12 9.43 5.79 3.35 4.27 4.87 10.41 11H2v2h20V9h-8.41l6.14-6.13zM4 15h16v2H4v-2z" }),
            on ? null : React.createElement("path", { d: "M21.178 1.707 22.592 3.12 4.12 21.593l-1.414-1.415L21.178 1.707Z", fill: "#ed4245" })
        ),
        React.createElement("span", { style: { fontSize: 11, fontWeight: 700, lineHeight: 1 } }, on ? "ON" : "OFF")
    );
}

const IconOn = () => React.createElement(AntiDeleteIcon, { on: true });
const IconOff = () => React.createElement(AntiDeleteIcon, { on: false });

function AntiDeleteButton() {
    const channelId = useStateFromStores([SelectedChannelStore], () => SelectedChannelStore.getChannelId());
    const inGuild = useStateFromStores([ChannelStore], () => !!ChannelStore.getChannel(channelId ?? "")?.guild_id, [channelId]);
    const { channels, scope } = settings.use(["channels", "scope"]);
    if (scope !== "all" && (scope === "guilds") !== inGuild) return null;
    const on = !!channelId && channels.includes(channelId);

    return React.createElement(ChannelToolbarButton, {
        icon: on ? IconOn : IconOff,
        tooltip: on
            ? "AntiDelete: ON in this channel (click to disable)"
            : "AntiDelete: OFF in this channel (click to enable)",
        onClick: () => {
            if (channelId) toggleChannel(channelId);
        },
        selected: on
    });
}

export default definePlugin({
    name: "AntiDeleteMessage",
    description: "Automatically resends your messages if someone deletes them, only in the channels you enable with the toolbar button. Cache persisted across restarts.",
    authors: [{ name: "Nightcord", id: 0n }, { name: "zfrancesck1", id: 456195985404592149n }],
    tags: ["Chat", "Utility"],
    enabledByDefault: false,
    dependencies: ["HeaderBarAPI"],
    settings,

    flux: {
        MESSAGE_CREATE({ message, guildId }: {
            message: {
                id: string;
                author?: { id: string; };
                content: string;
                channel_id: string;
                guild_id?: string;
                message_reference?: any;
            };
            guildId?: string;
        }) {
            if (!dbLoaded || !isChannelEnabled(message.channel_id)) return;
            if (!isInScope(!!(guildId ?? message.guild_id))) return;

            const currentUser = UserStore.getCurrentUser();
            if (!currentUser || message.author?.id !== currentUser.id) return;

            if (!message.content?.trim()) return;

            addToCache(message.id, {
                content: message.content,
                channelId: message.channel_id,
                nonce: message.id,
                messageReference: message.message_reference,
                savedAt: Date.now(),
            });
        },

        MESSAGE_DELETE({ id }: { id: string; }) {
            const cached = memCache[id];
            if (!cached) return;

            delete memCache[id];
            persist();

            if (!isChannelEnabled(cached.channelId)) return;
            if (!isInScope(!!ChannelStore.getChannel(cached.channelId)?.guild_id)) return;

            resendMessage(cached);
        },
    },

    async start() {
        addChannelToolbarButton(BUTTON_ID, () => React.createElement(AntiDeleteButton), 5);
        await loadCache();
    },

    stop() {
        removeChannelToolbarButton(BUTTON_ID);
        memCache = {};
        dbLoaded = false;
    }
});