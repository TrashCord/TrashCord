/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// index.tsx -- plugin entry. Wires settings, injects a toolbar button between
// "Pinned Messages" and the next native button (Hide Member List in servers,
// Add Friends in DMs), and renders the BetterSearch panel below it on demand.

import managedStyle from "./style.css?managed";

import { definePluginSettings } from "@api/Settings";
import { Logger } from "@utils/Logger";
import definePlugin, { OptionType } from "@utils/types";
import {
    ChannelStore,
    createRoot,
    React,
    SelectedChannelStore,
    SelectedGuildStore,
} from "@webpack/common";

import { BetterSearchPanel } from "./components";
import {
    abortActiveSession,
    configureSearch,
    prepareQuery,
    Session,
    startChannelWalkSession,
    startHintedSession,
} from "./search";

const logger = new Logger("BetterSearch", "#7b9cff");

// ── Settings ─────────────────────────────────────────────────────────────────

const settings = definePluginSettings({
    minRequestIntervalMs: {
        type: OptionType.NUMBER,
        description: "Minimum ms between BetterSearch HTTP requests (clamped 800-5000).",
        default: 1100,
    },
    maxPages: {
        type: OptionType.NUMBER,
        description: "Hard cap on pages fetched per session (clamped 1-40).",
        default: 25,
    },
    maxMessagesScanned: {
        type: OptionType.NUMBER,
        description: "Hard cap on messages scanned per session (clamped 100-5000).",
        default: 2500,
    },
    showPartialBanner: {
        type: OptionType.BOOLEAN,
        description: "Show a banner when results are partial (cap reached).",
        default: true,
    },
    debugLogs: {
        type: OptionType.BOOLEAN,
        description: "Print verbose logs to the console.",
        default: false,
    },
});

function clamp(n: unknown, lo: number, hi: number, fallback: number): number {
    const v = typeof n === "number" && Number.isFinite(n) ? n : fallback;
    return Math.min(hi, Math.max(lo, v));
}

function clampInt(n: unknown, lo: number, hi: number, fallback: number): number {
    return Math.round(clamp(n, lo, hi, fallback));
}

function readSettings() {
    const s = settings.store;
    return {
        minRequestIntervalMs: clampInt(s.minRequestIntervalMs, 800, 5000, 1100),
        maxPages: clampInt(s.maxPages, 1, 40, 25),
        maxMessagesScanned: clampInt(s.maxMessagesScanned, 100, 5000, 2500),
        showPartialBanner: s.showPartialBanner !== false,
        debugLogs: s.debugLogs === true,
    };
}

// ── Toolbar button + panel state ─────────────────────────────────────────────

const PANEL_NODE_CLASS = "vc-bettersearch-mount";
const TOOLBAR_BTN_CLASS = "vc-bettersearch-toolbar-btn";
// Stable data attribute on the button so we can detect (and avoid duplicating)
// the button across React re-renders of the toolbar.
const TOOLBAR_BTN_MARKER = "data-vc-bettersearch-btn";

let toolbarObserver: MutationObserver | null = null;
let panelNode: HTMLDivElement | null = null;
let panelRoot: ReturnType<typeof createRoot> | null = null;
let currentSession: Session | null = null;
let currentNeedle = "";
let draftQuery = "";
let panelOpen = false;
let panelCollapsed = false;
let liveScanLimit = 2500;
let lastScanParams: LastScanParams | null = null;

interface LastScanParams {
    kind: "hinted" | "channel-walk";
    target: { kind: "guild" | "channel"; id: string; } | null;
    channelId: string | null;
    query: ReturnType<typeof prepareQuery>;
}

// ── Panel mount/unmount ──────────────────────────────────────────────────────

function ensurePanelMounted() {
    if (panelNode?.isConnected && panelRoot) return;
    teardownPanel();
    panelNode = document.createElement("div");
    panelNode.className = PANEL_NODE_CLASS;
    document.body.appendChild(panelNode);
    panelRoot = createRoot(panelNode);
    rerender();
}

function teardownPanel() {
    try {
        if (panelRoot) {
            const root = panelRoot;
            queueMicrotask(() => { try { root.unmount(); } catch { /* */ } });
        }
    } finally {
        panelRoot = null;
        try { panelNode?.remove(); } catch { /* */ }
        panelNode = null;
    }
}

function currentChannelLabel(): string {
    try {
        const id = SelectedChannelStore?.getChannelId?.();
        if (!id) return "this channel";
        const ch: any = ChannelStore?.getChannel?.(id);
        if (!ch) return "this channel";
        if (ch.name) return `#${ch.name}`;
        if (ch.type === 1) return "this DM";
        if (ch.type === 3) return "this group";
        return "this channel";
    } catch {
        return "this channel";
    }
}

function currentScopeLabel(): string {
    try {
        if (prepareQuery(draftQuery).nativeHint && SelectedGuildStore?.getGuildId?.()) {
            return "this server";
        }
    } catch { /* fall back to the selected channel */ }
    return currentChannelLabel();
}

function rerender() {
    if (!panelRoot) return;
    if (!panelOpen) {
        panelRoot.render(<></>);
        return;
    }
    const cfg = readSettings();
    panelRoot.render(
        <BetterSearchPanel
            session={currentSession}
            needle={currentNeedle}
            showPartialBanner={cfg.showPartialBanner}
            draftQuery={draftQuery}
            onDraftChange={handleDraftChange}
            onRunSearch={handleRunSearch}
            currentChannelLabel={currentScopeLabel()}
            scanLimit={liveScanLimit}
            onScanLimitChange={handleScanLimitChange}
            onAbort={handleAbort}
            onDismiss={handleDismiss}
            canRescan={lastScanParams !== null}
            onRescan={handleRescan}
            collapsed={panelCollapsed}
            onToggleCollapse={handleToggleCollapse}
        />
    );
}

function handleDraftChange(q: string) {
    draftQuery = q;
    rerender();
}

function handleRunSearch() {
    const q = draftQuery.trim();
    if (!q) return;
    const channelId = SelectedChannelStore?.getChannelId?.();
    if (!channelId) {
        logger.warn("no channel selected; aborting");
        return;
    }
    const prep = prepareQuery(q);
    if (!prep.exactNeedle) {
        logger.warn("empty exact query; aborting");
        return;
    }
    currentNeedle = prep.exactNeedle || q;

    abortActiveSession();

    // If Discord's native search will accept the query (has a useful keyword
    // hint), prefer the hinted path -- it's much faster than walking the
    // channel page-by-page. Fall back to channel-walk for symbol-only queries.
    if (prep.nativeHint) {
        const guildId = SelectedGuildStore?.getGuildId?.();
        const target: { kind: "guild" | "channel"; id: string; } = guildId
            ? { kind: "guild", id: guildId }
            : { kind: "channel", id: channelId };
        currentSession = startHintedSession(target, prep, liveScanLimit);
        lastScanParams = { kind: "hinted", target, channelId: null, query: prep };
    } else {
        currentSession = startChannelWalkSession(channelId, prep, liveScanLimit);
        lastScanParams = { kind: "channel-walk", target: null, channelId, query: prep };
    }
    rerender();
}

function handleScanLimitChange(n: number) {
    const clamped = Math.min(5000, Math.max(100, Math.round(n)));
    liveScanLimit = clamped;
    currentSession?.setScanLimit(clamped);
    rerender();
}

function handleAbort() {
    abortActiveSession();
    rerender();
}

function handleDismiss() {
    abortActiveSession();
    currentSession = null;
    lastScanParams = null;
    currentNeedle = "";
    draftQuery = "";
    panelOpen = false;
    rerender();
    syncToolbarButtons();
    queueMicrotask(() => {
        document.querySelector<HTMLButtonElement>(`[${TOOLBAR_BTN_MARKER}="1"]`)?.focus();
    });
}

function handleRescan() {
    if (!lastScanParams) return;
    const params = lastScanParams;
    abortActiveSession();
    if (params.kind === "hinted" && params.target) {
        currentSession = startHintedSession(params.target, params.query, liveScanLimit);
    } else if (params.kind === "channel-walk" && params.channelId) {
        currentSession = startChannelWalkSession(params.channelId, params.query, liveScanLimit);
    }
    rerender();
}

function handleToggleCollapse() {
    panelCollapsed = !panelCollapsed;
    rerender();
}

function togglePanel() {
    panelOpen = !panelOpen;
    if (panelOpen) {
        panelCollapsed = false;
        ensurePanelMounted();
    }
    rerender();
    syncToolbarButtons();
}

// ── Toolbar button injection ─────────────────────────────────────────────────

// Discord's title-bar toolbar lives at the top of the channel pane and contains
// fixed buttons: thread browser, notifications, pinned messages, then per-channel
// extras (member list / add friends / etc.). We anchor to the Pinned Messages
// button (stable aria-label across builds for years) and inject ours immediately
// after it so it always appears in the same slot.

function buildToolbarButton(): HTMLButtonElement {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.setAttribute(TOOLBAR_BTN_MARKER, "1");
    btn.setAttribute("aria-label", "BetterSearch");
    btn.setAttribute("aria-expanded", String(panelOpen));
    btn.setAttribute("aria-controls", "vc-bettersearch-panel");
    btn.setAttribute("title", "BetterSearch (exact-match channel search)");
    btn.className = TOOLBAR_BTN_CLASS;

    // Filled magnifying glass matching Discord's toolbar icon style:
    // 24x24 viewBox, currentColor fill, no stroke, single path. Same visual
    // weight as the phone/video/pin/add-person icons next to it.
    btn.innerHTML =
        '<svg aria-hidden="true" role="img" width="20" height="20" viewBox="0 0 24 24" fill="none">' +
        '<path fill="currentColor" fill-rule="evenodd" clip-rule="evenodd" ' +
        'd="M15.62 17.03a9 9 0 1 1 1.41-1.41l4.68 4.67a1 1 0 0 1-1.42 1.42l-4.67-4.68ZM17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0Z"/>' +
        "</svg>";

    btn.addEventListener("click", e => {
        e.preventDefault();
        e.stopPropagation();
        togglePanel();
    });
    return btn;
}

function syncToolbarButtons() {
    document.querySelectorAll<HTMLElement>(`[${TOOLBAR_BTN_MARKER}="1"]`).forEach(btn => {
        btn.setAttribute("aria-expanded", String(panelOpen));
    });
}

function injectToolbarButton() {
    // Find every visible Pinned Messages button (Discord may have more than one
    // mounted during transitions) and ensure each has our sibling.
    const pinBtns = document.querySelectorAll<HTMLElement>('[aria-label="Pinned Messages" i]');
    pinBtns.forEach(pin => {
        if (!pin.parentElement) return;
        // Already injected in this toolbar? Skip.
        const next = pin.nextElementSibling as HTMLElement | null;
        if (next?.getAttribute?.(TOOLBAR_BTN_MARKER) === "1") return;
        // Some toolbars wrap each icon in a container <div>; if Pinned is wrapped,
        // we want to match the wrapper structure. Walk up if the parent is also
        // a single-child icon wrapper that the toolbar treats as one cell.
        let anchor: HTMLElement = pin;
        const parent = pin.parentElement;
        const grand = parent?.parentElement;
        if (parent && grand
            && parent.children.length === 1
            && grand.getAttribute("role") !== "tablist") {
            anchor = parent;
        }
        // Idempotent re-check for the wrapped case.
        const wrapNext = anchor.nextElementSibling as HTMLElement | null;
        if (wrapNext?.getAttribute?.(TOOLBAR_BTN_MARKER) === "1"
            || wrapNext?.querySelector?.(`[${TOOLBAR_BTN_MARKER}="1"]`)) return;
        try {
            const btn = buildToolbarButton();
            anchor.parentElement?.insertBefore(btn, anchor.nextSibling);
        } catch (e) {
            logger.warn("inject failed", e);
        }
    });
}

function startToolbarObserver() {
    if (toolbarObserver) return;
    toolbarObserver = new MutationObserver(() => {
        // Cheap: only walks document for the aria-label query, skips on every
        // mutation but coalesces via rAF so we don't run during every keystroke.
        if (scheduledInject) return;
        scheduledInject = requestAnimationFrame(() => {
            scheduledInject = 0;
            try { injectToolbarButton(); } catch (e) { logger.warn(e); }
        });
    });
    toolbarObserver.observe(document.body, { childList: true, subtree: true });
    injectToolbarButton();
}

let scheduledInject = 0;

function stopToolbarObserver() {
    if (scheduledInject) cancelAnimationFrame(scheduledInject);
    scheduledInject = 0;
    toolbarObserver?.disconnect();
    toolbarObserver = null;
    document.querySelectorAll(`.${TOOLBAR_BTN_CLASS}`).forEach(el => el.remove());
    teardownPanel();
}

// ── Self-check ───────────────────────────────────────────────────────────────

function selfCheck(): boolean {
    const checks: Array<[string, unknown]> = [
        ["ChannelStore", ChannelStore],
        ["SelectedChannelStore", SelectedChannelStore],
        ["SelectedGuildStore", SelectedGuildStore],
        ["createRoot", createRoot],
        ["React", React],
    ];
    for (const [name, val] of checks) {
        if (!val) {
            logger.warn(`webpack module not found: ${name}; BetterSearch disabled this session`);
            return false;
        }
    }
    return true;
}

export default definePlugin({
    name: "BetterSearch",
    description: 
        "Adds a toolbar button (between Pinned Messages and the next icon) " +
        "that opens a panel for exact-substring message search. Find messages " +
        "containing symbols (@, #, ., :, etc.) that the native search " +
        "tokenizer strips. Read-only, rate-limited, no extra auth headers.",
    authors: [
        { name: "saintordevil", id: 0n },
    ],
    tags: ["Chat", "Utility"],
    enabledByDefault: false,
    managedStyle,
    settings,
    start() {
        try {
            configureSearch(() => {
                const c = readSettings();
                return {
                    minRequestIntervalMs: c.minRequestIntervalMs,
                    maxPages: c.maxPages,
                    maxMessagesScanned: c.maxMessagesScanned,
                    debugLogs: c.debugLogs,
                };
            });

            if (!selfCheck()) return;

            liveScanLimit = readSettings().maxMessagesScanned;

            startToolbarObserver();
            logger.info("started");
        } catch (e) {
            logger.error("start failed", e);
        }
    },

    stop() {
        try {
            abortActiveSession();
            currentSession = null;
            lastScanParams = null;
            currentNeedle = "";
            draftQuery = "";
            panelOpen = false;
            panelCollapsed = false;
            stopToolbarObserver();
            logger.info("stopped");
        } catch (e) {
            logger.warn("stop had errors", e);
        }
    },
});
