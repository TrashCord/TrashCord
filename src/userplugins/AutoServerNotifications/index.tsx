/*
 * TrashCord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import {
    findGroupChildrenByChildId,
    NavContextMenuPatchCallback,
} from "@api/ContextMenu";
import { definePluginSettings } from "@api/Settings";
import { CogWheel } from "@components/Icons";
import { sleep } from "@utils/misc";
import definePlugin, { OptionType } from "@utils/types";
import { Button, Forms, GuildStore, Menu, RestAPI, showToast, UserStore, useEffect, useState } from "@webpack/common";

type MessageNotifications = 0 | 1 | 2;

const knownGuilds = new Set<string>();
const recent = new Map<string, number>();
let startupDone = false;
let startupTimer: ReturnType<typeof setTimeout> | undefined;

let isRunning = false;
const runningListeners = new Set<(v: boolean) => void>();

function setRunning(v: boolean) {
    isRunning = v;
    runningListeners.forEach(fn => fn(v));
}

function useIsRunning() {
    const [val, setVal] = useState(isRunning);
    useEffect(() => {
        runningListeners.add(setVal);
        return () => void runningListeners.delete(setVal);
    }, []);
    return val;
}

const settings = definePluginSettings({
    applyToNew: {
        type: OptionType.BOOLEAN,
        description: "Auto-apply settings when joining a new server",
        default: true,
    },
    muteServer: {
        type: OptionType.BOOLEAN,
        description: "Mute server (indefinitely)",
        default: true,
    },
    messageNotifications: {
        type: OptionType.SELECT,
        description: "Message notification level",
        options: [
            { label: "All messages", value: 0 },
            { label: "Only @mentions", value: 1, default: true },
            { label: "Nothing", value: 2 },
            { label: "Server default", value: 3 },
        ],
    },
    suppressEveryone: {
        type: OptionType.BOOLEAN,
        description: "Suppress @everyone and @here",
        default: true,
    },
    suppressRoles: {
        type: OptionType.BOOLEAN,
        description: "Suppress all role @mentions",
        default: true,
    },
    suppressHighlights: {
        type: OptionType.BOOLEAN,
        description: "Suppress highlights",
        default: true,
    },
    muteScheduledEvents: {
        type: OptionType.BOOLEAN,
        description: "Mute new events",
        default: true,
    },
    mobilePush: {
        type: OptionType.BOOLEAN,
        description: "Mobile push notifications",
        default: false,
    },
    showAllChannels: {
        type: OptionType.BOOLEAN,
        description: "Show all channels (opt-in)",
        default: true,
    },
});

function buildGuildFields(): Record<string, unknown> {
    const s = settings.store;
    const fields: Record<string, unknown> = {
        suppress_everyone: s.suppressEveryone,
        suppress_roles: s.suppressRoles,
        notify_highlights: s.suppressHighlights ? 1 : 0,
        mute_scheduled_events: s.muteScheduledEvents,
        mobile_push: s.mobilePush,
        muted: s.muteServer,
        mute_config: s.muteServer ? { selected_time_window: -1, end_time: null } : null,
    };
    if (s.showAllChannels) fields.flags = 0;
    if (s.messageNotifications !== 3) {
        fields.message_notifications = s.messageNotifications as MessageNotifications;
    }
    return fields;
}

async function patchGuildsSettings(guildsPayload: Record<string, unknown>): Promise<void> {
    await RestAPI.patch({
        url: "/users/@me/guilds/settings",
        body: { guilds: guildsPayload }
    });
}

async function applyToGuild(guildId: string): Promise<void> {
    if (!guildId || guildId === "@me" || guildId === "null") return;
    await patchGuildsSettings({ [guildId]: buildGuildFields() });
}

async function autoApply(guildId: string, notify = false): Promise<void> {
    if (!settings.store.applyToNew) return;
    const last = recent.get(guildId);
    if (last !== undefined && Date.now() - last < 15000) return;
    recent.set(guildId, Date.now());
    try {
        await applyToGuild(guildId);
        if (notify) showToast({ text: "AutoServerNotifications Settings applied to New Server.", variant: "success" });
    } catch {
        recent.delete(guildId);
    }
}

async function applyToAll(): Promise<void> {
    if (isRunning) return;
    setRunning(true);

    const ids = Object.keys(GuildStore.getGuilds());
    const fields = buildGuildFields();
    const CHUNK = 100;
    let ok = 0, fail = 0;

    for (let i = 0; i < ids.length; i += CHUNK) {
        const chunk = ids.slice(i, i + CHUNK);
        const payload: Record<string, unknown> = {};
        for (const id of chunk) payload[id] = fields;

        try {
            await patchGuildsSettings(payload);
            ok += chunk.length;
        } catch {
            fail += chunk.length;
        }

        if (i + CHUNK < ids.length) await sleep(500);
    }

    setRunning(false);
    showToast({
        text: fail === 0
            ? `Applied to ${ok} servers.`
            : `Applied to ${ok} servers, ${fail} failed.`,
        variant: fail === 0 ? "success" : "critical"
    });
}

const contextMenuPatch: NavContextMenuPatchCallback = (children, { guild }: any) => {
    if (!guild) return;

    const menuItem = (
        <Menu.MenuItem
            id="asn-apply"
            label="Apply AutoNotification Settings"
            icon={CogWheel}
            leadingAccessory={{ type: "icon", icon: CogWheel }}
            action={() => {
                applyToGuild(guild.id)
                    .then(() => showToast({ text: "AutoServerNotifications Settings applied.", variant: "success" }))
                    .catch(() => showToast({ text: "AutoServerNotifications: Failed to apply Settings.", variant: "critical" }));
            }}
        />
    );

    const group = findGroupChildrenByChildId("privacy", children);
    if (group) {
        group.push(menuItem);
    } else {
        children.push(menuItem);
    }
};

export default definePlugin({
    name: "AutoServerNotifications",
    description: "Apply custom notification Settings to all Servers, with auto-apply on join and a right-click context menu.",
    authors: [{ name: "zfrancesck1", id: 456195985404592149n }],
    tags: ["Servers", "Notifications", "Mute", "Server", "Auto"],
    enabledByDefault: false,
    settings,

    patches: [
        {
            find: ",acceptInvite(",
            replacement: {
                match: /INVITE_ACCEPT_SUCCESS.+?,(\i)=\i\?\.guild_id.+?;/,
                replace: (m: string, guildId: string) => `${m}$self.autoApply(${guildId});`,
            },
        },
        {
            find: "{joinGuild:",
            replacement: {
                match: /guildId:(\i),lurker:(\i).{0,20}}\);/,
                replace: (m: string, guildId: string, lurker: string) =>
                    `${m}if(!${lurker})$self.autoApply(${guildId});`,
            },
        },
    ],

    contextMenus: {
        "guild-context": contextMenuPatch,
        "guild-header-popout": contextMenuPatch,
    },

    autoApply,

    start() {
        for (const id of Object.keys(GuildStore.getGuilds())) knownGuilds.add(id);
        startupTimer = setTimeout(() => { startupDone = true; }, 5000);
    },

    stop() {
        clearTimeout(startupTimer);
        knownGuilds.clear();
        recent.clear();
        startupDone = false;
    },

    flux: {
        GUILD_CREATE({ guild }: { guild: { id: string; }; }) {
            const id = guild.id;
            if (!startupDone || knownGuilds.has(id)) {
                knownGuilds.add(id);
                return;
            }
            knownGuilds.add(id);
            sleep(3000).then(() => autoApply(id, true));
        },

        GUILD_JOIN_REQUEST_UPDATE({ guildId, request, status }: any) {
            if (status === "APPROVED" && request.user_id === UserStore.getCurrentUser().id) {
                sleep(3000).then(() => autoApply(guildId));
            }
        },
    },

    settingsAboutComponent() {
        const running = useIsRunning();
        return (
            <Forms.FormSection>
                <Forms.FormText style={{ marginBottom: 8 }}>
                    {running
                        ? "Applying Settings to all Servers, please wait…"
                        : "Apply the Settings above to all your current Servers at once."
                    }
                </Forms.FormText>
                <Button
                    color={Button.Colors.BRAND}
                    size={Button.Sizes.SMALL}
                    disabled={running}
                    onClick={applyToAll}
                >
                    {running ? "Applying…" : "Apply to all Servers"}
                </Button>
            </Forms.FormSection>
        );
    },
});