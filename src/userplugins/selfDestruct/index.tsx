/*
 * TrashCord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ChatBarButton, ChatBarButtonFactory } from "@api/ChatButtons";
import * as DataStore from "@api/DataStore";
import { addChannelToolbarButton, addHeaderBarButton, ChannelToolbarButton, HeaderBarButton, removeChannelToolbarButton, removeHeaderBarButton } from "@api/HeaderBar";
import { definePluginSettings } from "@api/Settings";
import { ModalCloseButton, ModalContent, ModalHeader, ModalRoot, ModalSize, openModal } from "@utils/modal";
import definePlugin, { OptionType } from "@utils/types";
import { findByPropsLazy, findStoreLazy } from "@webpack";
import { React } from "@webpack/common";

const MessageActions = findByPropsLazy("deleteMessage", "startEditMessage");
const UserStore = findStoreLazy("UserStore");

const PENDING_KEY = "SelfDestruct_pending";
const BUTTON_ID = "SelfDestruct";
const PRESETS = [5, 10, 30, 60, 300, 600, 1800, 3600];

const settings = definePluginSettings({
    location: {
        type: OptionType.SELECT,
        description: "Where to show the button (click it to open the quick settings panel)",
        options: [
            { label: "Chat bar", value: "chatbar", default: true },
            { label: "Header bar", value: "headerbar" },
            { label: "Channel toolbar", value: "channeltoolbar" },
            { label: "Disabled", value: "disabled" },
        ],
        restartNeeded: true,
    },
    active: {
        type: OptionType.BOOLEAN,
        description: "Delete my new messages automatically",
        default: false,
    },
    delay: {
        type: OptionType.NUMBER,
        description: "Seconds before a message is deleted (minimum 1)",
        default: 30,
    },
    scope: {
        type: OptionType.SELECT,
        description: "Where messages are deleted",
        options: [
            { label: "Servers and DMs", value: "all", default: true },
            { label: "Servers only", value: "guilds" },
            { label: "DMs and group DMs only", value: "dms" },
        ],
    },
    showBadge: {
        type: OptionType.BOOLEAN,
        description: "Show the deletion time under messages (click it to cancel the deletion)",
        default: true,
    },
    persistTimers: {
        type: OptionType.BOOLEAN,
        description: "Keep pending deletions across restarts (expired ones are deleted at startup)",
        default: true,
    },
});

interface TimerEntry {
    channelId: string;
    expiresAt: number;
    timerId: ReturnType<typeof setTimeout>;
}

interface PendingEntry {
    channelId: string;
    expiresAt: number;
}

const activeTimers = new Map<string, TimerEntry>();
let running = false;

function getDelay(): number {
    return Math.min(86400, Math.max(1, Math.floor(Number(settings.store.delay) || 30)));
}

function formatSeconds(s: number): string {
    if (s < 60) return `${s}s`;
    if (s < 3600) {
        const m = Math.floor(s / 60);
        const r = s % 60;
        return r ? `${m}m${r}s` : `${m}m`;
    }
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    return m ? `${h}h${m}m` : `${h}h`;
}

function savePending() {
    if (!settings.store.persistTimers) return;
    const out: Record<string, PendingEntry> = {};
    for (const [id, e] of activeTimers) out[id] = { channelId: e.channelId, expiresAt: e.expiresAt };
    DataStore.set(PENDING_KEY, out).catch(() => { });
}

function scheduleDelete(channelId: string, messageId: string, delayMs: number, save = true) {
    const timerId = setTimeout(() => {
        activeTimers.delete(messageId);
        savePending();
        try {
            MessageActions?.deleteMessage(channelId, messageId);
        } catch (e) {
            console.error("[SelfDestruct] Delete failed:", e);
        }
    }, delayMs);

    activeTimers.set(messageId, { channelId, expiresAt: Date.now() + delayMs, timerId });
    if (save) savePending();
}

function cancelTimer(messageId: string) {
    const entry = activeTimers.get(messageId);
    if (!entry) return;
    clearTimeout(entry.timerId);
    activeTimers.delete(messageId);
    savePending();
}

function cleanup() {
    for (const entry of activeTimers.values()) clearTimeout(entry.timerId);
    activeTimers.clear();
}

async function restorePending() {
    try {
        if (!settings.store.persistTimers) {
            await DataStore.del(PENDING_KEY);
            return;
        }
        const stored = await DataStore.get<Record<string, PendingEntry>>(PENDING_KEY);
        if (!stored || !running) return;

        const now = Date.now();
        let i = 0;
        for (const [id, e] of Object.entries(stored)) {
            if (activeTimers.has(id)) continue;
            const left = e.expiresAt - now;
            scheduleDelete(e.channelId, id, left > 0 ? left : i++ * 300, false);
        }
        savePending();
    } catch (e) {
        console.warn("[SelfDestruct] Failed to restore pending deletions:", e);
    }
}

function TimerBadge({ messageId }: { messageId: string; }) {
    const [, force] = React.useReducer((x: number) => x + 1, 0);
    const entry = activeTimers.get(messageId);
    if (!entry) return null;

    const timeStr = new Date(entry.expiresAt).toLocaleTimeString();

    return (
        <div
            onClick={() => {
                cancelTimer(messageId);
                force();
            }}
            style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "5px",
                marginTop: "4px",
                padding: "2px 8px",
                borderRadius: "12px",
                backgroundColor: "rgba(237, 66, 69, 0.12)",
                color: "#ed4245",
                fontSize: "12px",
                fontWeight: 600,
                fontFamily: "var(--font-primary)",
                lineHeight: "18px",
                userSelect: "none",
                cursor: "pointer",
                width: "fit-content",
            }}
            title={`SelfDestruct - deleted automatically at ${timeStr} (click to cancel)`}
        >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="10" stroke="#ed4245" strokeWidth="2" fill="none" />
                <path d="M12 6v6l4 2" stroke="#ed4245" strokeWidth="2" strokeLinecap="round" />
            </svg>
            {timeStr}
        </div>
    );
}

function SelfDestructIcon({ active, width = 20, height = 20 }: { active?: boolean; width?: number; height?: number; }) {
    return (
        <svg
            aria-hidden="true"
            role="img"
            xmlns="http://www.w3.org/2000/svg"
            width={width}
            height={height}
            fill="none"
            viewBox="0 0 24 24"
            style={{ color: active ? "#ed4245" : "currentColor" }}
        >
            <circle cx="12" cy="13" r="8" stroke="currentColor" strokeWidth="2" fill="none" />
            <path d="M12 9v4l3 2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            <path d="M12 5V3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            <path d="M10 3h4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            {!active && (
                <path
                    fill="var(--status-danger)"
                    d="M21.178 1.707 22.592 3.12 4.12 21.593l-1.414-1.415L21.178 1.707Z"
                />
            )}
        </svg>
    );
}

function ReactiveIcon() {
    const { active } = settings.use(["active"]);
    return <SelfDestructIcon active={active} />;
}

const CHIP_BASE: React.CSSProperties = {
    padding: "6px 12px",
    borderRadius: 6,
    border: "1px solid var(--border-subtle, #4e5058)",
    background: "transparent",
    color: "var(--text-normal, #dbdee1)",
    cursor: "pointer",
    fontSize: 13,
    fontWeight: 600,
};

const CHIP_SELECTED: React.CSSProperties = {
    ...CHIP_BASE,
    background: "#ed4245",
    borderColor: "#ed4245",
    color: "#fff",
};

const ROW_STYLE: React.CSSProperties = { display: "flex", flexWrap: "wrap", gap: 6 };

const LABEL_STYLE: React.CSSProperties = {
    margin: "14px 0 6px",
    fontSize: 12,
    fontWeight: 700,
    textTransform: "uppercase",
    color: "var(--header-secondary, #b5bac1)",
};

function Chip({ selected, onClick, children }: { selected: boolean; onClick(): void; children: React.ReactNode; }) {
    return (
        <button type="button" style={selected ? CHIP_SELECTED : CHIP_BASE} onClick={onClick}>
            {children}
        </button>
    );
}

function SelfDestructPanel({ modalProps }: { modalProps: any; }) {
    const { active, delay, scope, showBadge, persistTimers } = settings.use(["active", "delay", "scope", "showBadge", "persistTimers"]);
    const seconds = Math.min(86400, Math.max(1, Math.floor(Number(delay) || 30)));

    function commitDelay(e: React.FocusEvent<HTMLInputElement>) {
        const v = Math.floor(Number(e.currentTarget.value));
        if (v >= 1) settings.store.delay = Math.min(v, 86400);
    }

    return (
        <ModalRoot {...modalProps} size={ModalSize.SMALL}>
            <ModalHeader>
                <div style={{ flexGrow: 1, fontSize: 18, fontWeight: 700, color: "var(--header-primary, #fff)" }}>SelfDestruct</div>
                <ModalCloseButton onClick={modalProps.onClose} />
            </ModalHeader>
            <ModalContent>
                <div style={{ paddingBottom: 16 }}>
                    <button
                        type="button"
                        onClick={() => { settings.store.active = !settings.store.active; }}
                        style={{
                            ...(active ? CHIP_SELECTED : CHIP_BASE),
                            width: "100%",
                            padding: "10px 12px",
                            fontSize: 15,
                        }}
                    >
                        {active ? `ON - deleting my messages after ${formatSeconds(seconds)}` : "OFF - click to enable"}
                    </button>

                    <div style={LABEL_STYLE}>Delay</div>
                    <div style={ROW_STYLE}>
                        {PRESETS.map(p => (
                            <Chip key={p} selected={seconds === p} onClick={() => { settings.store.delay = p; }}>
                                {formatSeconds(p)}
                            </Chip>
                        ))}
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}>
                        <input
                            key={seconds}
                            type="number"
                            min={1}
                            max={86400}
                            defaultValue={seconds}
                            onBlur={commitDelay}
                            onKeyDown={e => { if (e.key === "Enter") e.currentTarget.blur(); }}
                            style={{
                                width: 110,
                                padding: "6px 8px",
                                borderRadius: 6,
                                border: "1px solid var(--border-subtle, #4e5058)",
                                background: "var(--input-background, #1e1f22)",
                                color: "var(--text-normal, #dbdee1)",
                            }}
                        />
                        <span style={{ color: "var(--text-muted, #b5bac1)", fontSize: 13 }}>custom seconds</span>
                    </div>

                    <div style={LABEL_STYLE}>Where</div>
                    <div style={ROW_STYLE}>
                        <Chip selected={scope === "all"} onClick={() => { settings.store.scope = "all"; }}>Servers and DMs</Chip>
                        <Chip selected={scope === "guilds"} onClick={() => { settings.store.scope = "guilds"; }}>Servers only</Chip>
                        <Chip selected={scope === "dms"} onClick={() => { settings.store.scope = "dms"; }}>DMs only</Chip>
                    </div>

                    <div style={LABEL_STYLE}>Options</div>
                    <div style={ROW_STYLE}>
                        <Chip selected={showBadge} onClick={() => { settings.store.showBadge = !settings.store.showBadge; }}>
                            Badge: {showBadge ? "ON" : "OFF"}
                        </Chip>
                        <Chip selected={persistTimers} onClick={() => { settings.store.persistTimers = !settings.store.persistTimers; }}>
                            Keep after restart: {persistTimers ? "ON" : "OFF"}
                        </Chip>
                    </div>
                </div>
            </ModalContent>
        </ModalRoot>
    );
}

function openPanel() {
    openModal(props => <SelfDestructPanel modalProps={props} />);
}

function buildTooltip(active: boolean, delay: number) {
    return active
        ? `SelfDestruct: ON (${formatSeconds(Math.max(1, Math.floor(Number(delay) || 30)))}) - click for settings`
        : "SelfDestruct: OFF - click for settings";
}

const SelfDestructButton: ChatBarButtonFactory = ({ isMainChat }) => {
    const { active, delay, location } = settings.use(["active", "delay", "location"]);

    if (!isMainChat || location !== "chatbar") return null;

    return (
        <ChatBarButton
            tooltip={buildTooltip(active, delay)}
            onClick={openPanel}
            onContextMenu={e => {
                e.preventDefault();
                settings.store.active = !settings.store.active;
            }}
        >
            <SelfDestructIcon active={active} />
        </ChatBarButton>
    );
};

function HeaderButton() {
    const { active, delay } = settings.use(["active", "delay"]);
    return <HeaderBarButton icon={ReactiveIcon} tooltip={buildTooltip(active, delay)} onClick={openPanel} />;
}

function ToolbarButton() {
    const { active, delay } = settings.use(["active", "delay"]);
    return <ChannelToolbarButton icon={ReactiveIcon} tooltip={buildTooltip(active, delay)} onClick={openPanel} selected={active} />;
}

export default definePlugin({
    name: "SelfDestruct",
    description: "Deletes your new messages automatically after a delay. Click the button for quick settings, right-click it in the chat bar to toggle. Click a message badge to cancel its deletion.",
    authors: [{ name: "Nightcord", id: 0n }, { name: "zfrancesck1", id: 456195985404592149n }],
    tags: ["Chat", "Utility", "Privacy"],
    enabledByDefault: false,
    dependencies: ["ChatInputButtonAPI", "MessageAccessoriesAPI", "HeaderBarAPI"],
    settings,
    chatBarButton: {
        icon: ReactiveIcon,
        render: SelfDestructButton,
    },

    renderMessageAccessory(props: Record<string, any>) {
        const message = props?.message;
        if (!settings.store.showBadge) return null;
        if (!message?.id || !activeTimers.has(message.id)) return null;
        return <TimerBadge messageId={message.id} />;
    },

    flux: {
        MESSAGE_CREATE({ message, optimistic, guildId }: { message: any; optimistic?: boolean; guildId?: string; }) {
            if (optimistic) return;
            if (!settings.store.active) return;
            if (!message?.id || !message?.channel_id) return;
            if (message.type != null && message.type !== 0 && message.type !== 19) return;
            if (activeTimers.has(message.id)) return;

            const currentUser = UserStore?.getCurrentUser?.();
            if (!currentUser || message.author?.id !== currentUser.id) return;

            const inGuild = !!(guildId ?? message.guild_id);
            const { scope } = settings.store;
            if (scope === "guilds" && !inGuild) return;
            if (scope === "dms" && inGuild) return;

            scheduleDelete(message.channel_id, message.id, getDelay() * 1000);
        },
    },

    start() {
        running = true;
        const { location } = settings.store;
        if (location === "headerbar") {
            addHeaderBarButton(BUTTON_ID, () => <HeaderButton />, 5);
        } else if (location === "channeltoolbar") {
            addChannelToolbarButton(BUTTON_ID, () => <ToolbarButton />, 5);
        }
        restorePending();
    },

    stop() {
        running = false;
        cleanup();
        removeHeaderBarButton(BUTTON_ID);
        removeChannelToolbarButton(BUTTON_ID);
    },
});