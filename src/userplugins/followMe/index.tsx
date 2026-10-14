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
    Button, ChannelStore, Menu, RestAPI, SelectedChannelStore,
    showToast, useEffect, UserStore, useState, VoiceStateStore,
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

const THROTTLE_MS = 3000;
const IGNORED_CODES = new Set([40032, 10007]);

const followed = new Set<string>();
const listeners = new Set<() => void>();
const pending = new Map<string, Target>();
const known = new Map<string, string | null>();
const lastToast = new Map<string, number>();
let followedList: string[] = [];
let chain: Promise<unknown> = Promise.resolve();

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

async function run(userId: string, retried = false) {
    const target = pending.get(userId);
    pending.delete(userId);
    if (!target || !followed.has(userId)) return;

    try {
        await RestAPI.patch({
            url: `/guilds/${target.guild_id}/members/${userId}`,
            body: { channel_id: target.id },
        });
        throttledToast("FollowMe: users moved", "success");
    } catch (e: any) {
        if (e?.status === 403) {
            denyToast();
            return;
        }

        if (!retried && known.get(userId) !== null) {
            if (!pending.has(userId)) pending.set(userId, target);
            chain = chain.then(() => run(userId, true));
            return;
        }

        if (!IGNORED_CODES.has(e?.body?.code)) throttledToast(`FollowMe: move failed (${e?.status ?? "error"})`, "failure");
    }
}

function send(userId: string, channel: Target) {
    const queued = pending.has(userId);
    pending.set(userId, channel);
    if (!queued) chain = chain.then(() => run(userId));
}

function pull(userId: string, toChannelId: string) {
    if (known.get(userId) === toChannelId) return;

    const channel = ChannelStore.getChannel(toChannelId);
    if (!channel?.guild_id) return;

    send(userId, channel);
}

function pullAll(toChannelId: string) {
    const channel = ChannelStore.getChannel(toChannelId);
    if (!channel?.guild_id) return;

    const inside = VoiceStateStore.getVoiceStatesForChannel(toChannelId);

    for (const id of followed) {
        const current = known.get(id);
        if (current === null || current === toChannelId || inside?.[id]) continue;
        send(id, channel);
    }
}

function followUser(userId: string) {
    if (followed.has(userId)) return;
    followed.add(userId);
    commit();

    const myChannelId = SelectedChannelStore.getVoiceChannelId();
    if (myChannelId && !VoiceStateStore.getVoiceStatesForChannel(myChannelId)?.[userId]) pull(userId, myChannelId);

    toast(`FollowMe: user added [${getName(userId)}]`, "success");
}

function unfollowUser(userId: string) {
    if (!followed.delete(userId)) return;
    pending.delete(userId);
    known.delete(userId);
    commit();
    toast(`FollowMe: user removed [${getName(userId)}]`, "message");
}

function unfollowAll() {
    const n = followed.size;
    if (!n) return;
    followed.clear();
    pending.clear();
    known.clear();
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
        pending.clear();
        known.clear();
        lastToast.clear();
        chain = Promise.resolve();
        commit();
    },

    flux: {
        VOICE_STATE_UPDATES({ voiceStates }: { voiceStates: VoiceState[]; }) {
            if (!followed.size) return;

            try {
                const myId = UserStore.getCurrentUser()?.id;
                if (!myId) return;

                let mine: string | undefined;
                let moved: string[] | undefined;

                for (const s of voiceStates) {
                    if (s.userId === myId) {
                        if (s.channelId && s.channelId !== s.oldChannelId) mine = s.channelId;
                        continue;
                    }
                    if (!followed.has(s.userId)) continue;

                    known.set(s.userId, s.channelId ?? null);
                    if (s.channelId && s.channelId !== s.oldChannelId) (moved ??= []).push(s.userId);
                }

                if (mine) {
                    pullAll(mine);
                    return;
                }

                if (!moved) return;
                const myChannelId = SelectedChannelStore.getVoiceChannelId();
                if (!myChannelId) return;
                for (const id of moved) pull(id, myChannelId);
            } catch (e) {
                throttledToast(`FollowMe: error (${(e as Error)?.message ?? "unknown"})`, "failure");
            }
        },
    },
});