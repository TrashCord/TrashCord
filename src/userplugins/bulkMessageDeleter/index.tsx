import { addContextMenuPatch, findGroupChildrenByChildId, NavContextMenuPatchCallback, removeContextMenuPatch } from "@api/ContextMenu";
import { addMessagePopoverButton, removeMessagePopoverButton } from "@api/MessagePopover";
import { ApplicationCommandInputType, sendBotMessage } from "@api/Commands";
import { ChatBarButton, ChatBarButtonFactory } from "@api/ChatButtons";
import { definePluginSettings } from "@api/Settings";
import { classNameFactory } from "@utils/css";
import definePlugin, { OptionType } from "@utils/types";
import { ChannelStore, Constants, FluxDispatcher, Menu, MessageStore, PermissionsBits, PermissionStore, React, RestAPI, showToast, UserStore, useEffect, useReducer, useState } from "@webpack/common";

import managedStyle from "./style.css?managed";

const cl = classNameFactory("vc-bmd-");

const settings = definePluginSettings({
    deleteDelay: {
        type: OptionType.SLIDER,
        description: "Base delay between deletions (ms) - auto-retries on rate limits",
        default: 429,
        markers: [0, 1, 50, 100, 200, 350, 429, 500, 750, 1000],
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

const subs = new Set<() => void>();
const notify = () => subs.forEach(fn => fn());
const busy = () => store.deleting || store.background;

function useStore() {
    const [, bump] = useReducer((n: number) => n + 1, 0);
    useEffect(() => { subs.add(bump); return () => void subs.delete(bump); }, []);
    return store;
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

const canBulk = (msg: any) =>
    !!msg && !isLoggerDeleted(msg) && (isOwn(msg) || (store.includeOthers && settings.store.allowOthers && canManage(msg.channel_id)));

function getMsgs(channelId: string): any[] {
    try {
        const m = MessageStore.getMessages(channelId) as any;
        return m?._array ?? (m ? Object.values(m) : []);
    } catch { return []; }
}

function paint(channelId: string, id: string, value: string | null) {
    const el = document.getElementById(`chat-messages-${channelId}-${id}`);
    if (!el) return;
    if (value) el.setAttribute("data-bmd-sel", value);
    else el.removeAttribute("data-bmd-sel");
}

function clearAllDomSel() {
    if (!store.channelId) return;
    for (const id of store.selected) paint(store.channelId, id, null);
}

function select(channelId: string, msg: any) {
    const mine = isOwn(msg);
    store.selected.add(msg.id);
    if (mine) store.others.delete(msg.id);
    else store.others.add(msg.id);
    paint(channelId, msg.id, mine ? "1" : "2");
}

function unselect(channelId: string, id: string) {
    store.selected.delete(id);
    store.others.delete(id);
    paint(channelId, id, null);
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
    document.documentElement.setAttribute("data-bmd-active", "1");
    notify();
}

function deactivate() {
    clearAllDomSel();
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
    document.documentElement.removeAttribute("data-bmd-active");
    notify();
}

function toggle(id: string, shift: boolean, channelId: string) {
    if (busy()) return;
    if (shift && store.lastSelected) {
        const msgs = getMsgs(channelId);
        const a = msgs.findIndex((m: any) => m.id === store.lastSelected);
        const b = msgs.findIndex((m: any) => m.id === id);
        if (a !== -1 && b !== -1) {
            const [lo, hi] = a < b ? [a, b] : [b, a];
            for (let i = lo; i <= hi; i++) if (canBulk(msgs[i])) select(channelId, msgs[i]);
            store.lastSelected = id;
            notify();
            return;
        }
    }
    const msg = MessageStore.getMessage(channelId, id);
    if (!msg) return;
    if (store.selected.has(id)) unselect(channelId, id);
    else select(channelId, msg);
    store.lastSelected = id;
    notify();
}

function selectAll(channelId: string) {
    for (const m of getMsgs(channelId)) if (m?.id && canBulk(m)) select(channelId, m);
    notify();
}

function deselectAll() {
    clearAllDomSel();
    store.selected.clear();
    store.others.clear();
    store.lastSelected = null;
    notify();
}

function selectByKeyword(channelId: string, kw: string) {
    const k = kw.toLowerCase().trim();
    if (!k) return;
    for (const m of getMsgs(channelId))
        if (m?.id && canBulk(m) && (m.content ?? "").toLowerCase().includes(k)) select(channelId, m);
    notify();
}

function onDocumentClick(e: MouseEvent) {
    if (!store.active || !store.channelId || busy()) return;
    const target = e.target as Element;
    if (target.closest("a, button, [role=\"button\"], img, video, audio, input, textarea, [class*=\"reaction\"], [class*=\"embed\"], [class*=\"attachment\"], .vc-bmd-cb, .vc-bmd-panel")) return;
    const msgEl = target.closest("[id^=\"chat-messages-\"]") as HTMLElement | null;
    if (!msgEl) return;
    const match = msgEl.id.match(/^chat-messages-\d+-(\d+)$/);
    if (!match) return;
    const msgId = match[1];
    const msg = MessageStore.getMessage(store.channelId, msgId);
    if (!canSelect(msg)) return;
    toggle(msgId, e.shiftKey, store.channelId);
}

async function deleteOne(channelId: string, id: string): Promise<boolean> {
    for (let i = 0; i < 4; i++) {
        try {
            await RestAPI.del({ url: Constants.Endpoints.MESSAGE(channelId, id) });
            return true;
        } catch (e: any) {
            if (e?.status === 429)
                await new Promise<void>(r => setTimeout(r, ((e?.body?.retry_after ?? 1) * 1000) + 200));
            else return false;
        }
    }
    return false;
}

async function runDelete(ids: string[], channelId: string) {
    if (store.deleting) return;
    store.deleting = true;
    store.cancelled = false;
    store.total = ids.length;
    store.progress = 0;
    notify();
    let deleted = 0, failed = 0;
    for (const id of ids) {
        if (store.cancelled) break;
        (await deleteOne(channelId, id)) ? deleted++ : failed++;
        store.progress++;
        notify();
        if (!store.cancelled) await new Promise<void>(r => setTimeout(r, settings.store.deleteDelay));
    }
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
    useEffect(() => { if (!s.active) { setStep(""); setFilterOpen(false); setKw(""); } }, [s.active]);
    if (!s.active) return null;

    const n = s.selected.size;
    const othersN = s.others.size;
    const total = s.deleting ? 0 : getMsgs(channelId).filter(canBulk).length;
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

const textareaCtxPatch: NavContextMenuPatchCallback = (children, props) => {
    const channelId = props?.channel?.id;
    if (!channelId || busy()) return;
    children.push(
        <Menu.MenuSeparator />,
        <Menu.MenuItem
            id="vc-bmd-textarea-activate"
            label="📋 Bulk Delete Messages"
            action={() => activate(channelId)}
        />
    );
};

const messageCtxPatch: NavContextMenuPatchCallback = (children, props) => {
    const msg = props?.message;
    if (!msg || busy() || !canSelect(msg)) return;
    const checked = store.active && store.selected.has(msg.id);
    const item = (
        <Menu.MenuItem
            id="vc-bmd-message-select"
            label={checked ? "Deselect from bulk delete" : "Select for bulk delete"}
            icon={BulkDeleteIcon}
            action={() => {
                if (!store.active) activate(msg.channel_id);
                toggle(msg.id, false, msg.channel_id);
            }}
        />
    );
    const group = findGroupChildrenByChildId("message-delete", children) ?? children;
    const idx = group.findIndex((c: any) => c?.props?.id === "message-delete");
    group.splice(idx === -1 ? group.length : idx, 0, item);
};

function onChannelSelect({ channelId }: { channelId: string; }) {
    if (!store.active || !store.channelId || store.channelId === channelId) return;
    if (store.deleting) {
        clearAllDomSel();
        store.active = false;
        store.background = true;
        document.documentElement.removeAttribute("data-bmd-active");
        notify();
    } else {
        deactivate();
    }
}

export default definePlugin({
    name: "BulkMessageDeleter",
    description: "Select and mass-delete your own messages, or other users' messages with Manage Messages permission. Click-to-select, hover button, keyword filter, slash command, and context menus.",
    authors: [{ name: "zfrancesck1", id: 456195985404592149n }],
    tags: ["Chat", "Utility"],
    enabledByDefault: true,
    dependencies: ["CommandsAPI", "MessagePopoverAPI", "ContextMenuAPI"],
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
                    if (!store.active) activate(msg.channel_id);
                    toggle(msg.id, false, msg.channel_id);
                },
            };
        });

        addContextMenuPatch("textarea-context", textareaCtxPatch);
        addContextMenuPatch("message", messageCtxPatch);
        FluxDispatcher.subscribe("CHANNEL_SELECT", onChannelSelect);
        document.addEventListener("click", onDocumentClick, true);
    },

    stop() {
        removeMessagePopoverButton("vc-bmd-select");
        removeContextMenuPatch("textarea-context", textareaCtxPatch);
        removeContextMenuPatch("message", messageCtxPatch);
        FluxDispatcher.unsubscribe("CHANNEL_SELECT", onChannelSelect);
        document.removeEventListener("click", onDocumentClick, true);
        deactivate();
    },
});