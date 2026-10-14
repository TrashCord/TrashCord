/*
 * Nightcord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { NavContextMenuPatchCallback } from "@api/ContextMenu";
import { HeaderBarButton } from "@api/HeaderBar";
import { definePluginSettings } from "@api/Settings";
import { openPluginModal } from "@components/settings/tabs/plugins/PluginModal";
import definePlugin, { OptionType } from "@utils/types";
import {
    Button, ChannelStore, Menu, PermissionsBits, PermissionStore,
    RestAPI, showToast, useEffect, UserStore, useState, VoiceStateStore,
} from "@webpack/common";
import type { SVGProps } from "react";

interface VoiceState {
    userId: string;
    channelId?: string;
    oldChannelId?: string;
}

interface Target {
    id: string;
    guild_id: string;
}

const settings = definePluginSettings({
    targetUserIds: {
        type: OptionType.STRING,
        description: "Followed user IDs (managed automatically)",
        restartNeeded: false,
        hidden: true,
        default: "[]",
    },
    showToasts: {
        type: OptionType.BOOLEAN,
        description: "Show toast notifications",
        restartNeeded: false,
        default: true,
    },
});

const MAX_ACTIVE = 5;
const THROTTLE_MS = 3000;

const followed = new Set<string>();
const listeners = new Set<() => void>();
const desired = new Map<string, Target>();
const queue = new Set<string>();
const lastToast = new Map<string, number>();
let followedList: string[] = [];
let active = 0;

function emit() {
    followedList = [...followed];
    listeners.forEach(fn => fn());
}

function commit() {
    emit();
    settings.store.targetUserIds = JSON.stringify(followedList);
}

function load() {
    followed.clear();
    try {
        const parsed = JSON.parse(settings.store.targetUserIds);
        if (Array.isArray(parsed)) for (const id of parsed) if (typeof id === "string") followed.add(id);
    } catch { }
    emit();
}

function useFollowedIds() {
    const [, tick] = useState(0);
    useEffect(() => {
        const fn = () => tick(n => n + 1);
        listeners.add(fn);
        return () => { listeners.delete(fn); };
    }, []);
    return followedList;
}

function toast(message: string, type: "success" | "failure" | "message") {
    if (settings.store.showToasts) showToast(message, type);
}

function throttledToast(message: string, type: "success" | "failure" | "message") {
    const now = Date.now();
    if (now - (lastToast.get(message) ?? 0) < THROTTLE_MS) return;
    lastToast.set(message, now);
    toast(message, type);
}

function denyToast() {
    throttledToast("FollowMe: no permission to move members", "failure");
}

function FollowIcon({ className, width = 24, height = 24 }: SVGProps<SVGSVGElement>) {
    return (
        <svg className={className} width={width} height={height} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="9" cy="7" r="4" />
            <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
            <path d="M16 11h6M19 8l3 3-3 3" />
        </svg>
    );
}

function StopFollowIcon({ className, width = 24, height = 24 }: SVGProps<SVGSVGElement>) {
    return (
        <svg className={className} width={width} height={height} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="9" cy="7" r="4" />
            <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
            <path d="M17 8l5 5M22 8l-5 5" />
        </svg>
    );
}

function getName(userId: string) {
    return UserStore.getUser(userId)?.username ?? userId;
}

function guildOf(channelId: string) {
    return ChannelStore.getChannel(channelId)?.guild_id;
}

function drain() {
    while (active < MAX_ACTIVE && queue.size) {
        const userId = queue.values().next().value as string;
        queue.delete(userId);

        const target = desired.get(userId);
        if (!target || !followed.has(userId)) {
            desired.delete(userId);
            continue;
        }

        active++;

        let request: Promise<unknown>;
        try {
            request = RestAPI.patch({
                url: `/guilds/${target.guild_id}/members/${userId}`,
                body: { channel_id: target.id },
            });
        } catch (e) {
            request = Promise.reject(e);
        }

        request
            .catch((e: any) => {
                if (e?.status === 403) denyToast();
                else throttledToast(`FollowMe: move failed (${e?.status ?? "error"})`, "failure");
            })
            .finally(() => {
                if (desired.get(userId) === target) desired.delete(userId);
                active--;
                drain();
            });
    }
}

function send(userId: string, channel: Target) {
    desired.set(userId, channel);
    queue.add(userId);
    drain();
}

function pull(userId: string, toChannelId: string, currentChannelId?: string) {
    if (!currentChannelId || currentChannelId === toChannelId) return;

    const channel = ChannelStore.getChannel(toChannelId);
    if (!channel?.guild_id || guildOf(currentChannelId) !== channel.guild_id) return;
    if (!PermissionStore.can(PermissionsBits.MOVE_MEMBERS, channel)) {
        denyToast();
        return;
    }

    send(userId, channel);
}

function pullAll(toChannelId: string) {
    const channel = ChannelStore.getChannel(toChannelId);
    if (!channel?.guild_id) return;

    let canMove: boolean | undefined;

    for (const id of followed) {
        const current = VoiceStateStore.getVoiceStateForUser(id)?.channelId;
        if (!current || current === toChannelId || guildOf(current) !== channel.guild_id) continue;

        canMove ??= PermissionStore.can(PermissionsBits.MOVE_MEMBERS, channel);
        if (!canMove) {
            denyToast();
            return;
        }

        send(id, channel);
    }
}

function followUser(userId: string) {
    if (followed.has(userId)) return;
    followed.add(userId);
    commit();

    const myId = UserStore.getCurrentUser()?.id;
    const myChannelId = myId ? VoiceStateStore.getVoiceStateForUser(myId)?.channelId : undefined;
    if (myChannelId) pull(userId, myChannelId, VoiceStateStore.getVoiceStateForUser(userId)?.channelId);

    toast(`FollowMe: user added [${getName(userId)}]`, "success");
}

function unfollowUser(userId: string) {
    if (!followed.delete(userId)) return;
    desired.delete(userId);
    queue.delete(userId);
    commit();
    toast(`FollowMe: user removed [${getName(userId)}]`, "message");
}

function unfollowAll() {
    const n = followed.size;
    if (!n) return;
    followed.clear();
    desired.clear();
    queue.clear();
    commit();
    toast(`FollowMe: ${n} user${n === 1 ? "" : "s"} cleared`, "failure");
}

function TrackedUsersList() {
    const ids = useFollowedIds();

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            <span style={{ color: "var(--text-brand)", fontWeight: 700, fontSize: "13px", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                Followed Users {ids.length > 0 ? `(${ids.length})` : ""}
            </span>
            {ids.length === 0
                ? <span style={{ color: "var(--text-muted)", fontSize: "13px" }}>No users followed. Right-click a user to add them.</span>
                : (
                    <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                        <div style={{ display: "flex", flexDirection: "column", gap: "4px", maxHeight: "220px", overflowY: "auto", paddingRight: "4px" }}>
                            {ids.map(id => (
                                <div key={id} style={{
                                    display: "flex", alignItems: "center", justifyContent: "space-between",
                                    background: "var(--background-tertiary)", borderRadius: "6px", padding: "6px 10px",
                                    border: "1px solid var(--background-modifier-accent)", flexShrink: 0,
                                }}>
                                    <div style={{ display: "flex", flexDirection: "column" }}>
                                        <span style={{ color: "var(--text-link)", fontSize: "14px", fontWeight: 700 }}>
                                            {UserStore.getUser(id)?.username ?? "Unknown User"}
                                        </span>
                                        <span style={{ color: "var(--text-muted)", fontSize: "11px" }}>{id}</span>
                                    </div>
                                    <Button size={Button.Sizes.SMALL} color={Button.Colors.RED} onClick={() => unfollowUser(id)}>Remove</Button>
                                </div>
                            ))}
                        </div>
                        <Button style={{ marginTop: "4px" }} size={Button.Sizes.SMALL} color={Button.Colors.RED} onClick={unfollowAll}>Clear All</Button>
                    </div>
                )}
        </div>
    );
}

const UserContextMenuPatch: NavContextMenuPatchCallback = (children, props) => {
    const userId: string | undefined = props?.user?.id;
    if (!userId || userId === UserStore.getCurrentUser()?.id) return;

    const isFollowed = followed.has(userId);
    const icon = isFollowed ? StopFollowIcon : FollowIcon;

    children.splice(-1, 0, (
        <Menu.MenuGroup key="follow-me-group">
            <Menu.MenuItem
                id="follow-me-ctx"
                label={isFollowed ? "Stop Follow Me" : "Follow Me"}
                icon={icon}
                leadingAccessory={{ type: "icon", icon }}
                action={() => isFollowed ? unfollowUser(userId) : followUser(userId)}
            />
        </Menu.MenuGroup>
    ));
};

function FollowMeHeaderButton() {
    const ids = useFollowedIds();
    if (!ids.length) return null;

    const shown = ids.slice(0, 3).map(getName).join(", ");
    const extra = ids.length > 3 ? ` +${ids.length - 3}` : "";

    return (
        <HeaderBarButton
            icon={StopFollowIcon}
            tooltip={`FollowMe: ${shown}${extra} (click to stop all)`}
            onClick={unfollowAll}
        />
    );
}

export default definePlugin({
    name: "FollowMe",
    description: "Forces one or more users to follow you in voice channels (if you have permissions). Right-click a user -> Follow Me.",
    authors: [{ name: "Nightcord", id: 0n }, { name: "zfrancesck1", id: 456195985404592149n }],
    tags: ["Voice", "Friends", "Utility"],
    enabledByDefault: false,
    dependencies: ["HeaderBarAPI"],
    settings,
    settingsAboutComponent: TrackedUsersList,

    toolboxActions: {
        "Open FollowMe Settings": () => openPluginModal(Vencord.Plugins.plugins.FollowMe),
    },

    headerBarButton: {
        icon: FollowIcon,
        render: FollowMeHeaderButton,
        priority: 6,
    },

    contextMenus: {
        "user-context": UserContextMenuPatch,
        "user-profile-actions": UserContextMenuPatch,
    },

    start() {
        load();
    },

    stop() {
        followed.clear();
        desired.clear();
        queue.clear();
        lastToast.clear();
        active = 0;
        commit();
    },

    flux: {
        VOICE_STATE_UPDATES({ voiceStates }: { voiceStates: VoiceState[]; }) {
            if (!followed.size) return;

            const myId = UserStore.getCurrentUser()?.id;
            if (!myId) return;

            for (const s of voiceStates) {
                if (!s.channelId || s.channelId === s.oldChannelId) continue;

                if (s.userId === myId) {
                    pullAll(s.channelId);
                } else if (followed.has(s.userId)) {
                    const myChannelId = VoiceStateStore.getVoiceStateForUser(myId)?.channelId;
                    if (myChannelId) pull(s.userId, myChannelId, s.channelId);
                }
            }
        },
    },
});
