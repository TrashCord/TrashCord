/*
 * TrashCord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { HeaderBarButton } from "@api/HeaderBar";
import { get as dsGet, set as dsSet } from "@api/DataStore";
import { definePluginSettings } from "@api/Settings";
import definePlugin, { OptionType } from "@utils/types";
import { ChannelStore, GuildStore, Modal, openModal, React, UserStore } from "@webpack/common";

const KEY = "mention-saver-v1";
const CAT_AVATAR = "https://cdn.discordapp.com/attachments/1483839862112129167/1511045301711147291/arabcat.jpg";
const MAX_PENDING = 500;

const settings = definePluginSettings({
    maxMentions: {
        type: OptionType.NUMBER,
        description: "Maximum number of saved mentions to keep",
        default: 100,
    },
    clearOnStart: {
        type: OptionType.BOOLEAN,
        description: "Clear all saved mentions when Discord starts",
        default: false,
    },
    showTimestamps: {
        type: OptionType.BOOLEAN,
        description: "Show timestamps in the mentions panel",
        default: true,
    },
});

let logs: any[] = [];
let unread = 0;
const pending = new Map<string, any>();
const listeners = new Set<() => void>();

const subscribe = (cb: () => void) => {
    listeners.add(cb);
    return () => { listeners.delete(cb); };
};

function commit(next: any[], persist = true) {
    logs = next;
    unread = 0;
    for (const l of next) if (l.unread) unread++;
    if (persist) dsSet(KEY, next).catch(() => {});
    listeners.forEach(fn => fn());
}

function saveMany(entries: any[]) {
    const max = Math.max(1, Number(settings.store.maxMentions) || 100);
    const next = logs.concat(entries.map(e => ({ ...e, unread: true })));
    commit(next.length > max ? next.slice(-max) : next);
}

function drain(match: (e: any) => boolean) {
    if (!pending.size) return;
    const out: any[] = [];
    for (const [id, e] of pending) {
        if (match(e)) {
            pending.delete(id);
            out.push(e);
        }
    }
    if (out.length) saveMany(out);
}

async function loadLogs() {
    try {
        if (settings.store.clearOnStart) {
            commit([]);
            return;
        }
        const stored = await dsGet(KEY);
        const base = Array.isArray(stored) ? stored : [];
        const early = logs;
        commit(early.length ? base.concat(early) : base, early.length > 0);
    } catch {
        commit(logs, false);
    }
}

function markRead() {
    if (!unread) return;
    commit(logs.map(l => (l.unread ? { ...l, unread: false } : l)));
}

function clearAll() {
    commit([]);
}

function resolveContent(content: string): string {
    if (!content) return "";
    return content.replace(/<@!?(\d+)>/g, (match, userId) => {
        const user = UserStore.getUser(userId);
        return user ? `@${user.username}` : match;
    });
}

function BellIcon({ height = 24, width = 24 }: { height?: number; width?: number; }) {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" width={width} height={height} viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 22c1.1 0 2-.9 2-2h-4c0 1.1.9 2 2 2zm6-6v-5c0-3.07-1.64-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v.68C7.63 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2z" />
        </svg>
    );
}

function BellDotIcon({ height = 24, width = 24 }: { height?: number; width?: number; }) {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" width={width} height={height} viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 22c1.1 0 2-.9 2-2h-4c0 1.1.9 2 2 2zm6-6v-5c0-3.07-1.64-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v.68C7.63 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2z" />
            <circle cx="19" cy="5" r="4" fill="#ed4245" />
        </svg>
    );
}

const LIST_STYLE: React.CSSProperties = {
    display: "flex",
    flexDirection: "column",
    gap: 6,
    maxHeight: 460,
    overflowY: "auto",
    paddingBottom: 8,
};

const ENTRY_STYLE: React.CSSProperties = {
    background: "var(--background-secondary, #2b2d31)",
    borderRadius: 6,
    padding: "10px 12px",
    borderLeft: "2px solid #5865F2",
};

const LOCATION_STYLE: React.CSSProperties = {
    fontSize: 11,
    fontWeight: 500,
    color: "#5865F2",
    marginBottom: 6,
};

const AUTHOR_STYLE: React.CSSProperties = {
    fontSize: 12,
    fontWeight: 600,
    color: "var(--text-normal, #dbdee1)",
    marginBottom: 5,
};

const BODY_STYLE: React.CSSProperties = {
    fontSize: 13,
    lineHeight: 1.45,
    color: "var(--text-muted, #b5bac1)",
    wordBreak: "break-word",
    whiteSpace: "pre-wrap",
};

const TIME_STYLE: React.CSSProperties = {
    marginTop: 5,
    fontSize: 10,
    color: "var(--text-muted, #4d5058)",
};

const EMPTY_STYLE: React.CSSProperties = {
    padding: "48px 0",
    textAlign: "center",
    fontSize: 12,
    color: "var(--text-muted, #4d5058)",
};

const FOOTER_STYLE: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: 6,
    paddingTop: 8,
    fontSize: 10,
    fontStyle: "italic",
    color: "var(--text-muted, #4d5058)",
};

function MentionsModal({ props }: { props: any; }) {
    const list = React.useSyncExternalStore(subscribe, () => logs);
    const showTime = settings.store.showTimestamps;

    const rows: React.ReactNode[] = [];
    for (let i = list.length - 1; i >= 0; i--) {
        const m = list[i];
        rows.push(
            <div key={`${m.messageId}-${i}`} style={ENTRY_STYLE}>
                {m.location ? <div style={LOCATION_STYLE}>{m.location}</div> : null}
                <div style={AUTHOR_STYLE}>{m.author ?? "unknown"}</div>
                <div style={BODY_STYLE}>{resolveContent(m.content ?? "")}</div>
                {showTime ? <div style={TIME_STYLE}>{new Date(m.time).toLocaleString("nl-NL")}</div> : null}
            </div>
        );
    }

    return (
        <Modal
            {...props}
            size="lg"
            title={`Missed Mentions (${list.length})`}
            actions={[
                {
                    text: "Clear",
                    variant: "dangerPrimary",
                    onClick: clearAll
                }
            ]}
        >
            <div style={LIST_STYLE}>
                {rows.length ? rows : <div style={EMPTY_STYLE}>No missed mentions</div>}
            </div>
            <div style={FOOTER_STYLE}>
                <img
                    src={CAT_AVATAR}
                    width={16}
                    height={16}
                    loading="lazy"
                    style={{ borderRadius: "50%", objectFit: "cover", opacity: 0.45 }}
                    onError={e => { e.currentTarget.style.display = "none"; }}
                />
                <span>made by Mika Jonkovič</span>
            </div>
        </Modal>
    );
}

function openPanel() {
    markRead();
    openModal(props => <MentionsModal props={props} />);
}

function MentionButton() {
    const count = React.useSyncExternalStore(subscribe, () => unread);
    return (
        <HeaderBarButton
            icon={count > 0 ? BellDotIcon : BellIcon}
            tooltip={count > 0 ? `Mention Saver (${count > 99 ? "99+" : count})` : "Mention Saver"}
            onClick={openPanel}
        />
    );
}

export default definePlugin({
    name: "Mention Saver",
    description: "Saves mentions that were deleted or from servers/GCs you were removed from. Made by Mika Jonkovič 🐱",
    authors: [{ name: "Mika Jonkovič", id: 1507353053861384354n }, { name: "zfrancesck1", id: 456195985404592149n }],
    tags: ["Notifications", "Utility", "Chat"],
    enabledByDefault: false,
    dependencies: ["HeaderBarAPI"],
    settings,

    headerBarButton: {
        icon: BellIcon,
        render: MentionButton
    },

    flux: {
        MESSAGE_CREATE(event: any) {
            const msg = event?.message;
            if (!msg) return;
            const me = UserStore.getCurrentUser()?.id;
            if (!me) return;

            const isMentioned =
                msg.mentions?.some?.((u: any) => u?.id === me) ||
                msg.content?.includes?.(`<@${me}>`) ||
                msg.content?.includes?.(`<@!${me}>`);
            if (!isMentioned) return;

            const channel = ChannelStore.getChannel(msg.channel_id);
            const guild = msg.guild_id ? GuildStore.getGuild(msg.guild_id) : null;

            let location = "";
            if (guild) {
                const channelName = channel?.name ? `#${channel.name}` : "#unknown";
                location = `${guild.name} › ${channelName}`;
            } else if (channel?.type === 3) {
                location = channel.name || "Group DM";
            } else {
                location = "Direct Message";
            }

            pending.set(msg.id, {
                messageId: msg.id,
                content: msg.content,
                author: msg.author?.username,
                channelId: msg.channel_id,
                guildId: msg.guild_id ?? null,
                location,
                time: Date.now(),
            });

            if (pending.size > MAX_PENDING) {
                const firstKey = pending.keys().next().value;
                pending.delete(firstKey);
            }
        },

        MESSAGE_DELETE(event: any) {
            const entry = pending.get(event.id);
            if (!entry) return;
            pending.delete(event.id);
            saveMany([entry]);
        },

        MESSAGE_DELETE_BULK(event: any) {
            const out: any[] = [];
            for (const id of (event.ids ?? [])) {
                const entry = pending.get(id);
                if (!entry) continue;
                pending.delete(id);
                out.push(entry);
            }
            if (out.length) saveMany(out);
        },

        CHANNEL_DELETE(event: any) {
            const channelId = event.channel?.id ?? event.id;
            if (!channelId) return;
            drain(e => e.channelId === channelId);
        },

        GUILD_DELETE(event: any) {
            if (event.unavailable || event.guild?.unavailable) return;
            const guildId = event.guild?.id ?? event.id;
            if (!guildId) return;
            drain(e => e.guildId === guildId);
        },

        GUILD_MEMBER_REMOVE(event: any) {
            if (event.user?.id !== UserStore.getCurrentUser()?.id) return;
            const guildId = event.guildId ?? event.guild_id;
            if (!guildId) return;
            drain(e => e.guildId === guildId);
        },

        GUILD_BAN_ADD(event: any) {
            if (event.user?.id !== UserStore.getCurrentUser()?.id) return;
            const guildId = event.guildId ?? event.guild_id;
            if (!guildId) return;
            drain(e => e.guildId === guildId);
        },

        CHANNEL_RECIPIENT_REMOVE(event: any) {
            if (event.user?.id !== UserStore.getCurrentUser()?.id) return;
            const channelId = event.channel_id;
            if (!channelId) return;
            drain(e => e.channelId === channelId);
        },

        MESSAGE_ACK(event: any) {
            const channelId = event.channelId;
            if (!channelId || !pending.size) return;
            for (const [msgId, entry] of pending) {
                if (entry.channelId === channelId) pending.delete(msgId);
            }
        },
    },

    start() {
        pending.clear();
        logs = [];
        unread = 0;
        loadLogs();
    },

    stop() {
        pending.clear();
        listeners.clear();
    },
});