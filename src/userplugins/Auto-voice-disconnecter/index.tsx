/*
 * Vencord, a Discord client mod - Fix Patches (by zFry)
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { NavContextMenuPatchCallback } from "@api/ContextMenu";
import { HeaderBarButton } from "@api/HeaderBar";
import { definePluginSettings } from "@api/Settings";
import definePlugin, { OptionType } from "@utils/types";
import type { User } from "@vencord/discord-types";
import { ChannelStore, Constants, Menu, PermissionsBits, PermissionStore, RestAPI, showToast, useEffect, UserStore, useState, VoiceStateStore } from "@webpack/common";
import type { SVGProps } from "react";

interface VoiceState {
    userId: string;
    channelId?: string;
    oldChannelId?: string;
}

const settings = definePluginSettings({
    disconnectUserId: {
        type: OptionType.STRING,
        description: "Target user ID to auto-disconnect",
        restartNeeded: false,
        hidden: true,
        default: "",
    },
    showToasts: {
        type: OptionType.BOOLEAN,
        description: "Show toast notifications",
        restartNeeded: false,
        default: true,
    },
});

let targetId = "";
let kickedChannelId: string | null = null;
const listeners = new Set<() => void>();

function toast(message: string, type: "success" | "failure") {
    if (settings.store.showToasts) showToast({ text: message, variant: type });
}

function useTargetId() {
    const [, tick] = useState(0);
    useEffect(() => {
        const fn = () => tick(n => n + 1);
        listeners.add(fn);
        return () => { listeners.delete(fn); };
    }, []);
    return targetId;
}

function setTarget(userId: string) {
    targetId = userId;
    kickedChannelId = null;
    settings.store.disconnectUserId = userId;
    listeners.forEach(fn => fn());
}

function DisconnectIcon({ className, width = 24, height = 24 }: SVGProps<SVGSVGElement>) {
    return (
        <svg className={className} width={width} height={height} viewBox="0 0 24 24" aria-hidden="true">
            <path fill="currentColor" d="M12 9c-1.6 0-3.15.25-4.6.72v3.1c0 .39-.23.74-.56.9-.98.49-1.87 1.12-2.66 1.85-.18.18-.43.28-.7.28-.28 0-.53-.11-.71-.29L.29 13.08a.956.956 0 0 1-.29-.7c0-.28.11-.53.29-.71C3.34 8.78 7.46 7 12 7s8.66 1.78 11.71 4.67c.18.18.29.43.29.71 0 .28-.11.53-.29.71l-2.48 2.48c-.18.18-.43.29-.71.29-.27 0-.52-.11-.7-.28a11.27 11.27 0 0 0-2.67-1.85.996.996 0 0 1-.56-.9v-3.1C15.15 9.25 13.6 9 12 9z" />
        </svg>
    );
}

function getName(userId: string) {
    return UserStore.getUser(userId)?.username ?? userId;
}

async function disconnectMember(guildId: string, userId: string, channelId: string) {
    kickedChannelId = channelId;
    try {
        await RestAPI.patch({
            url: Constants.Endpoints.GUILD_MEMBER(guildId, userId),
            body: { channel_id: null }
        });
        toast(`${getName(userId)} disconnected from voice`, "success");
    } catch {
        kickedChannelId = null;
        toast(`Failed to disconnect ${getName(userId)}`, "failure");
    }
}

const UserContext: NavContextMenuPatchCallback = (children, { user }: { user: User; }) => {
    if (!user || user.id === UserStore.getCurrentUser().id) return;
    const isActive = targetId === user.id;

    children.splice(-1, 0, (
        <Menu.MenuGroup key="disconnect-user-group">
            <Menu.MenuCheckboxItem
                id="disconnect-user"
                label="Auto-Disconnect User"
                checked={isActive}
                action={() => setTarget(isActive ? "" : user.id)}
            />
        </Menu.MenuGroup>
    ));
};

function DisconnectHeaderButton() {
    const id = useTargetId();
    if (!id) return null;

    return (
        <HeaderBarButton
            icon={DisconnectIcon}
            tooltip={`Auto-Disconnect: ${getName(id)} (click to stop)`}
            onClick={() => setTarget("")}
        />
    );
}

export default definePlugin({
    name: "DisconnectUser",
    description: "Adds a context menu entry to auto-disconnect a user when they join voice",
    authors: [{ id: 1242811215110082584n, name: "Jeasus" }, { name: "emirvaki", id: 1357545010848989247n }, { name: "zfrancesck1", id: 456195985404592149n }],
    tags: ["Voice", "Utility"],
    enabledByDefault: false,
    settings,

    headerBarButton: {
        icon: DisconnectIcon,
        render: DisconnectHeaderButton,
        priority: 6,
    },

    contextMenus: {
        "user-context": UserContext
    },

    start() {
        targetId = settings.store.disconnectUserId;
        kickedChannelId = null;
        listeners.forEach(fn => fn());
    },

    stop() {
        targetId = "";
        kickedChannelId = null;
        listeners.forEach(fn => fn());
    },

    flux: {
        VOICE_STATE_UPDATES({ voiceStates }: { voiceStates: VoiceState[]; }) {
            if (!targetId) return;

            for (const { userId, channelId, oldChannelId } of voiceStates) {
                if (userId !== targetId) continue;

                if (!channelId) {
                    kickedChannelId = null;
                    continue;
                }

                if (channelId === oldChannelId || channelId === kickedChannelId) continue;
                if (VoiceStateStore.getVoiceStateForUser(userId)?.channelId !== channelId) continue;

                const channel = ChannelStore.getChannel(channelId);
                const guildId = channel?.guild_id;
                if (!guildId) continue;

                if (!PermissionStore.can(PermissionsBits.MOVE_MEMBERS, channel)) {
                    kickedChannelId = channelId;
                    toast("Missing MOVE_MEMBERS permission to disconnect user", "failure");
                    continue;
                }

                disconnectMember(guildId, userId, channelId);
            }
        },
    },
});