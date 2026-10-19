/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { NavContextMenuPatchCallback } from "@api/ContextMenu";
import { HeaderBarButton } from "@api/HeaderBar";
import { definePluginSettings } from "@api/Settings";
import { Devs } from "@utils/constants";
import { classes } from "@utils/misc";
import definePlugin, { OptionType } from "@utils/types";
import type { Channel, User } from "@vencord/discord-types";
import { findByPropsLazy, findStoreLazy } from "@webpack";
import {
    ChannelStore,
    Menu,
    PermissionsBits,
    PermissionStore,
    SelectedChannelStore,
    showToast,
    useEffect,
    UserStore,
    useState
} from "@webpack/common";
import type { PropsWithChildren, SVGProps } from "react";

import { FollowIcon as PanelFollowIcon, FollowPanelButton } from "./panel";

interface BaseIconProps extends IconProps {
    viewBox: string;
}

interface IconProps extends SVGProps<SVGSVGElement> {
    className?: string;
    height?: string | number;
    width?: string | number;
}

function Icon({
    height = 24,
    width = 24,
    className,
    children,
    viewBox,
    ...svgProps
}: PropsWithChildren<BaseIconProps>) {
    return (
        <svg
            className={classes(className, "vc-icon")}
            role="img"
            width={width}
            height={height}
            viewBox={viewBox}
            {...svgProps}
        >
            {children}
        </svg>
    );
}

function FollowIcon(props: IconProps) {
    return (
        <Icon
            {...props}
            className={classes(props.className, "vc-follow-icon")}
            viewBox="0 -960 960 960"
        >
            <path
                fill="currentColor"
                d="m480-120-58-52q-101-91-167-157T150-447.5Q111-500 95.5-544T80-634q0-94 63-157t157-63q52 0 99 22t81 62q34-40 81-62t99-22q94 0 157 63t63 157q0 46-15.5 90T810-447.5Q771-395 705-329T538-172l-58 52Zm0-108q96-86 158-147.5t98-107q36-45.5 50-81t14-70.5q0-60-40-100t-100-40q-47 0-87 26.5T518-680h-76q-15-41-55-67.5T300-774q-60 0-100 40t-40 100q0 35 14 70.5t50 81q36 45.5 98 107T480-228Zm0-273Z"
            />
        </Icon>
    );
}

function UnfollowIcon(props: IconProps) {
    return (
        <Icon
            {...props}
            className={classes(props.className, "vc-unfollow-icon")}
            viewBox="0 -960 960 960"
        >
            <path
                fill="currentColor"
                d="m480-120-58-52q-101-91-167-157T150-447.5Q111-500 95.5-544T80-634q0-94 63-157t157-63q52 0 99 22t81 62q34-40 81-62t99-22q94 0 157 63t63 157q0 46-15.5 90T810-447.5Q771-395 705-329T538-172l-58 52Z"
            />
        </Icon>
    );
}

function WalkIcon({ className, width = 24, height = 24 }: SVGProps<SVGSVGElement>) {
    return (
        <svg className={className} width={width} height={height} viewBox="0 0 24 24" aria-hidden="true">
            <path fill="currentColor" d="M13.5 5.5c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zM9.8 8.9 7 23h2.1l1.8-8 2.1 2v6h2v-7.5l-2.1-2 .6-3C14.8 12 16.8 13 19 13v-2c-1.9 0-3.5-1-4.3-2.4l-1-1.6c-.4-.6-1-1-1.7-1-.3 0-.5.1-.8.1L6 8.3V13h2V9.6l1.8-.7" />
        </svg>
    );
}

interface VoiceState {
    userId: string;
    channelId?: string;
    oldChannelId?: string;
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

export const settings = definePluginSettings({
    showToasts: {
        type: OptionType.BOOLEAN,
        description: "Show toast notifications",
        restartNeeded: false,
        default: true
    },
    executeOnFollow: {
        type: OptionType.BOOLEAN,
        description: "Make sure to be in the same VC when following a user",
        restartNeeded: false,
        default: true
    },
    onlyManualTrigger: {
        type: OptionType.BOOLEAN,
        description: "Only trigger on indicator click",
        restartNeeded: false,
        default: false
    },
    followLeave: {
        type: OptionType.BOOLEAN,
        description: "Also leave when the followed user leaves",
        restartNeeded: false,
        default: false
    },
    autoMoveBack: {
        type: OptionType.BOOLEAN,
        description: "Automatically move back to the VC of the followed user when you got moved",
        restartNeeded: false,
        default: false
    },
    followUserId: {
        type: OptionType.STRING,
        description: "Followed User ID",
        restartNeeded: false,
        hidden: true,
        default: "",
    },
    channelFull: {
        type: OptionType.BOOLEAN,
        description: "Attempt to move you to the channel when is not full anymore",
        restartNeeded: false,
        default: true,
    },
    onlyWhenInVoice: {
        type: OptionType.BOOLEAN,
        description: "Only follow while you are in a voice channel yourself",
        restartNeeded: false,
        default: false,
    },
    showPanelButton: {
        type: OptionType.BOOLEAN,
        description: "Show a follow management button in the user area panel",
        restartNeeded: true,
        default: false,
    },
    followedUsername: {
        type: OptionType.STRING,
        description: "Cached username of the followed user",
        restartNeeded: false,
        hidden: true,
        default: "",
    }
});

const ChannelActions: {
    disconnect: () => void;
    selectVoiceChannel: (channelId: string) => void;
} = findByPropsLazy("disconnect", "selectVoiceChannel");

const VoiceStateStore: VoiceStateStore = findStoreLazy("VoiceStateStore");
const CONNECT = 1n << 20n;

interface VoiceStateStore {
    getAllVoiceStates(): VoiceStateEntry;
    getVoiceStatesForChannel(channelId: string): VoiceStateMember;
}

interface VoiceStateEntry {
    [guildIdOrMe: string]: VoiceStateMember;
}

interface VoiceStateMember {
    [userId: string]: VoiceState;
}

const listeners = new Set<() => void>();

function notify() {
    listeners.forEach(fn => fn());
}

function toast(message: string, type: "success" | "failure") {
    if (settings.store.showToasts) showToast({ text: message, variant: type });
}

function useFollowedId() {
    const [, tick] = useState(0);
    settings.use(["followUserId"]);
    useEffect(() => {
        const fn = () => tick(n => n + 1);
        listeners.add(fn);
        return () => { listeners.delete(fn); };
    }, []);
    return settings.store.followUserId;
}

export function getChannelId(userId: string) {
    if (!userId) {
        return null;
    }
    try {
        const states = VoiceStateStore.getAllVoiceStates();
        for (const users of Object.values(states)) {
            if (users[userId]) {
                return users[userId].channelId ?? null;
            }
        }
    } catch (e) { }
    return null;
}

export function triggerFollow(userChannelId: string | null = getChannelId(settings.store.followUserId)) {
    if (settings.store.followUserId) {
        const myChanId = SelectedChannelStore.getVoiceChannelId();
        if (userChannelId) {
            if (userChannelId !== myChanId) {
                const channel = ChannelStore.getChannel(userChannelId);
                if (!channel) return;
                let memberCount: number | null = null;
                if (channel.userLimit !== 0) {
                    const voiceStates = VoiceStateStore.getVoiceStatesForChannel(userChannelId);
                    memberCount = 0;
                    if (voiceStates) for (const _ in voiceStates) memberCount++;
                }
                if (channel.type === 1 || PermissionStore.can(CONNECT, channel)) {
                    if (channel.userLimit !== 0 && memberCount !== null && memberCount >= channel.userLimit && !PermissionStore.can(PermissionsBits.MOVE_MEMBERS, channel)) {
                        toast("Channel is full", "failure");
                        return;
                    }
                    ChannelActions.selectVoiceChannel(userChannelId);
                    toast("Followed user into a new voice channel", "success");
                } else {
                    toast("Insufficient permissions to enter in the voice channel", "failure");
                }
            } else {
                toast("You are already in the same channel", "failure");
            }
        } else if (myChanId) {
            if (settings.store.followLeave) {
                ChannelActions.disconnect();
                toast("Followed user left, disconnected", "success");
            } else {
                toast("Followed user left, but not following disconnect", "failure");
            }
        } else {
            toast("Followed user is not in a voice channel", "failure");
        }
    }
}

function stopFollow() {
    settings.store.followUserId = "";
    settings.store.followedUsername = "";
    notify();
}

export function toggleFollow(userId: string) {
    if (settings.store.followUserId === userId) {
        stopFollow();
    } else {
        settings.store.followUserId = userId;
        settings.store.followedUsername = UserStore.getUser(userId)?.username ?? "";
        notify();
        if (settings.store.executeOnFollow) {
            triggerFollow();
        }
    }
}

interface UserContextProps {
    channel: Channel;
    guildId?: string;
    user: User;
}

const UserContext: NavContextMenuPatchCallback = (children, { user }: UserContextProps) => {
    if (!user || user.id === UserStore.getCurrentUser().id) return;
    const isFollowed = settings.store.followUserId === user.id;
    const label = isFollowed ? "Unfollow User" : "Follow User";
    const icon = isFollowed ? UnfollowIcon : FollowIcon;

    children.splice(-1, 0, (
        <Menu.MenuGroup>
            <Menu.MenuItem
                id="follow-user"
                label={label}
                action={() => toggleFollow(user.id)}
                icon={icon}
                leadingAccessory={{ type: "icon", icon }}
            />
        </Menu.MenuGroup>
    ));
};

function FollowHeaderButton() {
    const followUserId = useFollowedId();
    if (!followUserId) return null;

    return (
        <HeaderBarButton
            icon={WalkIcon}
            tooltip={`Following ${UserStore.getUser(followUserId)?.username ?? followUserId} (click to stop)`}
            onClick={stopFollow}
        />
    );
}

export default definePlugin({
    name: "FollowUser",
    description: "Adds a follow option in the user context menu to always be in the same VC as them",
    authors: [Devs.x2b, { name: "zfrancesck1", id: 456195985404592149n }],
    tags: ["Friends", "Voice"],
    enabledByDefault: false,
    settings,

    headerBarButton: {
        icon: WalkIcon,
        render: FollowHeaderButton,
        priority: 6,
    },

    userAreaButton: {
        icon: PanelFollowIcon,
        render: FollowPanelButton
    },

    contextMenus: {
        "user-context": UserContext
    },

    flux: {
        VOICE_STATE_UPDATES({ voiceStates }: { voiceStates: VoiceState[]; }) {
            const followUserId = settings.store.followUserId;
            if (settings.store.onlyManualTrigger || !followUserId) {
                return;
            }

            const myVoiceChannelId = SelectedChannelStore.getVoiceChannelId();
            if (settings.store.onlyWhenInVoice && !myVoiceChannelId) {
                return;
            }

            const autoMoveBack = settings.store.autoMoveBack;
            const channelFullSetting = settings.store.channelFull;
            const currentUserId = UserStore.getCurrentUser().id;

            for (const { userId, channelId, oldChannelId } of voiceStates) {
                if (channelId === oldChannelId) continue;

                const isMe = userId === currentUserId;

                if (autoMoveBack && isMe && channelId && oldChannelId) {
                    triggerFollow();
                    continue;
                }

                if (channelFullSetting && !isMe && !channelId && oldChannelId && oldChannelId !== myVoiceChannelId) {
                    const channel = ChannelStore.getChannel(oldChannelId);
                    if (channel && channel.userLimit !== 0 && !PermissionStore.can(PermissionsBits.MOVE_MEMBERS, channel)) {
                        const channelVoiceStates = VoiceStateStore.getVoiceStatesForChannel(oldChannelId);
                        let memberCount = 0;
                        let followedIsWaiting = false;
                        if (channelVoiceStates) {
                            for (const key in channelVoiceStates) {
                                memberCount++;
                                if (channelVoiceStates[key].userId === followUserId) followedIsWaiting = true;
                            }
                        }
                        if (followedIsWaiting && memberCount === (channel.userLimit - 1)) {
                            triggerFollow(oldChannelId);
                            continue;
                        }
                    }
                }

                if (followUserId !== userId) continue;

                if (channelId) {
                    triggerFollow(channelId);
                } else if (oldChannelId) {
                    triggerFollow(null);
                }
            }
        },
    },
});