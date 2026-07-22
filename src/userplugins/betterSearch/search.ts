/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// search.ts -- pure logic. No React. No DOM. No direct webpack finds beyond
// RestAPI (Discord's own authenticated HTTP wrapper, exported by Vencord).
//
// Safety contract:
//  * Read-only. Only the three endpoints listed in CALLABLE_ENDPOINTS are ever
//    contacted, and only via RestAPI which attaches the same auth headers
//    Discord itself uses. We never read localStorage, never set Authorization,
//    never call fetch() directly.
//  * Every outgoing request goes through `searchLimiter`, which serialises
//    requests, enforces a min interval, and honours 429 retry_after.

import { RestAPI } from "@webpack/common";

// Settings accessor (populated by index.tsx at start). Defaults match the spec
// so anything that imports search.ts before configureSearch() runs still works.
export interface SearchSettingsView {
    minRequestIntervalMs: number;
    maxPages: number;
    maxMessagesScanned: number;
    debugLogs: boolean;
}

let _readSettings: () => SearchSettingsView = () => ({
    minRequestIntervalMs: 1100,
    maxPages: 25,
    maxMessagesScanned: 2500,
    debugLogs: false,
});

export function configureSearch(accessor: () => SearchSettingsView) {
    _readSettings = accessor;
}

function getSettings(): SearchSettingsView { return _readSettings(); }
function isDebug(): boolean { try { return _readSettings().debugLogs; } catch { return false; } }

// ── Types ────────────────────────────────────────────────────────────────────

export interface RawMessage {
    id: string;
    channel_id: string;
    author?: { id: string; global_name?: string; username?: string; };
    content?: string;
    timestamp?: string;
    embeds?: Array<{ title?: string; description?: string; }>;
    attachments?: Array<{ filename?: string; }>;
}

export interface PreparedQuery {
    raw: string;
    /** Largest tokenizable run. Null if the query is pure symbols. */
    nativeHint: string | null;
    /** Original query minus surrounding quotes. NFKC-lowercased for matching. */
    exactNeedle: string;
    /** True if the query was wrapped in matching double quotes. */
    quoted: boolean;
    /** True if BetterSearch should activate (symbol-heavy or quoted query). */
    needsExact: boolean;
}

export interface SearchTarget {
    /** "guild" => /guilds/{id}/messages/search; "channel" => /channels/{id}/messages/search */
    kind: "guild" | "channel";
    id: string;
}

export type SessionPhase =
    | "idle"
    | "scanning"
    | "rate-limited"
    | "capped"
    | "done"
    | "error"
    | "aborted";

export type CappedReason = "matches" | "scan-limit" | "wall-time" | "page-budget";

export interface SessionStatus {
    phase: SessionPhase;
    scanned: number;
    target: number;
    matches: RawMessage[];
    pausedUntil: number;
    errorMsg: string | null;
    capped: boolean;
    cappedReason: CappedReason | null;
}

export type StatusListener = (s: SessionStatus) => void;

// ── Constants ────────────────────────────────────────────────────────────────

// The full symbol set the spec calls out as Discord-tokenizer separators.
// Anything in here is treated as "would be stripped by native search".
// Note: whitespace is also a separator but we handle it specially.
const SYMBOL_CHARS = "@#./:\\-_$%&+=?!*\"'()[]{}<>|\\\\~`;,";
const SYMBOL_SET: ReadonlySet<string> = new Set(SYMBOL_CHARS.split(""));

// Tokenizable run = letters, digits, CJK, or anything not in SYMBOL_SET and
// not whitespace. Discord's tokenizer keeps these.
const TOKEN_RUN_RE = /[^\s@#./:\-_$%&+=?!*"'()[\]{}<>|\\~`;,]+/g;

// Endpoints we're explicitly allowed to call. Anything else is a bug.
const CALLABLE_ENDPOINTS = Object.freeze({
    GUILD_SEARCH: (id: string) => `/guilds/${id}/messages/search`,
    CHANNEL_SEARCH: (id: string) => `/channels/${id}/messages/search`,
    CHANNEL_MESSAGES: (id: string) => `/channels/${id}/messages`,
});

const PAGE_SIZE = 25;
const SESSION_WALL_MS = 60_000;
// Preserve the established user-visible result capacity. Page-level emits and
// candidate deduplication keep the UI work bounded without truncating searches
// that previously returned hundreds of exact matches.
const MAX_MATCHES = 500;
const MAX_CONSECUTIVE_ERRORS = 3;

export const BETTERSEARCH_MAX_MATCHES = MAX_MATCHES;

// ── Utilities ────────────────────────────────────────────────────────────────

function debug(...args: unknown[]) {
    if (isDebug()) console.log("[BetterSearch]", ...args);
}

export function normalizeForSearch(s: string): string {
    return s.normalize("NFKC").toLowerCase();
}

export function includesNeedle(haystack: string | undefined, needle: string): boolean {
    if (typeof haystack !== "string" || !haystack || !needle) return false;
    return normalizeForSearch(haystack).includes(needle);
}

/** Validate and clamp a numeric Setting value on read. */
function clamp(n: unknown, lo: number, hi: number, fallback: number): number {
    const v = typeof n === "number" && Number.isFinite(n) ? n : fallback;
    return Math.min(hi, Math.max(lo, v));
}

function clampInt(n: unknown, lo: number, hi: number, fallback: number): number {
    return Math.round(clamp(n, lo, hi, fallback));
}

// ── Query prep ───────────────────────────────────────────────────────────────

export function prepareQuery(rawIn: string): PreparedQuery {
    const raw = rawIn ?? "";
    const trimmed = raw.trim();

    // Detect a fully-quoted query: "foo bar" -> exact match required.
    const isQuoted =
        trimmed.length >= 2 &&
        trimmed.startsWith("\"") &&
        trimmed.endsWith("\"");

    const unquoted = isQuoted ? trimmed.slice(1, -1) : trimmed;

    // Find the longest tokenizable run.
    let longest = "";
    const matches = unquoted.matchAll(TOKEN_RUN_RE);
    for (const m of matches) {
        if (m[0].length > longest.length) longest = m[0];
    }
    const nativeHint = longest.length > 0 ? longest : null;

    // Strip every symbol/whitespace and see if anything remains.
    const stripped = [...unquoted]
        .filter(char => !/\s/u.test(char) && !SYMBOL_SET.has(char))
        .join("");
    const symbolHeavy = stripped.length === 0 && unquoted.length > 0;

    return {
        raw,
        nativeHint,
        exactNeedle: normalizeForSearch(unquoted),
        quoted: isQuoted,
        needsExact: symbolHeavy || isQuoted
    };
}

// ── Rate limiter ─────────────────────────────────────────────────────────────

class SearchLimiter {
    private chain: Promise<unknown> = Promise.resolve();
    private lastRequestAt = 0;
    private pausedUntil = 0;

    pauseFor(ms: number) {
        const safeMs = Number.isFinite(ms) ? Math.max(0, ms) : 1000;
        const until = Date.now() + safeMs;
        if (until > this.pausedUntil) this.pausedUntil = until;
        debug("limiter paused until", new Date(this.pausedUntil).toISOString());
    }

    getPausedUntil() { return this.pausedUntil; }

    /** Serialise fn so only one request is in flight; respect min interval and pause. */
    schedule<T>(fn: () => Promise<T>, canRun: () => boolean): Promise<ScheduledResult<T>> {
        const next = this.chain.then(async () => {
            if (!canRun()) return { executed: false } as const;

            const minInterval = clamp(getSettings().minRequestIntervalMs, 800, 5000, 1100);

            // Respect any active pause first.
            const pauseDelta = this.pausedUntil - Date.now();
            if (pauseDelta > 0) await sleep(pauseDelta);
            if (!canRun()) return { executed: false } as const;

            // Then enforce min spacing between requests.
            const sinceLast = Date.now() - this.lastRequestAt;
            if (sinceLast < minInterval) await sleep(minInterval - sinceLast);
            if (!canRun()) return { executed: false } as const;

            this.lastRequestAt = Date.now();
            return { executed: true, value: await fn() } as const;
        });
        // Keep the chain alive even if this run rejects.
        this.chain = next.catch(() => undefined);
        return next;
    }
}

type ScheduledResult<T> =
    | { executed: true; value: T; }
    | { executed: false; };

function sleep(ms: number): Promise<void> {
    return new Promise(r => setTimeout(r, Math.max(0, ms)));
}

export const searchLimiter = new SearchLimiter();

// ── HTTP wrapper (the ONLY place we touch the network) ───────────────────────

interface HttpOk<T> { ok: true; status: number; body: T; }
interface HttpRateLimited { ok: false; status: 429; retryAfter: number; }
interface HttpErr { ok: false; status: number; message: string; }
type HttpResult<T> = HttpOk<T> | HttpRateLimited | HttpErr;

function parseRetryAfter(body: any): number {
    const retryAfter = Number(body?.retry_after);
    return Number.isFinite(retryAfter) && retryAfter >= 0 ? retryAfter : 1;
}

async function safeGet<T = any>(url: string, query: Record<string, unknown>): Promise<HttpResult<T>> {
    try {
        const res: any = await RestAPI.get({ url, query, retries: 0 });
        const status = Number(res?.status ?? 200);
        if (status === 429) {
            return { ok: false, status: 429, retryAfter: parseRetryAfter(res?.body) };
        }
        if (!Number.isFinite(status) || status < 200 || status >= 300) {
            return {
                ok: false,
                status: Number.isFinite(status) ? status : 0,
                message: String(res?.body?.message ?? `HTTP ${status}`),
            };
        }
        return { ok: true, status, body: res?.body as T };
    } catch (e: any) {
        const status = Number(e?.status ?? e?.response?.status ?? 0);
        if (status === 429) {
            // RestAPI normally surfaces the rate-limit body as e.body.
            return {
                ok: false,
                status: 429,
                retryAfter: parseRetryAfter(e?.body ?? e?.response?.body),
            };
        }
        return {
            ok: false,
            status: Number.isFinite(status) ? status : 0,
            message: String(e?.message ?? e),
        };
    }
}

// ── Session driver ───────────────────────────────────────────────────────────

class Session {
    readonly status: SessionStatus;
    private listeners = new Set<StatusListener>();
    private seenCandidates = new Set<string>();
    private disposed = false;
    private startedAt = 0;
    private consecutiveErrors = 0;
    private scanLimit: number;

    constructor(targetCap: number) {
        this.scanLimit = clampInt(targetCap, 100, 5000, 2500);
        this.status = {
            phase: "idle",
            scanned: 0,
            target: this.scanLimit,
            matches: [],
            pausedUntil: 0,
            errorMsg: null,
            capped: false,
            cappedReason: null,
        };
    }

    setScanLimit(n: number) {
        this.scanLimit = clampInt(n, 100, 5000, 2500);
        this.status.target = this.scanLimit;
        this.emit();
    }

    getScanLimit(): number { return this.scanLimit; }

    subscribe(l: StatusListener): () => void {
        this.listeners.add(l);
        l({ ...this.status, matches: [...this.status.matches] });
        return () => this.listeners.delete(l);
    }

    private emit() {
        // Snapshot so React's referential checks see a new object.
        const snap: SessionStatus = { ...this.status, matches: [...this.status.matches] };
        for (const l of this.listeners) {
            try { l(snap); } catch (e) { debug("listener threw", e); }
        }
    }

    abort() {
        if (this.disposed) return;
        this.disposed = true;
        if (this.status.phase === "scanning" || this.status.phase === "rate-limited") {
            this.status.phase = "aborted";
            this.emit();
        }
    }

    isDisposed() { return this.disposed; }

    private setPhase(p: SessionPhase) {
        this.status.phase = p;
        this.emit();
    }

    private noteScanned(n: number) {
        this.status.scanned += n;
    }

    private addMatch(m: RawMessage) {
        if (this.status.matches.length >= MAX_MATCHES) return;
        this.status.matches.push(m);
    }

    private hasTimedOut(): boolean {
        return Date.now() - this.startedAt >= SESSION_WALL_MS;
    }

    private shouldContinue(): boolean {
        return !this.disposed && !this.hasTimedOut();
    }

    private resumeScanning() {
        if (this.status.phase === "rate-limited") {
            this.status.pausedUntil = 0;
            this.setPhase("scanning");
        }
    }

    private async request<T>(url: string, query: Record<string, unknown>): Promise<HttpResult<T> | null> {
        const pausedUntil = searchLimiter.getPausedUntil();
        if (pausedUntil > Date.now() && this.status.phase !== "rate-limited") {
            this.status.pausedUntil = pausedUntil;
            this.setPhase("rate-limited");
        }

        const scheduled = await searchLimiter.schedule(async () => {
            this.resumeScanning();
            return safeGet<T>(url, query);
        }, () => this.shouldContinue());

        if (!scheduled.executed) return null;
        return scheduled.value;
    }

    fail(error: unknown) {
        if (this.disposed) return;
        const raw = String((error as any)?.message ?? error ?? "unknown error");
        this.status.errorMsg = raw.length > 300 ? `${raw.slice(0, 297)}...` : raw;
        this.setPhase("error");
    }

    private scanCandidate(value: unknown, exactNeedle: string): boolean {
        if (!isRawMessage(value) || this.status.scanned >= this.scanLimit) return false;

        const key = `${value.channel_id}:${value.id}`;
        if (this.seenCandidates.has(key)) return false;
        this.seenCandidates.add(key);
        this.noteScanned(1);

        if (matchesQuery(value, exactNeedle)) this.addMatch(value);
        return true;
    }

    /** Run a search via the appropriate /messages/search endpoint. */
    async runHinted(target: SearchTarget, query: PreparedQuery) {
        if (!query.nativeHint) {
            this.fail("Internal error: hinted search started without a native hint.");
            return;
        }
        this.startedAt = Date.now();
        this.setPhase("scanning");

        const settings = getSettings();
        const maxPages = clampInt(settings.maxPages, 1, 40, 25);

        const url =
            target.kind === "guild"
                ? CALLABLE_ENDPOINTS.GUILD_SEARCH(target.id)
                : CALLABLE_ENDPOINTS.CHANNEL_SEARCH(target.id);

        let exhausted = false;
        for (let page = 0; page < maxPages; page++) {
            if (this.disposed) return;
            if (this.hasTimedOut()) { this.markCapped("wall-time"); return; }
            if (this.status.scanned >= this.scanLimit) { this.markCapped("scan-limit"); return; }
            if (this.status.matches.length >= MAX_MATCHES) { this.markCapped("matches"); return; }

            const offset = page * PAGE_SIZE;
            const result = await this.request<{ messages?: unknown; total_results?: unknown; }>(url, {
                content: query.nativeHint,
                offset,
                include_nsfw: true,
            });

            if (this.disposed) return;
            if (!result) {
                if (this.hasTimedOut()) this.markCapped("wall-time");
                return;
            }
            if (!this.handleHttp(result)) {
                if (this.status.phase === "error" || this.status.phase === "aborted") return;
                page--;
                continue;
            }

            const rawGroups = result.body?.messages;
            if (rawGroups != null && !Array.isArray(rawGroups)) {
                this.fail("Discord returned an invalid search response.");
                return;
            }

            const groups = rawGroups ?? [];
            if (groups.length === 0) {
                exhausted = true;
                break;
            }

            for (const grp of groups) {
                if (!Array.isArray(grp)) continue;
                for (const msg of grp) {
                    this.scanCandidate(msg, query.exactNeedle);
                    if (this.status.scanned >= this.scanLimit
                        || this.status.matches.length >= MAX_MATCHES) break;
                }
                if (this.status.scanned >= this.scanLimit
                    || this.status.matches.length >= MAX_MATCHES) break;
            }

            if (this.status.matches.length >= MAX_MATCHES) { this.markCapped("matches"); return; }
            if (this.status.scanned >= this.scanLimit) { this.markCapped("scan-limit"); return; }

            const totalResults = Number(result.body?.total_results);
            if (Number.isFinite(totalResults) && offset + groups.length >= totalResults) {
                exhausted = true;
                break;
            }

            this.emit();
        }

        if (!this.disposed) {
            if (exhausted) this.setPhase("done");
            else this.markCapped("page-budget");
        }
    }

    /** Fall-through path: walk the open channel's recent history. */
    async runChannelWalk(channelId: string, query: PreparedQuery) {
        this.startedAt = Date.now();
        this.setPhase("scanning");

        const settings = getSettings();
        const maxPages = clampInt(settings.maxPages, 1, 40, 25);
        const PER = 100;

        let before: string | undefined;
        let exhausted = false;
        for (let page = 0; page < maxPages; page++) {
            if (this.disposed) return;
            if (this.hasTimedOut()) { this.markCapped("wall-time"); return; }
            if (this.status.scanned >= this.scanLimit) { this.markCapped("scan-limit"); return; }
            if (this.status.matches.length >= MAX_MATCHES) { this.markCapped("matches"); return; }

            const query_ = before ? { limit: PER, before } : { limit: PER };
            const result = await this.request<unknown>(CALLABLE_ENDPOINTS.CHANNEL_MESSAGES(channelId), query_);

            if (this.disposed) return;
            if (!result) {
                if (this.hasTimedOut()) this.markCapped("wall-time");
                return;
            }
            if (!this.handleHttp(result)) {
                if (this.status.phase === "error" || this.status.phase === "aborted") return;
                page--;
                continue;
            }

            if (!Array.isArray(result.body)) {
                this.fail("Discord returned an invalid channel-history response.");
                return;
            }
            const messages = result.body;
            if (messages.length === 0) {
                exhausted = true;
                break;
            }

            for (const msg of messages) {
                this.scanCandidate(msg, query.exactNeedle);
                if (this.status.scanned >= this.scanLimit
                    || this.status.matches.length >= MAX_MATCHES) break;
            }

            if (this.status.matches.length >= MAX_MATCHES) { this.markCapped("matches"); return; }
            if (this.status.scanned >= this.scanLimit) { this.markCapped("scan-limit"); return; }

            const lastMessage = [...messages].reverse().find(isRawMessage);
            if (!lastMessage || lastMessage.id === before) {
                this.fail("Discord channel-history pagination did not advance.");
                return;
            }
            before = lastMessage.id;

            if (messages.length < PER) {
                exhausted = true;
                break;
            }

            this.emit();
        }

        if (!this.disposed) {
            if (exhausted) this.setPhase("done");
            else this.markCapped("page-budget");
        }
    }

    /**
     * Returns true if the request was successful and the body should be
     * processed; false if it was rate-limited / errored and the caller should
     * either retry the same page or bail (check status.phase).
     */
    private handleHttp(result: HttpResult<unknown>): result is HttpOk<unknown> {
        if (result.ok) {
            this.consecutiveErrors = 0;
            return true;
        }
        if ("retryAfter" in result) {
            const buffer = 250;
            const pauseMs = result.retryAfter * 1000 + buffer;
            searchLimiter.pauseFor(pauseMs);
            this.status.pausedUntil = searchLimiter.getPausedUntil();
            this.setPhase("rate-limited");
            // Caller will re-queue; phase will flip back to scanning on next loop.
            return false;
        }
        this.consecutiveErrors++;
        if (this.consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
            this.fail(`HTTP ${result.status}: ${result.message}`);
        } else {
            // Brief soft pause then retry.
            searchLimiter.pauseFor(1500);
        }
        return false;
    }

    private markCapped(reason: CappedReason) {
        this.status.capped = true;
        this.status.cappedReason = reason;
        this.setPhase("capped");
    }
}

function isRawMessage(value: unknown): value is RawMessage {
    if (!value || typeof value !== "object") return false;
    const message = value as Partial<RawMessage>;
    return typeof message.id === "string"
        && message.id.length > 0
        && typeof message.channel_id === "string"
        && message.channel_id.length > 0;
}

function matchesQuery(msg: RawMessage, exactNeedle: string): boolean {
    if (!exactNeedle) return false;
    if (includesNeedle(msg.content, exactNeedle)) return true;
    for (const e of msg.embeds ?? []) {
        if (includesNeedle(e.title, exactNeedle)) return true;
        if (includesNeedle(e.description, exactNeedle)) return true;
    }
    for (const a of msg.attachments ?? []) {
        if (includesNeedle(a.filename, exactNeedle)) return true;
    }
    return false;
}

// ── Public API ───────────────────────────────────────────────────────────────

let activeSession: Session | null = null;

export function getActiveSession(): Session | null { return activeSession; }

export function abortActiveSession() {
    activeSession?.abort();
    activeSession = null;
}

export function startHintedSession(target: SearchTarget, query: PreparedQuery, scanLimit?: number): Session {
    abortActiveSession();
    const targetCap = clampInt(scanLimit ?? getSettings().maxMessagesScanned, 100, 5000, 2500);
    const s = new Session(targetCap);
    activeSession = s;
    // Fire-and-forget; UI subscribes for progress.
    void s.runHinted(target, query).catch(e => {
        debug("session crashed", e);
        s.fail(e);
    });
    return s;
}

export function startChannelWalkSession(channelId: string, query: PreparedQuery, scanLimit?: number): Session {
    abortActiveSession();
    const targetCap = clampInt(scanLimit ?? getSettings().maxMessagesScanned, 100, 5000, 2500);
    const s = new Session(targetCap);
    activeSession = s;
    void s.runChannelWalk(channelId, query).catch(e => {
        debug("session crashed", e);
        s.fail(e);
    });
    return s;
}

export type { Session };
