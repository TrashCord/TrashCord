/*
 * AutoCamOff, a Vencord/Equicord user plugin
 * Copyright (c) 2026 Kurtzon (Kurtzon Audio)
 * SPDX-License-Identifier: MIT
 */

import { definePluginSettings } from "@api/Settings";
import definePlugin, { OptionType } from "@utils/types";
import type { VoiceState } from "@vencord/discord-types";
import { ChannelStore, FluxDispatcher, GuildMemberStore, GuildRoleStore, GuildStore, MediaEngineStore, PermissionsBits, SelectedChannelStore, showToast, UserStore, VoiceStateStore } from "@webpack/common";

const settings = definePluginSettings({
    owners: {
        type: OptionType.BOOLEAN,
        description: "Turn the camera off when the server owner joins.",
        default: true
    },
    admins: {
        type: OptionType.BOOLEAN,
        description: "Turn the camera off when a member with Administrator joins.",
        default: true
    },
    management: {
        type: OptionType.BOOLEAN,
        description: "Turn the camera off when a member with moderation or management permissions joins.",
        default: true
    },
    ignoreBots: {
        type: OptionType.BOOLEAN,
        description: "Ignore bots.",
        default: true
    },
    ignoreUsers: {
        type: OptionType.STRING,
        description: "User IDs to ignore, separated by commas.",
        default: ""
    },
    notify: {
        type: OptionType.BOOLEAN,
        description: "Show a toast when the camera turns off.",
        default: true
    }
});

function isIgnored(userId: string) {
    return settings.store.ignoreUsers.split(",").map(id => id.trim()).filter(Boolean).includes(userId);
}

function isStaff(guildId: string, userId: string) {
    const guild = GuildStore.getGuild(guildId);
    const user = UserStore.getUser(userId);
    if (!guild || !user || settings.store.ignoreBots && user.bot || isIgnored(userId)) return false;

    if (guild.ownerId === userId) return settings.store.owners;

    const member = GuildMemberStore.getMember(guildId, userId);
    if (!member) return false;

    const roles = GuildRoleStore.getRolesSnapshot(guildId);
    let permissions = roles[guildId]?.permissions ?? 0n;
    for (const roleId of member.roles) permissions |= roles[roleId]?.permissions ?? 0n;

    if (permissions & PermissionsBits.ADMINISTRATOR) return settings.store.admins;

    const managementBits = PermissionsBits.MANAGE_GUILD | PermissionsBits.MANAGE_CHANNELS |
        PermissionsBits.MANAGE_ROLES | PermissionsBits.KICK_MEMBERS | PermissionsBits.BAN_MEMBERS |
        PermissionsBits.MANAGE_MESSAGES | PermissionsBits.MANAGE_THREADS | PermissionsBits.MANAGE_EVENTS |
        PermissionsBits.MUTE_MEMBERS | PermissionsBits.DEAFEN_MEMBERS | PermissionsBits.MOVE_MEMBERS |
        PermissionsBits.MODERATE_MEMBERS;
    return settings.store.management && (permissions & managementBits) !== 0n;
}

function turnCameraOff(message: string) {
    if (!MediaEngineStore.isVideoEnabled()) return;
    FluxDispatcher.dispatch({ type: "MEDIA_ENGINE_SET_VIDEO_ENABLED", enabled: false });
    if (settings.store.notify) showToast(message, "message");
}

function checkChannel() {
    const channelId = SelectedChannelStore.getVoiceChannelId();
    if (!channelId) return;

    const channel = ChannelStore.getChannel(channelId);
    if (!channel?.guild_id) return;

    const me = UserStore.getCurrentUser()?.id;
    for (const state of Object.values(VoiceStateStore.getVoiceStatesForChannel(channelId))) {
        if (state.userId === me || !isStaff(channel.guild_id, state.userId)) continue;
        turnCameraOff("Camera turned off: someone with permissions is here");
        return;
    }
}

export default definePlugin({
    name: "AutoCamOff",
    description: "Turns your camera off when a server owner, admin or moderator joins your voice channel.",
    authors: [{ name: "Kurtzon", id: 0n }],
    tags: ["Privacy", "Voice", "Utility"],
    enabledByDefault: false,
    searchTerms: ["camera", "cam", "video", "admin", "moderator"],
    settings,
    start() {
        checkChannel();
    },
    flux: {
        VOICE_STATE_UPDATES({ voiceStates }: { voiceStates: VoiceState[]; }) {
            const me = UserStore.getCurrentUser()?.id;
            const channelId = SelectedChannelStore.getVoiceChannelId();
            if (!me || !channelId) return;

            const channel = ChannelStore.getChannel(channelId);
            if (!channel?.guild_id) return;

            for (const { userId, channelId: newChannelId, oldChannelId } of voiceStates) {
                if (newChannelId !== channelId || oldChannelId === channelId) continue;
                if (userId === me) {
                    checkChannel();
                    return;
                }
                if (!isStaff(channel.guild_id, userId)) continue;
                turnCameraOff(`Camera turned off: ${UserStore.getUser(userId)?.username ?? "someone"} joined`);
                return;
            }
        }
    }
});
