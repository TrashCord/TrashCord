/*
 * TrashCord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { addMessagePopoverButton, removeMessagePopoverButton } from "@api/MessagePopover";
import { ApplicationCommandInputType, sendBotMessage } from "@api/Commands";
import { ChatBarButton, ChatBarButtonFactory } from "@api/ChatButtons";
import { definePluginSettings } from "@api/Settings";
import { classNameFactory } from "@utils/css";
import definePlugin, { OptionType } from "@utils/types";
import { ChannelStore, Constants, FluxDispatcher, MessageStore, PermissionsBits, PermissionStore, React, RestAPI, showToast, UserStore, useEffect, useReducer, useState } from "@webpack/common";

import managedStyle from "./style.css?managed";

const cl = classNameFactory("vc-bmd-");

const settings = definePluginSettings({
    deleteDelay: {
        type: OptionType.SLIDER,
        description: "Extra minimum delay between deletions (ms). Rate limits are handled automatically from Discord's response headers, so 0 is fine.",
        default: 0,
        markers: [0, 50, 100, 250, 500, 1000],
    },
    showProgressBar: {
        type: OptionType.BOOLEAN,
        description: "Show progress bar while deleting",
        default: true,
    },
    confirmSelectAll: {
        type: OptionType.BOOLEAN,
        description: "Confirm before Select All",
        default: true,
    },
    confirmDelete: {
        type: OptionType.BOOLEAN,
        description: "Confirm before deleting",
        default: true,
    },
    allowOthers: {
        type: OptionType.BOOLEAN,
        description: "Allow selecting and deleting other users' messages when you have Manage Messages permission",
        default: true,
    },
});

const store = {
    active: false,
    background: false,
    channelId: null as string | null,
    selected: new Set<string>(),
    others: new Set<string>(),
    includeOthers: false,
    lastSelected: null as string | null,
    deleting: false,
    progress: 0,
    total: 0,
    cancelled: false,
};

let runId = 0;

const subs = new Set<() => void>();
const busy = () => store.deleting || store.background;

function notify() {
    if (sheetDirty) flushSheet();
    subs.forEach(fn => fn());
}

function useStore() {
    const [, bump] = useReducer((n: number) => n + 1, 0);
    useEffect(() => { subs.add(bump); return () => void subs.delete(bump); }, []);
    return store;
}

const LAYOUT_CSS = `[data-list-id="chat-messages"]{padding-bottom:64px;-webkit-user-select:none;user-select:none}`;
const OWN_CSS = `{background:rgba(255,0,0,.12)!important;box-shadow:inset 3px 0 0 #f00!important;border-radius:4px}`;
const OTHERS_CSS = `{background:rgba(250,166,26,.12)!important;box-shadow:inset 3px 0 0 #faa61a!important;border-radius:4px}`;

let sheet: CSSStyleSheet | null = null;
let sheetDirty = false;

const markDirty = () => { sheetDirty = true; };

function buildCss(): string {
    const ch = store.channelId;
    if (!store.active || !ch) return "";
    const prefix = `#chat-messages-${ch}-`;
    const own: string[] = [];
    const oth: string[] = [];
    for (const id of store.selected) (store.others.has(id) ? oth : own).push(prefix + id);
    let css = LAYOUT_CSS;
    if (own.length) css += own.join(",") + OWN_CSS;
    if (oth.length) css += oth.join(",") + OTHERS_CSS;
    return css;
}

function flushSheet() {
    sheetDirty = false;
    if (store.active) {
        if (!sheet) {
            sheet = new CSSStyleSheet();
            document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
        }
        sheet.replaceSync(buildCss());
    } else if (sheet) {
        const s = sheet;
        sheet = null;
        document.adoptedStyleSheets = document.adoptedStyleSheets.filter(x => x !== s);
    }
}

const myId = () => UserStore.getCurrentUser()?.id;
const isOwn = (msg: any) => msg?.author?.id === myId();
const isLoggerDeleted = (msg: any) => !!(msg?.deleted || msg?.messageLogger?.deleted);

function canManage(channelId: string) {
    const channel = ChannelStore.getChannel(channelId);
    return !!channel && PermissionStore.can(PermissionsBits.MANAGE_MESSAGES, channel);
}

const canSelect = (msg: any) =>
    !!msg && !isLoggerDeleted(msg) && (isOwn(msg) || (settings.store.allowOthers && canManage(msg.channel_id)));

function bulkPredicate(channelId: string) {
    const me = myId();
    const others = store.includeOthers && settings.store.allowOthers && canManage(channelId);
    return (m: any) => !!m?.id && !isLoggerDeleted(m) && (m.author?.id === me || others);
}

function getMsgs(channelId: string): any[] {
    try {
        const m = MessageStore.getMessages(channelId) as any;
        return m?._array ?? (m ? Object.values(m) : []);
    } catch { return []; }
}

function select(msg: any) {
    store.selected.add(msg.id);
    if (isOwn(msg)) store.others.delete(msg.id);
    else store.others.add(msg.id);
    markDirty();
}

function unselect(id: string) {
    store.selected.delete(id);
    store.others.delete(id);
    markDirty();
}

const IGNORE_SELECTOR = "a, button, [role=\"button\"], img, video, audio, input, textarea, [class*=\"reaction\"], [class*=\"embed\"], [class*=\"attachment\"], .vc-bmd-panel";
let listening = false;

function onDocumentClick(e: MouseEvent) {
    const ch = store.channelId;
    if (!store.active || !ch || busy()) return;
    const target = e.target as Element | null;
    if (!target || target.closest(IGNORE_SELECTOR)) return;
    const msgEl = target.closest("[id^=\"chat-messages-\"]");
    if (!msgEl) return;
    const prefix = `chat-messages-${ch}-`;
    if (!msgEl.id.startsWith(prefix)) return;
    const msgId = msgEl.id.slice(prefix.length);
    const msg = MessageStore.getMessage(ch, msgId);
    if (!canSelect(msg)) return;
    toggle(msgId, e.shiftKey, ch);
}

function attach() {
    if (listening) return;
    listening = true;
    document.addEventListener("click", onDocumentClick, true);
}

function detach() {
    if (!listening) return;
    listening = false;
    document.removeEventListener("click", onDocumentClick, true);
}

function activate(channelId?: string) {
    if (busy()) return;
    store.active = true;
    store.cancelled = false;
    store.includeOthers = false;
    store.lastSelected = null;
    store.channelId = channelId ?? store.channelId;
    store.selected.clear();
    store.others.clear();
    attach();
    markDirty();
    notify();
}

function deactivate() {
    detach();
    store.active = false;
    store.background = false;
    store.deleting = false;
    store.cancelled = false;
    store.includeOthers = false;
    store.lastSelected = null;
    store.progress = 0;
    store.total = 0;
    store.channelId = null;
    store.selected.clear();
    store.others.clear();
    markDirty();
    notify();
}

function toggle(id: string, shift: boolean, channelId: string) {
    if (busy()) return;
    if (shift && store.lastSelected) {
        const msgs = getMsgs(channelId);
        const a = msgs.findIndex((m: any) => m.id === store.lastSelected);
        const b = msgs.findIndex((m: any) => m.id === id);
        if (a !== -1 && b !== -1) {
            const ok = bulkPredicate(channelId);
            const [lo, hi] = a < b ? [a, b] : [b, a];
            for (let i = lo; i <= hi; i++) if (ok(msgs[i])) select(msgs[i]);
            store.lastSelected = id;
            notify();
            return;
        }
    }
    const msg = MessageStore.getMessage(channelId, id);
    if (!msg) return;
    if (store.selected.has(id)) unselect(id);
    else select(msg);
    store.lastSelected = id;
    notify();
}

function selectAll(channelId: string) {
    const ok = bulkPredicate(channelId);
    for (const m of getMsgs(channelId)) if (ok(m)) select(m);
    notify();
}

function deselectAll() {
    store.selected.clear();
    store.others.clear();
    store.lastSelected = null;
    markDirty();
    notify();
}

function selectByKeyword(channelId: string, kw: string) {
    const k = kw.toLowerCase().trim();
    if (!k) return;
    const ok = bulkPredicate(channelId);
    for (const m of getMsgs(channelId))
        if (ok(m) && (m.content ?? "").toLowerCase().includes(k)) select(m);
    notify();
}

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

async function deleteOne(channelId: string, id: string): Promise<{ ok: boolean; wait: number; }> {
    for (let i = 0; i < 4; i++) {
        try {
            const res: any = await RestAPI.del({ url: Constants.Endpoints.MESSAGE(channelId, id) });
            const h = res?.headers;
            const wait = h?.["x-ratelimit-remaining"] === "0"
                ? (Math.ceil(parseFloat(h["x-ratelimit-reset-after"] ?? "0") * 1000) || 0)
                : 0;
            return { ok: true, wait };
        } catch (e: any) {
            if (e?.status === 429)
                await sleep(((e?.body?.retry_after ?? 1) * 1000) + 100);
            else return { ok: e?.status === 404, wait: 0 };
        }
    }
    return { ok: false, wait: 0 };
}

async function runDelete(ids: string[], channelId: string) {
    if (store.deleting) return;
    const my = ++runId;
    store.deleting = true;
    store.cancelled = false;
    store.total = ids.length;
    store.progress = 0;
    notify();
    let deleted = 0, failed = 0;
    for (const id of ids) {
        if (store.cancelled || my !== runId) break;
        const r = await deleteOne(channelId, id);
        if (r.ok) deleted++; else failed++;
        store.progress++;
        notify();
        const wait = Math.max(r.wait, settings.store.deleteDelay);
        if (wait > 0 && !store.cancelled && my === runId) await sleep(wait);
    }
    if (my !== runId) return;
    const wasCancelled = store.cancelled;
    const wasBackground = store.background;
    deactivate();
    showToast({
        text: wasCancelled
            ? `Stopped - deleted ${deleted} before cancel`
            : `${wasBackground ? "Background: " : ""}Deleted ${deleted} message${deleted !== 1 ? "s" : ""}${failed ? ` · ${failed} failed` : ""}`,
        variant: wasCancelled ? "critical" : "success"
    });
}

function PopoverIconUnchecked() {
    return (
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none">
            <rect x="3" y="3" width="18" height="18" rx="3.5" stroke="currentColor" strokeWidth="2" />
        </svg>
    );
}

function PopoverIconChecked() {
    return (
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none">
            <rect x="3" y="3" width="18" height="18" rx="3.5" fill="var(--brand-500)" stroke="var(--brand-500)" strokeWidth="2" />
            <path d="M7 12l4 4 6-6" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
    );
}

type Step = "" | "selectAll" | "delete";

function Toolbar({ channelId }: { channelId: string; }) {
    const s = useStore();
    const [step, setStep] = useState<Step>("");
    const [kw, setKw] = useState("");
    const [filterOpen, setFilterOpen] = useState(false);
    if (!s.active) return null;

    const n = s.selected.size;
    const othersN = s.others.size;
    const showOthers = settings.store.allowOthers && canManage(channelId);

    if (s.deleting) {
        const pct = s.total > 0 ? Math.round((s.progress / s.total) * 100) : 0;
        return (
            <div className={cl("panel")}>
                <div className={cl("del-row")}>
                    <span className={cl("del-label")}>🗑 Deleting {s.progress}/{s.total}</span>
                    {settings.store.showProgressBar && (
                        <div className={cl("track")}>
                            <div className={cl("fill")} style={{ width: `${pct}%` }} />
                        </div>
                    )}
                    <span className={cl("pct")}>{pct}%</span>
                    <button className={cl("stop")} onClick={() => { store.cancelled = true; notify(); }}>■ Stop</button>
                </div>
            </div>
        );
    }

    const ok = bulkPredicate(channelId);
    let total = 0;
    for (const m of getMsgs(channelId)) if (ok(m)) total++;

    if (step === "selectAll") return (
        <div className={cl("panel") + " " + cl("confirm-panel")}>
            <span className={cl("warn-icon")}>⚠</span>
            <span className={cl("warn-text")}>
                Select ALL {total} visible messages{s.includeOthers ? " (including other users')" : ""}?
            </span>
            <button className={cl("btn-yes")} onClick={() => { selectAll(channelId); setStep(""); }}>Yes</button>
            <button className={cl("btn-no")} onClick={() => setStep("")}>Cancel</button>
        </div>
    );

    if (step === "delete") return (
        <div className={cl("panel") + " " + cl("confirm-panel")}>
            <span className={cl("warn-icon")}>⚠</span>
            <span className={cl("warn-text") + (othersN > 0 ? ` ${cl("warn-text-others")}` : "")}>
                Delete {n} message{n !== 1 ? "s" : ""}{othersN > 0 ? ` (${othersN} from other users)` : ""} permanently?
            </span>
            <button className={cl("btn-del-confirm")} onClick={() => { const ids = [...s.selected]; setStep(""); runDelete(ids, channelId); }}>Delete</button>
            <button className={cl("btn-no")} onClick={() => setStep("")}>Cancel</button>
        </div>
    );

    return (
        <div className={cl("panel")}>
            {filterOpen && (
                <div className={cl("filter-row")}>
                    <input
                        className={cl("filter-input")}
                        placeholder="Keyword - Enter to apply, Esc to close"
                        value={kw}
                        onChange={e => setKw(e.currentTarget.value)}
                        onKeyDown={e => {
                            if (e.key === "Enter") { selectByKeyword(channelId, kw); setFilterOpen(false); setKw(""); }
                            if (e.key === "Escape") { setFilterOpen(false); setKw(""); }
                        }}
                        autoFocus
                    />
                    <button className={cl("btn-apply")} onClick={() => { selectByKeyword(channelId, kw); setFilterOpen(false); setKw(""); }}>Apply</button>
                    <button className={cl("btn-close")} onClick={() => { setFilterOpen(false); setKw(""); }}>✕</button>
                </div>
            )}
            <div className={cl("row")}>
                <div className={cl("badge")}>
                    {n}<span className={cl("sep")}>/</span>{total}
                    {othersN > 0 && <span className={cl("others-count")}>👥{othersN}</span>}
                </div>
                <div className={cl("vline")} />
                <button className={cl("pill")} onClick={() => settings.store.confirmSelectAll ? setStep("selectAll") : selectAll(channelId)}>Select All</button>
                <button className={cl("pill")} disabled={n === 0} onClick={deselectAll}>Deselect All</button>
                <button className={cl("pill") + (filterOpen ? ` ${cl("pill-on")}` : "")} onClick={() => setFilterOpen(v => !v)}>🔍 Keyword</button>
                {showOthers && (
                    <button
                        className={cl("pill") + (s.includeOthers ? ` ${cl("pill-others")}` : "")}
                        title="ON: Select All, Keyword and Shift-range also select other users' messages (orange). OFF: only your own messages. You can always click a single message from someone else."
                        onClick={() => { store.includeOthers = !store.includeOthers; notify(); }}
                    >
                        👥 Include others: {s.includeOthers ? "ON" : "OFF"}
                    </button>
                )}
                <div className={cl("vline")} />
                <button className={cl("pill-del")} disabled={n === 0} onClick={() => settings.store.confirmDelete ? setStep("delete") : runDelete([...s.selected], channelId)}>
                    🗑 Delete{n > 0 ? ` (${n})` : ""}
                </button>
                <button className={cl("btn-exit")} onClick={deactivate} title="Exit">✕</button>
            </div>
        </div>
    );
}

function BulkDeleteIcon() {
    return (
        <svg viewBox="0 0 24 24" width="24" height="24" fill="none" aria-hidden>
            <rect x="3" y="3" width="13" height="13" rx="2.5" stroke="currentColor" strokeWidth="2" />
            <path d="m5.5 9.5 3 3 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            <line x1="20" y1="4" x2="10" y2="20" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
    );
}

function BackgroundStopButton({ progress, total }: { progress: number; total: number; }) {
    const [confirming, setConfirming] = useState(false);

    if (confirming) return (
        <div className={cl("bg-confirm")}>
            <span className={cl("bg-confirm-text")}>Stop deletion?</span>
            <button className={cl("btn-del-confirm")} onClick={() => { store.cancelled = true; notify(); setConfirming(false); }}>Stop</button>
            <button className={cl("btn-no")} onClick={() => setConfirming(false)}>No</button>
        </div>
    );

    return (
        <ChatBarButton
            tooltip={`Deleting in background… ${progress}/${total} - click to stop`}
            onClick={() => setConfirming(true)}
            buttonProps={{ "aria-label": "Stop background deletion" }}
        >
            <svg viewBox="0 0 24 24" width="24" height="24" fill="none" aria-hidden>
                <rect x="3" y="3" width="13" height="13" rx="2.5" stroke="var(--status-warning, #faa61a)" strokeWidth="2" />
                <path d="m5.5 9.5 3 3 5-5" stroke="var(--status-warning, #faa61a)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                <line x1="20" y1="4" x2="10" y2="20" stroke="var(--status-warning, #faa61a)" strokeWidth="2" strokeLinecap="round" />
            </svg>
        </ChatBarButton>
    );
}

const ChatBarRender: ChatBarButtonFactory = ({ isAnyChat, channel }) => {
    const s = useStore();
    if (!isAnyChat) return null;
    if (s.active && s.channelId === channel.id) return <Toolbar channelId={channel.id} />;
    if (s.background) return <BackgroundStopButton progress={s.progress} total={s.total} />;
    return (
        <ChatBarButton tooltip="Bulk Message Deleter" onClick={() => activate(channel.id)} buttonProps={{ "aria-label": "Activate bulk message deleter" }}>
            <BulkDeleteIcon />
        </ChatBarButton>
    );
};

function onChannelSelect({ channelId }: { channelId: string; }) {
    if (!store.active || !store.channelId || store.channelId === channelId) return;
    if (store.deleting) {
        store.active = false;
        store.background = true;
        detach();
        markDirty();
        notify();
    } else {
        deactivate();
    }
}

export default definePlugin({
    name: "BulkMessageDeleter",
    description: "Select and mass-delete your own messages, or other users' messages with Manage Messages permission. Click-to-select, hover button, keyword filter, and slash command.",
    authors: [{ name: "zfrancesck1", id: 456195985404592149n }],
    tags: ["Chat", "Utility"],
    enabledByDefault: true,
    dependencies: ["CommandsAPI", "MessagePopoverAPI"],
    settings,
    managedStyle,

    commands: [{
        name: "bulkdelete",
        description: "Activate bulk message deletion mode in this channel",
        inputType: ApplicationCommandInputType.BUILT_IN,
        execute(_, ctx) {
            if (busy()) return;
            activate(ctx.channel.id);
            sendBotMessage(ctx.channel.id, "**Bulk Delete** mode activated - click messages or use the ✓ button on hover to select.");
        },
    }],

    chatBarButton: { icon: BulkDeleteIcon, render: ChatBarRender },

    start() {
        addMessagePopoverButton("vc-bmd-select", msg => {
            if (busy() || !canSelect(msg)) return null;
            const checked = store.selected.has(msg.id);
            return {
                label: checked ? "Deselect" : "Select for bulk delete",
                icon: checked ? PopoverIconChecked : PopoverIconUnchecked,
                message: msg,
                channel: ChannelStore.getChannel(msg.channel_id),
                onClick: () => {
                    if (store.active && store.channelId !== msg.channel_id) deactivate();
                    if (!store.active) activate(msg.channel_id);
                    toggle(msg.id, false, msg.channel_id);
                },
            };
        });

        FluxDispatcher.subscribe("CHANNEL_SELECT", onChannelSelect);
    },

    stop() {
        runId++;
        removeMessagePopoverButton("vc-bmd-select");
        FluxDispatcher.unsubscribe("CHANNEL_SELECT", onChannelSelect);
        deactivate();
    },
});