import { definePluginSettings } from "@api/Settings";
import { get as dsGet, set as dsSet } from "@api/DataStore";
import definePlugin, { OptionType } from "@utils/types";
import { ChannelStore, FluxDispatcher, GuildStore, UserStore } from "@webpack/common";

const KEY = "mention-saver-v1";
const CAT_AVATAR = "https://cdn.discordapp.com/attachments/1483839862112129167/1511045301711147291/arabcat.jpg";
const MAX_PENDING = 500; // max in-memory buffer

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

export default definePlugin({
    name: "Mention Saver",
    description: "Saves mentions that were deleted or from servers/GCs you were removed from. Made by Mika Jonkovič 🐱",
    authors: [{ name: "Mika Jonkovič", id: 1507353053861384354n }],
    tags: ["Notification", "Utility", "Chat"],
    enabledByDefault: false,
    settings,

    start() {
        this.logs = [];
        this.panel = null;
        this.button = null;
        this._observer = null;

        // Temporary in-memory buffer: messageId → entry
        // Mentions only graduate to logs when the message/channel/server is lost
        this._pending = new Map<string, any>();

        this._loadLogs();
        this._patchMessages();

        // Re-inject button whenever Discord's React removes it
        this._observer = new MutationObserver(() => {
            if (!document.getElementById("mention-saver-btn")) {
                this._injectButton();
            }
        });
        this._observer.observe(document.body, { childList: true, subtree: true });

        setTimeout(() => this._injectButton(), 500);
    },

    stop() {
        this._observer?.disconnect();
        this._observer = null;
        this._unsubAll?.();
        document.getElementById("mention-saver-btn")?.remove();
        document.getElementById("mention-saver-style")?.remove();
        this.removePanel();
        this._pending?.clear();
    },

    async _loadLogs() {
        try {
            if (settings.store.clearOnStart) {
                this.logs = [];
                await dsSet(KEY, []);
            } else {
                this.logs = (await dsGet(KEY)) ?? [];
            }
        } catch (e) {
            console.error("[MentionSaver] DataStore error:", e);
            this.logs = [];
        }
    },

    async _saveMention(entry: any) {
        if (!Array.isArray(this.logs)) this.logs = [];
        entry.unread = true;
        this.logs.push(entry);
        const max = settings.store.maxMentions ?? 100;
        if (this.logs.length > max) this.logs = this.logs.slice(-max);
        try { await dsSet(KEY, this.logs); } catch { /* ignore */ }
        this._updateBadge();
    },

    _patchMessages() {
        const myId = () => UserStore.getCurrentUser()?.id;

        // ── 1. Catch incoming mentions → pending buffer ──
        this._onMessageCreate = async (event: any) => {
            const msg = event?.message;
            if (!msg) return;
            const me = myId();
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
                const channelName = channel?.name ? `#${channel.name}` : `#unknown`;
                location = `${guild.name} › ${channelName}`;
            } else if (channel?.type === 3) {
                location = channel.name || "Group DM";
            } else {
                location = "Direct Message";
            }

            const entry = {
                messageId: msg.id,
                content: msg.content,
                author: msg.author?.username,
                channelId: msg.channel_id,
                guildId: msg.guild_id ?? null,
                location,
                time: Date.now(),
            };

            this._pending.set(msg.id, entry);

            // Trim pending buffer to avoid memory bloat
            if (this._pending.size > MAX_PENDING) {
                const firstKey = this._pending.keys().next().value;
                this._pending.delete(firstKey);
            }
        };

        // ── 2. Message deleted → save if it was our pending ping ──
        this._onMessageDelete = (event: any) => {
            const entry = this._pending.get(event.id);
            if (!entry) return;
            this._pending.delete(event.id);
            this._saveMention(entry);
        };

        // ── 3. Bulk delete (e.g. channel nuke) ──
        this._onMessageDeleteBulk = (event: any) => {
            for (const id of (event.ids ?? [])) {
                const entry = this._pending.get(id);
                if (!entry) continue;
                this._pending.delete(id);
                this._saveMention(entry);
            }
        };

        // ── 4. Channel deleted → save all pending pings from that channel ──
        this._onChannelDelete = (event: any) => {
            const channelId = event.channel?.id ?? event.id;
            if (!channelId) return;
            for (const [msgId, entry] of this._pending) {
                if (entry.channelId === channelId) {
                    this._pending.delete(msgId);
                    this._saveMention(entry);
                }
            }
        };

        // ── 5. Guild deleted/nuked → save all pending pings from that guild ──
        this._onGuildDelete = (event: any) => {
            const guildId = event.guild?.id ?? event.id;
            if (!guildId) return;
            for (const [msgId, entry] of this._pending) {
                if (entry.guildId === guildId) {
                    this._pending.delete(msgId);
                    this._saveMention(entry);
                }
            }
        };

        // ── 6. Kicked from server (GUILD_MEMBER_REMOVE with our ID) ──
        this._onMemberRemove = (event: any) => {
            if (event.user?.id !== myId()) return;
            const guildId = event.guildId ?? event.guild_id;
            if (!guildId) return;
            for (const [msgId, entry] of this._pending) {
                if (entry.guildId === guildId) {
                    this._pending.delete(msgId);
                    this._saveMention(entry);
                }
            }
        };

        // ── 7. Banned from server ──
        this._onBanAdd = (event: any) => {
            if (event.user?.id !== myId()) return;
            const guildId = event.guildId ?? event.guild_id;
            if (!guildId) return;
            for (const [msgId, entry] of this._pending) {
                if (entry.guildId === guildId) {
                    this._pending.delete(msgId);
                    this._saveMention(entry);
                }
            }
        };

        // ── 8. Removed from group DM ──
        this._onRecipientRemove = (event: any) => {
            if (event.user?.id !== myId()) return;
            const channelId = event.channel_id;
            if (!channelId) return;
            for (const [msgId, entry] of this._pending) {
                if (entry.channelId === channelId) {
                    this._pending.delete(msgId);
                    this._saveMention(entry);
                }
            }
        };

        // ── 9. Channel acknowledged (Read) ──
        // If you read the channel, you've seen the mention. Remove it from pending!
        this._onMessageAck = (event: any) => {
            const channelId = event.channelId;
            if (!channelId) return;
            for (const [msgId, entry] of this._pending) {
                if (entry.channelId === channelId) {
                    this._pending.delete(msgId);
                }
            }
        };

        FluxDispatcher.subscribe("MESSAGE_CREATE",          this._onMessageCreate);
        FluxDispatcher.subscribe("MESSAGE_DELETE",          this._onMessageDelete);
        FluxDispatcher.subscribe("MESSAGE_DELETE_BULK",     this._onMessageDeleteBulk);
        FluxDispatcher.subscribe("CHANNEL_DELETE",          this._onChannelDelete);
        FluxDispatcher.subscribe("GUILD_DELETE",            this._onGuildDelete);
        FluxDispatcher.subscribe("GUILD_MEMBER_REMOVE",     this._onMemberRemove);
        FluxDispatcher.subscribe("GUILD_BAN_ADD",           this._onBanAdd);
        FluxDispatcher.subscribe("CHANNEL_RECIPIENT_REMOVE",this._onRecipientRemove);
        FluxDispatcher.subscribe("MESSAGE_ACK",             this._onMessageAck);

        this._unsubAll = () => {
            FluxDispatcher.unsubscribe("MESSAGE_CREATE",          this._onMessageCreate);
            FluxDispatcher.unsubscribe("MESSAGE_DELETE",          this._onMessageDelete);
            FluxDispatcher.unsubscribe("MESSAGE_DELETE_BULK",     this._onMessageDeleteBulk);
            FluxDispatcher.unsubscribe("CHANNEL_DELETE",          this._onChannelDelete);
            FluxDispatcher.unsubscribe("GUILD_DELETE",            this._onGuildDelete);
            FluxDispatcher.unsubscribe("GUILD_MEMBER_REMOVE",     this._onMemberRemove);
            FluxDispatcher.unsubscribe("GUILD_BAN_ADD",           this._onBanAdd);
            FluxDispatcher.unsubscribe("CHANNEL_RECIPIENT_REMOVE",this._onRecipientRemove);
            FluxDispatcher.unsubscribe("MESSAGE_ACK",             this._onMessageAck);
        };
    },

    _updateBadge() {
        const badge = document.getElementById("mention-saver-badge");
        if (!badge) return;
        const unreadCount = Array.isArray(this.logs) ? this.logs.filter(l => l.unread).length : 0;
        if (unreadCount > 0) {
            badge.textContent = unreadCount > 99 ? "99+" : String(unreadCount);
            badge.style.display = "flex";
        } else {
            badge.style.display = "none";
        }
    },

    _injectButton() {
        if (document.getElementById("mention-saver-btn")) return;

        const inboxBtn =
            document.querySelector('[aria-label="Inbox"]') ||
            document.querySelector('[aria-label*="inbox" i]');

        const toolbar =
            document.querySelector('[class*="toolbar__"]') ||
            document.querySelector('[class*="toolbar"]');

        const container = inboxBtn?.parentElement ?? toolbar;
        if (!container) return;

        const wrapper = document.createElement("div");
        wrapper.id = "mention-saver-btn";
        wrapper.title = "Mention Saver";
        wrapper.style.cssText = `
            position: relative;
            display: flex;
            align-items: center;
            justify-content: center;
            width: 32px;
            height: 32px;
            border-radius: 4px;
            cursor: pointer;
            color: var(--interactive-normal, #b5bac1);
            transition: color 0.15s ease, background 0.15s ease;
            flex-shrink: 0;
        `;

        wrapper.innerHTML = `
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" style="pointer-events:none;">
                <path d="M12 22c1.1 0 2-.9 2-2h-4c0 1.1.9 2 2 2zm6-6v-5c0-3.07-1.64-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v.68C7.63 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2z"/>
            </svg>
            <div id="mention-saver-badge" style="
                display: none;
                position: absolute;
                top: 2px; right: 2px;
                background: #ed4245;
                color: white;
                font-size: 9px;
                font-weight: 700;
                min-width: 14px;
                height: 14px;
                border-radius: 7px;
                align-items: center;
                justify-content: center;
                padding: 0 3px;
                pointer-events: none;
                line-height: 1;
            "></div>
        `;

        wrapper.onmouseenter = () => {
            wrapper.style.color = "var(--interactive-hover, #dbdee1)";
            wrapper.style.background = "var(--background-modifier-hover, rgba(79,84,92,0.16))";
        };
        wrapper.onmouseleave = () => {
            wrapper.style.color = "var(--interactive-normal, #b5bac1)";
            wrapper.style.background = "transparent";
        };
        wrapper.onclick = (e) => {
            e.stopPropagation();
            this.togglePanel();
        };

        if (inboxBtn && inboxBtn.parentElement === container) {
            container.insertBefore(wrapper, inboxBtn);
        } else {
            container.insertBefore(wrapper, container.firstChild);
        }

        this.button = wrapper;
        this._updateBadge();
    },

    _resolveContent(content: string): string {
        if (!content) return "";
        return content.replace(/<@!?(\d+)>/g, (match, userId) => {
            const user = UserStore.getUser(userId);
            return user ? `@${user.username}` : match;
        });
    },

    togglePanel() {
        if (this.panel) {
            this.removePanel();
            return;
        }

        const btn = document.getElementById("mention-saver-btn");
        const btnRect = btn?.getBoundingClientRect();

        if (!document.getElementById("mention-saver-style")) {
            const style = document.createElement("style");
            style.id = "mention-saver-style";
            style.textContent = `
                @keyframes mention-panel-in {
                    from { opacity: 0; transform: translateY(-6px) scale(0.97); }
                    to   { opacity: 1; transform: translateY(0) scale(1); }
                }
                #mention-saver-panel ::-webkit-scrollbar { width: 4px; }
                #mention-saver-panel ::-webkit-scrollbar-thumb { background: #3d4046; border-radius: 4px; }
                #mention-saver-panel ::-webkit-scrollbar-track { background: transparent; }
            `;
            document.head.appendChild(style);
        }

        this.panel = document.createElement("div");
        this.panel.id = "mention-saver-panel";
        this.panel.style.cssText = `
            position: fixed;
            top: ${btnRect ? btnRect.bottom + 8 : 48}px;
            right: ${btnRect ? window.innerWidth - btnRect.right : 20}px;
            width: 360px;
            max-height: 500px;
            background: #1e1f22;
            color: #dbdee1;
            border-radius: 10px;
            z-index: 9999;
            font-size: 13px;
            font-family: 'gg sans', 'Noto Sans', sans-serif;
            display: flex;
            flex-direction: column;
            overflow: hidden;
            box-shadow: 0 12px 40px rgba(0,0,0,0.6), 0 2px 8px rgba(0,0,0,0.4);
            border: 1px solid rgba(255,255,255,0.06);
            animation: mention-panel-in 0.12s ease;
        `;

        const logs = Array.isArray(this.logs) ? this.logs : [];

        // ── Header ──
        const header = document.createElement("div");
        header.style.cssText = `
            padding: 14px 16px 12px;
            display: flex;
            align-items: center;
            justify-content: space-between;
            border-bottom: 1px solid rgba(255,255,255,0.05);
            flex-shrink: 0;
        `;
        header.innerHTML = `
            <div style="display:flex;align-items:center;gap:8px;">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="#8b8e94">
                    <path d="M12 22c1.1 0 2-.9 2-2h-4c0 1.1.9 2 2 2zm6-6v-5c0-3.07-1.64-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v.68C7.63 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2z"/>
                </svg>
                <span style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.7px;color:#8b8e94;">Missed Mentions</span>
                <span style="font-size:11px;font-weight:600;color:#4d5058;background:#2b2d31;padding:1px 7px;border-radius:10px;">${logs.length}</span>
            </div>
            <button id="mention-clear-btn" title="Clear all" style="
                background:none;border:none;cursor:pointer;
                display:flex;align-items:center;gap:4px;
                color:#8b8e94;font-size:11px;
                padding:3px 8px;border-radius:4px;
                transition:color 0.15s,background 0.15s;
            "
            onmouseover="this.style.color='#ed4245';this.style.background='rgba(237,66,69,0.1)'"
            onmouseout="this.style.color='#8b8e94';this.style.background='none'"
            >
                <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
                </svg>
                Clear
            </button>
        `;

        // ── List ──
        const list = document.createElement("div");
        list.style.cssText = `
            flex: 1;
            overflow-y: auto;
            padding: 10px 12px;
            display: flex;
            flex-direction: column;
            gap: 6px;
        `;

        if (logs.length === 0) {
            list.innerHTML = `
                <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;padding:48px 0;gap:10px;">
                    <svg width="28" height="28" viewBox="0 0 24 24" fill="#3d4046">
                        <path d="M20 18.69L7.84 6.14 5.27 3.49 4 4.76l2.8 2.8v.01c-.52.99-.8 2.16-.8 3.43v5l-2 2v1h13.73l2 2L21 19.72l-1-1.03zM12 22c1.11 0 2-.89 2-2h-4c0 1.11.89 2 2 2zm6-7.32V11c0-3.08-1.64-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v.68c-.24.06-.47.15-.69.23L18 14.68z"/>
                    </svg>
                    <span style="font-size:12px;color:#4d5058;">No missed mentions</span>
                </div>`;
        } else {
            list.innerHTML = logs
                .slice()
                .reverse()
                .map(m => {
                    const resolvedContent = this._resolveContent(m.content ?? "");
                    const timeStr = settings.store.showTimestamps
                        ? `<div style="margin-top:5px;font-size:10px;color:#4d5058;">${new Date(m.time).toLocaleString("nl-NL")}</div>`
                        : "";
                    const locationStr = m.location
                        ? `<div style="display:flex;align-items:center;gap:4px;margin-bottom:6px;">
                               <svg width="10" height="10" viewBox="0 0 24 24" fill="#5865F2" style="flex-shrink:0;">
                                   <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/>
                               </svg>
                               <span style="font-size:10px;color:#5865F2;font-weight:500;">${m.location}</span>
                           </div>`
                        : "";
                    return `
                        <div style="background:#2b2d31;border-radius:6px;padding:10px 12px;border-left:2px solid #5865F2;">
                            ${locationStr}
                            <div style="display:flex;align-items:center;gap:6px;margin-bottom:5px;">
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="#8b8e94">
                                    <path d="M12 12c2.7 0 4.8-2.1 4.8-4.8S14.7 2.4 12 2.4 7.2 4.5 7.2 7.2 9.3 12 12 12zm0 2.4c-3.2 0-9.6 1.6-9.6 4.8v2.4h19.2v-2.4c0-3.2-6.4-4.8-9.6-4.8z"/>
                                </svg>
                                <span style="font-size:12px;font-weight:600;color:#dbdee1;">${m.author ?? "unknown"}</span>
                            </div>
                            <div style="font-size:13px;line-height:1.45;color:#b5bac1;word-break:break-word;">${resolvedContent}</div>
                            ${timeStr}
                        </div>
                    `;
                }).join("");
        }

        // ── Footer ──
        const footer = document.createElement("div");
        footer.style.cssText = `
            padding: 8px 14px;
            display: flex;
            align-items: center;
            gap: 6px;
            border-top: 1px solid rgba(255,255,255,0.04);
            background: rgba(0,0,0,0.15);
            flex-shrink: 0;
        `;
        footer.innerHTML = `
            <img src="${CAT_AVATAR}" style="width:16px;height:16px;border-radius:50%;object-fit:cover;opacity:0.45;" onerror="this.style.display='none'"/>
            <span style="font-size:10px;color:#3d4046;font-style:italic;">made by Mika Jonkovič</span>
        `;

        this.panel.appendChild(header);
        this.panel.appendChild(list);
        this.panel.appendChild(footer);
        document.body.appendChild(this.panel);

        // Mark all as read so the badge clears, but keep them in the list
        let changed = false;
        for (const log of this.logs) {
            if (log.unread) {
                log.unread = false;
                changed = true;
            }
        }
        if (changed) {
            dsSet(KEY, this.logs).catch(() => {});
            this._updateBadge();
        }

        header.querySelector("#mention-clear-btn")?.addEventListener("click", async () => {
            this.logs = [];
            try { await dsSet(KEY, []); } catch { /* ignore */ }
            this.removePanel();
            this._updateBadge();
        });

        this._outsideClick = (e: MouseEvent) => {
            if (!this.panel?.contains(e.target as Node) &&
                !(e.target as Element)?.closest?.("#mention-saver-btn")) {
                this.removePanel();
            }
        };
        setTimeout(() => document.addEventListener("click", this._outsideClick), 100);
    },

    removePanel() {
        this.panel?.remove();
        this.panel = null;
        if (this._outsideClick) {
            document.removeEventListener("click", this._outsideClick);
            this._outsideClick = null;
        }
    },
});
