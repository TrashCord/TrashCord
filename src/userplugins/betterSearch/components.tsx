/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// components.tsx -- React UI only. No network. No webpack searches beyond
// resolved stores passed in from index.tsx via React context-free getters.

import { copyWithToast } from "@utils/discord";
import { ChannelStore, MessageActions, useEffect, useRef, UserStore, useState } from "@webpack/common";

import { ScanningOrb } from "./orb";
import {
    BETTERSEARCH_MAX_MATCHES,
    includesNeedle,
    normalizeForSearch,
    prepareQuery,
    RawMessage,
    Session,
    SessionStatus,
} from "./search";

// Note: do NOT call React.memo / React.createElement at module-load time.
// `React` from @webpack/common is a lazy webpack reference and is `undefined`
// until Vencord's WebpackPatcher initialises. Touching it at top level crashes
// the entire Vencord bundle ("Cannot read properties of undefined (reading
// 'memo')") and prevents the Vencord menu from appearing in Discord settings.
// JSX is fine because esbuild's automatic runtime resolves it lazily.

// ── Channel label ─────────────────────────────────────────────────────────────

/** Resolve a channel_id to a human-readable label. Guild channels show "#name",
 * DMs show "@<other user>", group DMs list the first few recipients. Falls
 * back to "unknown channel" only when ChannelStore has nothing cached. Safe to
 * call during render (lazy webpack refs resolved by then). */
function resolveChannelLabel(channelId: string | undefined): string {
    if (!channelId) return "unknown channel";
    try {
        const channel: any = ChannelStore?.getChannel?.(channelId);
        if (!channel) return "unknown channel";

        // Guild text / voice / thread / forum: have a human name.
        if (channel.name) return `#${channel.name}`;

        const toUserId = (r: any): string | null => {
            if (typeof r === "string") return r;
            if (r && typeof r === "object" && typeof r.id === "string") return r.id;
            return null;
        };

        // DM (type 1): show the other party.
        if (channel.type === 1) {
            const recipients: any[] = channel.recipients ?? channel.rawRecipients ?? [];
            const otherId = toUserId(recipients[0]);
            if (otherId) {
                const other = UserStore?.getUser?.(otherId);
                const name = other?.globalName || other?.username;
                if (name) return `@${name}`;
            }
            return "DM";
        }

        // Group DM (type 3): custom name if set (handled above), else list.
        if (channel.type === 3) {
            const recipients: any[] = channel.recipients ?? channel.rawRecipients ?? [];
            const ids = recipients.map(toUserId).filter((x): x is string => !!x);
            const names = ids
                .slice(0, 3)
                .map(id => {
                    const u = UserStore?.getUser?.(id);
                    return u?.globalName || u?.username;
                })
                .filter(Boolean);
            if (names.length > 0) {
                const suffix = ids.length > 3 ? ` +${ids.length - 3}` : "";
                return `Group: ${names.join(", ")}${suffix}`;
            }
            return "Group DM";
        }

        return "unknown channel";
    } catch {
        return "unknown channel";
    }
}

// ── Highlight ─────────────────────────────────────────────────────────────────

/** Split text around a (case-insensitive, NFKC) needle, returning React nodes. */
function highlight(text: string, needle: string): React.ReactNode[] {
    if (!text) return [];
    if (!needle) return [text];

    // We need to find positions in the original (un-normalized) text. Walk the
    // string char-by-char, tracking normalized index alignment in a simple way:
    // build a normalized version, find indices there, then map back assuming
    // that NFKC.toLowerCase() is one-to-one for the characters Discord users
    // typically search (this holds for ASCII + most Latin/CJK).
    const norm = normalizeForSearch(text);
    const out: React.ReactNode[] = [];

    // Some Unicode compatibility forms expand or contract under NFKC. The
    // match is still valid, but normalized offsets cannot safely slice the
    // original string in those cases, so leave the text unmarked.
    if (norm.length !== text.length
        || [...text].some(char => normalizeForSearch(char).length !== char.length)) {
        return [text];
    }

    let cursor = 0;
    let key = 0;
    while (cursor < norm.length) {
        const idx = norm.indexOf(needle, cursor);
        if (idx === -1) {
            out.push(text.slice(cursor));
            break;
        }
        if (idx > cursor) out.push(text.slice(cursor, idx));
        out.push(
            <mark key={`m${key++}`} className="vc-bettersearch-mark">
                {text.slice(idx, idx + needle.length)}
            </mark>
        );
        cursor = idx + needle.length;
    }
    return out;
}

// ── Status strip ──────────────────────────────────────────────────────────────

interface StatusStripProps {
    status: SessionStatus;
    needle: string;
}

function fmtSecondsLeft(untilMs: number): number {
    return Math.max(0, Math.ceil((untilMs - Date.now()) / 1000));
}

function StatusStrip({ status, needle }: StatusStripProps) {
    // Force re-render once a second while rate-limited so the countdown ticks.
    const [, force] = useState(0);
    useEffect(() => {
        if (status.phase !== "rate-limited") return;
        const id = setInterval(() => force(n => n + 1), 1000);
        return () => clearInterval(id);
    }, [status.phase]);

    if (status.phase === "idle") return null;

    let body: React.ReactNode;
    let cls = "vc-bettersearch-status";
    let showOrb = false;
    switch (status.phase) {
        case "scanning":
            body = `Scanning... ${status.scanned} / ${status.target} messages`;
            showOrb = true;
            break;
        case "rate-limited":
            body = `Paused for ${fmtSecondsLeft(status.pausedUntil)}s (Discord rate limit)`;
            cls += " vc-bettersearch-status-warn";
            showOrb = true;
            break;
        case "capped": {
            const m = status.matches.length;
            const { scanned, target } = status;
            switch (status.cappedReason) {
                case "matches":
                    body = `Stopped at ${m} matches (hit the display cap of ${BETTERSEARCH_MAX_MATCHES}, not the scan limit). Scanned ${scanned} / ${target} messages. Refine your query for more.`;
                    break;
                case "scan-limit":
                    body = `Hit scan limit of ${target} messages. Found ${m} match${m === 1 ? "" : "es"} so far. Raise "Scan up to" above to look further back.`;
                    break;
                case "wall-time":
                    body = `Scan timed out after 60s. Found ${m} match${m === 1 ? "" : "es"} in ${scanned} / ${target} messages scanned. Try a narrower query or a smaller scan limit.`;
                    break;
                case "page-budget":
                    body = `Stopped: page budget exhausted. Found ${m} match${m === 1 ? "" : "es"} in ${scanned} / ${target} messages. Raise maxPages in settings or narrow the query.`;
                    break;
                default:
                    body = `Showing first ${m} matches for "${needle}". Refine your query for more.`;
            }
            cls += " vc-bettersearch-status-info";
            break;
        }
        case "error":
            body = `BetterSearch failed: ${status.errorMsg ?? "unknown"}. See console.`;
            cls += " vc-bettersearch-status-error";
            break;
        case "done":
            if (status.matches.length === 0) {
                body = `No exact matches for "${needle}".`;
                cls += " vc-bettersearch-status-info";
            } else {
                body = `Found ${status.matches.length} exact match${status.matches.length === 1 ? "" : "es"}.`;
                cls += " vc-bettersearch-status-info";
            }
            break;
        case "aborted":
            return null;
    }
    return (
        <div
            className={cls}
            role={status.phase === "error" ? "alert" : "status"}
            aria-live={status.phase === "error" ? "assertive" : "polite"}
            aria-atomic="true"
        >
            {showOrb && <ScanningOrb size={14} />}
            <span className="vc-bettersearch-status-body">{body}</span>
        </div>
    );
}

// ── Result row ────────────────────────────────────────────────────────────────

interface RowProps {
    message: RawMessage;
    needle: string;
}

function Row({ message, needle }: RowProps) {
    try {
        const user = message.author?.id ? UserStore?.getUser?.(message.author.id) : null;
        const displayName: string =
            user?.globalName ||
            user?.username ||
            message.author?.global_name ||
            message.author?.username ||
            "Unknown";
        const channelLabel = resolveChannelLabel(message.channel_id);

        const ts = message.timestamp ? new Date(message.timestamp) : null;
        const tsLabel = ts && !isNaN(ts.getTime()) ? ts.toLocaleString() : "";

        // Build the snippet: prefer content; if empty but matched in embed/file,
        // surface the matching field instead so the user understands why it hit.
        const content = message.content ?? "";
        let snippet: React.ReactNode;
        if (content && includesNeedle(content, needle)) {
            snippet = highlight(content, needle);
        } else {
            const embedHit = (message.embeds ?? []).find(e =>
                includesNeedle(e.title, needle) || includesNeedle(e.description, needle)
            );
            if (embedHit) {
                const text = embedHit.description || embedHit.title || "";
                snippet = <em>(embed) {highlight(text, needle)}</em>;
            } else {
                const att = (message.attachments ?? []).find(a => includesNeedle(a.filename, needle));
                if (att?.filename) {
                    snippet = <em>(attachment) {highlight(att.filename, needle)}</em>;
                } else {
                    snippet = content || <em>(no text)</em>;
                }
            }
        }

        const onClick = () => {
            try {
                MessageActions?.jumpToMessage?.({
                    channelId: message.channel_id,
                    messageId: message.id,
                    flash: true,
                    jumpType: "INSTANT",
                });
            } catch (e) {
                console.warn("[BetterSearch] jumpToMessage failed", e);
            }
        };

        return (
            <div
                className="vc-bettersearch-row"
                role="button"
                tabIndex={0}
                onClick={onClick}
                onKeyDown={e => {
                    if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        onClick();
                    }
                }}
                aria-label={`Jump to message from ${displayName} in ${channelLabel}`}
            >
                <div className="vc-bettersearch-row-meta">
                    <span className="vc-bettersearch-row-author">{displayName}</span>
                    <span className="vc-bettersearch-row-channel">{channelLabel}</span>
                    {tsLabel && <span className="vc-bettersearch-row-ts">{tsLabel}</span>}
                </div>
                <div className="vc-bettersearch-row-content">{snippet}</div>
            </div>
        );
    } catch (e) {
        console.debug("[BetterSearch] row render failed", e);
        return null;
    }
}

// ── Search box ────────────────────────────────────────────────────────────────

// Self-contained query input + scan limit + Search/Stop button. Replaces the
// old "watch Discord's native search bar" flow: the user now types a query
// here and presses Search (or Enter) to kick off a channel-scoped scan of the
// currently-selected channel.
interface SearchBoxProps {
    draftQuery: string;
    onDraftChange: (q: string) => void;
    onRunSearch: () => void;
    scanLimit: number;
    onScanLimitChange: (n: number) => void;
    phase: string | null;
    onAbort: () => void;
    currentChannelLabel: string;
}

function SearchBox({
    draftQuery, onDraftChange, onRunSearch,
    scanLimit, onScanLimitChange,
    phase, onAbort,
    currentChannelLabel,
}: SearchBoxProps) {
    const [limitVal, setLimitVal] = useState(String(scanLimit));
    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => { setLimitVal(String(scanLimit)); }, [scanLimit]);
    useEffect(() => () => {
        if (debounceRef.current) clearTimeout(debounceRef.current);
    }, []);

    const handleLimitChange = (raw: string) => {
        setLimitVal(raw);
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => {
            const n = parseInt(raw, 10);
            if (!Number.isFinite(n) || n <= 0) return;
            if (n !== scanLimit) onScanLimitChange(n);
        }, 300);
    };
    const commitLimit = (raw: string) => {
        if (debounceRef.current) { clearTimeout(debounceRef.current); debounceRef.current = null; }
        const n = parseInt(raw, 10);
        if (!Number.isFinite(n)) { setLimitVal(String(scanLimit)); return; }
        const clamped = Math.min(5000, Math.max(100, n));
        setLimitVal(String(clamped));
        if (clamped !== scanLimit) onScanLimitChange(clamped);
    };

    const scanning = phase === "scanning" || phase === "rate-limited";
    const canSearch = !scanning && prepareQuery(draftQuery).exactNeedle.length > 0;

    return (
        <div className="vc-bettersearch-searchbox">
            <div className="vc-bettersearch-searchbox-scope">
                Searching in <strong>{currentChannelLabel}</strong>
            </div>
            <input
                aria-label="Exact text to search for"
                type="text"
                placeholder="Search this channel (any text, including @, #, :, ...)"
                value={draftQuery}
                onChange={e => onDraftChange(e.currentTarget.value)}
                onKeyDown={e => {
                    if (e.key === "Enter" && canSearch) {
                        e.preventDefault();
                        onRunSearch();
                    }
                }}
                className="vc-bettersearch-searchbox-input"
                autoFocus
            />
            <div className="vc-bettersearch-searchbox-row">
                <label className="vc-bettersearch-limit-label" title="Max messages to scan (100-5000)">
                    <span>Scan up to</span>
                    <input
                        type="number"
                        min={100}
                        max={5000}
                        step={100}
                        value={limitVal}
                        onChange={e => handleLimitChange(e.currentTarget.value)}
                        onBlur={e => commitLimit(e.currentTarget.value)}
                        onKeyDown={e => { if (e.key === "Enter") (e.currentTarget as HTMLInputElement).blur(); }}
                        className="vc-bettersearch-limit-input"
                    />
                    <span>msgs</span>
                </label>
                <div className="vc-bettersearch-toolbar-spacer" />
                {scanning ? (
                    <button
                        type="button"
                        className="vc-bettersearch-icon-btn vc-bettersearch-icon-btn-warn"
                        onClick={onAbort}
                        title="Stop scan"
                    >Stop</button>
                ) : (
                    <button
                        type="button"
                        className="vc-bettersearch-icon-btn vc-bettersearch-icon-btn-primary"
                        onClick={onRunSearch}
                        disabled={!canSearch}
                        title={canSearch ? "Search this channel" : "Type a query first"}
                    >Search</button>
                )}
            </div>
        </div>
    );
}

// ── Header actions ────────────────────────────────────────────────────────────

// Minimal always-visible header buttons (collapse + close). Kept separate from
// the controls row so the header width stays tight and predictable — previously
// the combined toolbar wrapped onto a second line at 440px wide.
interface HeaderActionsProps {
    collapsed: boolean;
    onToggleCollapse: () => void;
    onDismiss: () => void;
}

function HeaderActions({ collapsed, onToggleCollapse, onDismiss }: HeaderActionsProps) {
    return (
        <div className="vc-bettersearch-header-actions">
            <button
                type="button"
                className="vc-bettersearch-icon-btn"
                onClick={onToggleCollapse}
                title={collapsed ? "Expand panel" : "Collapse panel"}
                aria-label={collapsed ? "Expand" : "Collapse"}
                aria-expanded={!collapsed}
                aria-controls="vc-bettersearch-content"
            >{collapsed ? "▾" : "▴"}</button>
            <button
                type="button"
                className="vc-bettersearch-icon-btn vc-bettersearch-icon-btn-danger"
                onClick={onDismiss}
                title="Close BetterSearch"
                aria-label="Close"
            >✕</button>
        </div>
    );
}

// ── Results action row ────────────────────────────────────────────────────────

// Sits between the SearchBox and the result list once a scan has produced (or
// is producing) matches. Holds the post-scan actions only — the scan-limit
// input lives in SearchBox, so this row has no inputs and stays single-line.
interface ResultsActionsProps {
    onCopyAll?: () => void;
    matchCount: number;
    phase: string | null;
    onRescan: () => void;
    canRescan: boolean;
}

function ResultsActions({ onCopyAll, matchCount, phase, onRescan, canRescan }: ResultsActionsProps) {
    const scanning = phase === "scanning" || phase === "rate-limited";
    const showRescan = !scanning && canRescan;
    const showCopy = matchCount > 0;
    if (!showRescan && !showCopy) return null;
    return (
        <div className="vc-bettersearch-controls-row">
            <div className="vc-bettersearch-toolbar-spacer" />
            {showRescan && (
                <button
                    type="button"
                    className="vc-bettersearch-icon-btn"
                    onClick={onRescan}
                    title="Search again with the current limit"
                >Search again</button>
            )}
            {showCopy && (
                <button
                    type="button"
                    className="vc-bettersearch-icon-btn"
                    onClick={onCopyAll}
                    title="Copy full text (author, channel, timestamp, content) for every match"
                >Copy all</button>
            )}
        </div>
    );
}

// ── Panel ────────────────────────────────────────────────────────────────────

interface PanelProps {
    session: Session | null;
    needle: string;
    showPartialBanner: boolean;
    draftQuery: string;
    onDraftChange: (q: string) => void;
    onRunSearch: () => void;
    currentChannelLabel: string;
    scanLimit: number;
    onScanLimitChange: (n: number) => void;
    onAbort: () => void;
    onDismiss: () => void;
    canRescan: boolean;
    onRescan: () => void;
    collapsed: boolean;
    onToggleCollapse: () => void;
}

export function BetterSearchPanel({
    session,
    needle,
    showPartialBanner,
    draftQuery,
    onDraftChange,
    onRunSearch,
    currentChannelLabel,
    scanLimit,
    onScanLimitChange,
    onAbort,
    onDismiss,
    canRescan,
    onRescan,
    collapsed,
    onToggleCollapse,
}: PanelProps) {
    const [status, setStatus] = useState<SessionStatus | null>(session?.status ?? null);

    useEffect(() => {
        if (!session) { setStatus(null); return; }
        const unsub = session.subscribe(setStatus);
        return unsub;
    }, [session]);

    const matchCount = status?.matches.length ?? 0;

    // "Copy all": dump every match as plain text, one block per message, for
    // pasting into notes / chat / whatever. Purely client-side (clipboard API),
    // no Discord API calls, identical detection surface to Ctrl+C.
    const copyAllText = () => {
        if (!status) return;
        const blocks = status.matches.map(m => {
            const u = m.author?.id ? UserStore?.getUser?.(m.author.id) : null;
            const who = u?.globalName || u?.username
                || m.author?.global_name || m.author?.username || "Unknown";
            const where = resolveChannelLabel(m.channel_id);
            const ts = m.timestamp ? new Date(m.timestamp) : null;
            const when = ts && !isNaN(ts.getTime()) ? ts.toLocaleString() : "";

            const parts: string[] = [];
            if (m.content) parts.push(m.content);
            for (const e of (m.embeds ?? [])) {
                const text = (e.description || e.title || "").trim();
                if (text) parts.push(`(embed) ${text}`);
            }
            for (const a of (m.attachments ?? [])) {
                if (a.filename) parts.push(`(attachment) ${a.filename}`);
            }
            const body = parts.length ? parts.join("\n") : "(no text)";
            const header = when ? `[${when}] ${who} in ${where}:` : `${who} in ${where}:`;
            return `${header}\n${body}`;
        });
        void copyWithToast(
            blocks.join("\n\n"),
            `Copied ${blocks.length} BetterSearch result${blocks.length === 1 ? "" : "s"}.`,
        ).catch(e => console.warn("[BetterSearch] clipboard write failed", e));
    };

    const headerActions = (
        <HeaderActions
            collapsed={collapsed}
            onToggleCollapse={onToggleCollapse}
            onDismiss={onDismiss}
        />
    );

    const hidePartial = !showPartialBanner && status?.phase === "capped";

    return (
        <div
            id="vc-bettersearch-panel"
            className="vc-bettersearch-root"
            role="region"
            aria-label="BetterSearch exact-substring search"
            onKeyDown={e => {
                if (e.key === "Escape") {
                    e.preventDefault();
                    onDismiss();
                }
            }}
        >
            <div className="vc-bettersearch-header-row">
                <div className="vc-bettersearch-header">
                    BetterSearch
                    {matchCount > 0 && <span className="vc-bettersearch-count-badge">{matchCount}</span>}
                </div>
                {headerActions}
            </div>
            {!collapsed && <div id="vc-bettersearch-content">
                <SearchBox
                    draftQuery={draftQuery}
                    onDraftChange={onDraftChange}
                    onRunSearch={onRunSearch}
                    scanLimit={scanLimit}
                    onScanLimitChange={onScanLimitChange}
                    phase={status?.phase ?? null}
                    onAbort={onAbort}
                    currentChannelLabel={currentChannelLabel}
                />
                {session && status && <>
                    <ResultsActions
                        onCopyAll={copyAllText}
                        matchCount={matchCount}
                        phase={status.phase}
                        onRescan={onRescan}
                        canRescan={canRescan}
                    />
                    {!hidePartial && <StatusStrip status={status} needle={needle} />}
                    <div className="vc-bettersearch-list">
                        {status.matches.map(m => (
                            <Row key={`${m.channel_id}:${m.id}`} message={m} needle={needle} />
                        ))}
                    </div>
                </>}
            </div>}
        </div>
    );
}
