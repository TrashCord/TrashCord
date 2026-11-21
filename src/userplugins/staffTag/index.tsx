/*
 * TrashCord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { Devs } from "@utils/constants";
import definePlugin, { OptionType } from "@utils/types";
import { GuildMemberStore, GuildRoleStore, GuildStore, PermissionsBits, SelectedGuildStore, UserStore, useStateFromStores } from "@webpack/common";

const settings = definePluginSettings({
    useCrown: { type: OptionType.BOOLEAN, description: "Show a crown instead of a text tag.", default: true },
    useRoleColor: { type: OptionType.BOOLEAN, description: "Color badges with the member's role color.", default: true },
    ignoreBots: { type: OptionType.BOOLEAN, description: "Hide badges for bots.", default: true },
    ignoreSelf: { type: OptionType.BOOLEAN, description: "Hide your own badge.", default: false },
    owners: { type: OptionType.BOOLEAN, description: "Mark server owners.", default: true },
    admins: { type: OptionType.BOOLEAN, description: "Mark members with Administrator permission.", default: true },
    management: { type: OptionType.BOOLEAN, description: "Mark members with moderation or management permissions.", default: true },
    voiceList: { type: OptionType.BOOLEAN, description: "Show badges beside users in voice channels.", default: true },
    memberList: { type: OptionType.BOOLEAN, description: "Show badges in the member list.", default: true },
    messages: { type: OptionType.BOOLEAN, description: "Show badges beside message authors.", default: true },
    profiles: { type: OptionType.BOOLEAN, description: "Show badges in user profiles.", default: true },
    ownerLabel: { type: OptionType.STRING, description: "Label for server owners.", default: "Owner" },
    adminLabel: { type: OptionType.STRING, description: "Label for administrators.", default: "Admin" },
    managementLabel: { type: OptionType.STRING, description: "Label for moderators and managers.", default: "Management" }
});

const placeKey = { voice: "voiceList", member: "memberList", message: "messages", profile: "profiles" } as const;
const colors = { owner: "#faa61a", admin: "#aaa9ad", management: "#b88954" } as const;
const labelKey = { owner: "ownerLabel", admin: "adminLabel", management: "managementLabel" } as const;
const managementNames = ["MANAGE_GUILD", "MANAGE_CHANNELS", "MANAGE_ROLES", "KICK_MEMBERS", "BAN_MEMBERS", "MANAGE_MESSAGES", "MANAGE_THREADS", "MANAGE_EVENTS", "MODERATE_MEMBERS", "MUTE_MEMBERS", "DEAFEN_MEMBERS", "MOVE_MEMBERS"] as const;

const wrapStyle = { display: "inline-flex", alignItems: "center", flex: "none", verticalAlign: "middle", marginLeft: 4, lineHeight: 1 } as const;
const voiceStyle = { ...wrapStyle, marginRight: 3 } as const;
const svgStyle = { display: "block" } as const;
const labelStyle = { padding: "2px 4px", borderRadius: 3, border: "1px solid currentColor", fontSize: 10, fontWeight: 700 } as const;

let managementMask: bigint | undefined;

function getManagementMask(): bigint {
    if (managementMask === undefined) {
        let mask = 0n;
        for (const name of managementNames) mask |= PermissionsBits[name] ?? 0n;
        managementMask = mask;
    }
    return managementMask;
}

function getTag(guildId: string, userId: string): string {
    const s = settings.store;
    const guild = GuildStore.getGuild(guildId);
    const user = UserStore.getUser(userId);
    if (!guild || !user) return "";
    if (s.ignoreBots && user.bot) return "";
    if (s.ignoreSelf && userId === UserStore.getCurrentUser()?.id) return "";

    const member = GuildMemberStore.getMember(guildId, userId);
    let kind: keyof typeof colors;

    if (guild.ownerId === userId) {
        if (!s.owners) return "";
        kind = "owner";
    } else {
        if (!member?.roles) return "";
        let perms = 0n;
        const everyone = GuildRoleStore.getRole(guildId, guildId);
        if (everyone) perms |= BigInt(everyone.permissions);
        for (const id of member.roles) {
            const role = GuildRoleStore.getRole(guildId, id);
            if (role) perms |= BigInt(role.permissions);
        }

        if ((perms & PermissionsBits.ADMINISTRATOR) !== 0n) {
            if (!s.admins) return "";
            kind = "admin";
        } else if ((perms & getManagementMask()) !== 0n) {
            if (!s.management) return "";
            kind = "management";
        } else return "";
    }

    return `${kind}|${s.useRoleColor && member?.colorString || ""}`;
}

function StaffBadge({ guildId, userId, place }: { guildId: string; userId: string; place: keyof typeof placeKey; }) {
    settings.use(["useCrown", "useRoleColor", "ignoreBots", "ignoreSelf", "owners", "admins", "management", placeKey[place], "ownerLabel", "adminLabel", "managementLabel"]);
    const tag = useStateFromStores([GuildStore, GuildMemberStore, GuildRoleStore], () => getTag(guildId, userId));

    if (!tag || !settings.store[placeKey[place]]) return null;

    const [kind, color] = tag.split("|") as [keyof typeof colors, string];
    const label = settings.store[labelKey[kind]] || kind;

    return (
        <span title={label} role="img" aria-label={label} style={{ ...(place === "voice" ? voiceStyle : wrapStyle), color: color || colors[kind] }}>
            {settings.store.useCrown
                ? <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" style={svgStyle}>
                    <path d="M2 7.5a1.5 1.5 0 1 1 2.6 1.02L8.3 12l2.4-5.5a1.5 1.5 0 1 1 2.6 0l2.4 5.5 3.7-3.48A1.5 1.5 0 1 1 22 7.5L20.5 18h-17L2 7.5ZM4 20h16v2H4v-2Z" />
                </svg>
                : <span style={labelStyle}>{label}</span>}
        </span>
    );
}

export default definePlugin({
    name: "StaffTag",
    description: "Show owner, administrator and moderator badges in voice channels, member lists, messages and profiles.",
    authors: [Devs.DavidHiFi, { name: "zfrancesck1", id: 456195985404592149n }],
    tags: ["Servers"],
    enabledByDefault: false,
    dependencies: ["MemberListDecoratorsAPI", "MessageDecorationsAPI", "NicknameIconsAPI"],
    settings,
    renderMemberListDecorator({ type, user, channel }) {
        if (type !== "guild" || !user) return null;
        const guildId = channel?.guild_id ?? SelectedGuildStore.getGuildId();
        return guildId ? <StaffBadge guildId={guildId} userId={user.id} place="member" /> : null;
    },
    renderMessageDecoration({ channel, message }) {
        if (!channel?.guild_id || !message?.author) return null;
        return <StaffBadge guildId={channel.guild_id} userId={message.author.id} place="message" />;
    },
    renderNicknameIcon({ userId }) {
        const guildId = SelectedGuildStore.getGuildId();
        return guildId ? <StaffBadge guildId={guildId} userId={userId} place="profile" /> : null;
    },
    patches: [{
        find: "#{intl::GUEST_NAME_SUFFIX})]",
        replacement: {
            match: /#{intl::GUEST_NAME_SUFFIX}\)\]\}\):""(?=.*?userId:(\i\.\i))/,
            replace: "$&,$self.renderVoiceTag($1)"
        }
    }],
    renderVoiceTag(userId: string) {
        const guildId = SelectedGuildStore.getGuildId();
        return guildId && userId ? <StaffBadge guildId={guildId} userId={userId} place="voice" /> : null;
    }
});