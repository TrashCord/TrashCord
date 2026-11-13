/*
 * TrashCord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { get, set } from "@api/DataStore";
import { Settings } from "@api/Settings";
import { sleep } from "@utils/misc";
import type { RunningGame } from "@vencord/discord-types";
import { findStoreLazy } from "@webpack";
import { ApplicationStreamingStore, FluxDispatcher, SelectedChannelStore, showToast } from "@webpack/common";

import { t } from "./i18n";
import { creditPlaytime, fingerprintFor, type LiveContext, startLiveStream, type StreamLocation, type StreamPhase } from "./science";

export interface DetectableApp {
    id: string;
    name: string;
    executables?: Array<{ name: string; os?: string; is_launcher?: boolean; }>;
}

export interface SpoofedGame extends Omit<RunningGame, "distributor"> {
    id: string;
    pid: number;
    exeName: string;
    pidPath: number[];
    processName: string;
    start: number;
}

export type FarmerMode = "IDLE" | "GAME_TIME" | "VARIETY" | "STREAM" | "MAX_ALL";

export interface FarmerStatus {
    mode: FarmerMode;
    activeGame: SpoofedGame | null;
    varietyIndex: number;
    varietyTotal: number;
    gamesCreditedThisRun: number;
    hoursCreditedThisRun: number;
    streamHoursCreditedThisRun: number;
    streamPhase: StreamPhase;
    needsConsent: boolean;
    gameTarget: number;
    streamTarget: number;
    errors: number;
    lastError: string | null;
    finishedMessage: string | null;
}

export interface LiveInfo {
    inVoice: boolean;
    live: boolean;
    viewers: number;
}

export const MAX_TIME_HOURS = 1000000;

export const MAX_BADGE_HOURS = 5000;
export const MAX_VARIETY_GAMES = 100;
export const DEFAULT_VARIETY_MINUTES = 2;
export const DEFAULT_CHUNK_HOURS = 24;
const MAX_CHUNK_HOURS = 500;
const REQUEST_DELAY_MS = 600;
const RETRY_DELAY_MS = 3_000;
const MAX_FAILED_BURSTS = 5;

let mode: FarmerMode = "IDLE";
let activeGame: SpoofedGame | null = null;
let varietyList: SpoofedGame[] = [];
let varietyIndex = 0;
let gamesCredited = 0;
let hoursCredited = 0;
let streamHoursCredited = 0;
let streamPhase: StreamPhase = "waiting";
let needsConsent = false;
let gameTarget = 0;
let streamTarget = 0;
let liveSession: ReturnType<typeof startLiveStream> | null = null;
let errors = 0;
let lastError: string | null = null;
let finishedMessage: string | null = null;
let running = false;
let abortToken = 0;
let cursor = 0;
let presenceShown = false;

const listeners = new Set<() => void>();
let notifyTimer: ReturnType<typeof setTimeout> | null = null;

export function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

function flush(): void {
    notifyTimer = null;
    persist();
    for (const listener of listeners) listener();
}

function notify(now = false): void {
    if (now) {
        if (notifyTimer != null) clearTimeout(notifyTimer);
        flush();
    } else if (notifyTimer == null) {
        notifyTimer = setTimeout(flush, 150);
    }
}

export function getStatus(): FarmerStatus {
    return {
        mode,
        activeGame,
        varietyIndex: varietyIndex < varietyList.length ? varietyIndex : varietyList.length,
        varietyTotal: varietyList.length,
        gamesCreditedThisRun: gamesCredited,
        hoursCreditedThisRun: hoursCredited,
        streamHoursCreditedThisRun: streamHoursCredited,
        streamPhase,
        needsConsent,
        gameTarget,
        streamTarget,
        errors,
        lastError,
        finishedMessage
    };
}

export function notice(text: string, kind: "success" | "warning" | "info" = "info"): void {
    if ((Settings.plugins as any).BadgeFarmer?.toasts === false) return;
    showToast({ text: `BadgeFarmer · ${text}`, variant: kind } as any);
}

const ConsentStore: any = findStoreLazy("ConsentStore");
const RUN_KEY = "BadgeFarmer_run";
let lastSave = 0;

let forceUnlock = false;

export function setForce(value: boolean): void {
    forceUnlock = value;
}

export function isLocked(): boolean {
    return personalizationOff() && !forceUnlock;
}

export function personalizationOff(): boolean {
    try {
        if (typeof ConsentStore.hasConsented === "function") return !ConsentStore.hasConsented("personalization");
        const entry = ConsentStore.getConsents?.()?.personalization;
        if (entry != null) return !(entry.consented ?? entry);
    } catch { }
    return false;
}

function friendly(error: unknown): string {
    const text = String(error);
    if (text.includes("analytics_token")) {
        needsConsent = true;
        return t("errToken");
    }
    return text;
}

function persist(force = false): void {
    const now = Date.now();
    if (!force && now - lastSave < 5_000) return;
    lastSave = now;
    set(RUN_KEY, { running, games: gamesCredited, hours: hoursCredited, stream: streamHoursCredited }).catch(() => { });
}

export async function checkInterrupted(): Promise<void> {
    try {
        const saved = await get(RUN_KEY);
        if (saved?.running !== true) return;
        await set(RUN_KEY, { running: false });
        finishedMessage = t("interrupted", { g: saved.games ?? 0, h: Math.round(saved.hours ?? 0), s: Math.round(saved.stream ?? 0) });
        notice(finishedMessage, "warning");
        notify(true);
    } catch { }
}

function activeLiveStream(): { location: StreamLocation; viewers: number; } | null {
    try {
        const stream = ApplicationStreamingStore.getCurrentUserActiveStream();
        if (stream == null) return null;

        const { channelId } = (stream as { channelId?: string; });
        if (typeof channelId !== "string" || channelId === "") return null;

        const { guildId } = (stream as { guildId?: string | null; });
        const viewers = ApplicationStreamingStore.getViewerIds(stream).length;
        return { location: { guildId: guildId ?? "0", channelId }, viewers };
    } catch {
        return null;
    }
}

function liveContext(): LiveContext {
    const live = activeLiveStream();
    return live == null ? { location: null, viewers: 0 } : { location: live.location, viewers: live.viewers };
}

export function getLiveInfo(): LiveInfo {
    const live = activeLiveStream();
    const voice = SelectedChannelStore.getVoiceChannelId();
    return { inVoice: typeof voice === "string" && voice !== "", live: live != null, viewers: live?.viewers ?? 0 };
}

export function executableFor(app: DetectableApp): string {
    const executables = app.executables ?? [];
    const executable = executables.find(entry => entry.os === "win32" && entry.is_launcher !== true)
        ?? executables.find(entry => entry.os === "win32")
        ?? executables[0];

    return (executable?.name.replace(/^>/, "") ?? `${app.name}.exe`).replace(/^.*[\\/]/, "");
}

export function buildGame(app: { id: string; name: string; exeName: string; }, startedAt: number): SpoofedGame {
    const folder = app.name.replace(/[<>:"/\\|?*]/g, "").toLowerCase();
    const pid = 10_000 + Math.floor(Math.random() * 40_000);

    return {
        id: app.id,
        name: app.name,
        exeName: app.exeName,
        exePath: `c:/program files/${folder}/${app.exeName}`,
        cmdLine: `c:/program files/${folder}/${app.exeName}`,
        processName: app.name,
        pid,
        pidPath: [pid],
        start: startedAt,
        lastFocused: Math.floor(startedAt / 1000),
        lastLaunched: startedAt,
        nativeProcessObserverId: -1,
        hidden: false,
        isLauncher: false,
        elevated: false,
        sandboxed: false
    };
}

function setDebugGame(game: SpoofedGame | null): void {
    FluxDispatcher.dispatch({ type: "RUNNING_GAME_SET_DEBUG_GAME", game });
}

function showGame(game: SpoofedGame): void {
    if (activeGame === game) return;
    fingerprintFor(game.id);
    activeGame = game;
    if (!(Settings.plugins as any).BadgeFarmer?.showGamePresence) return;
    presenceShown = true;
    setDebugGame(game);
}

function clearGame(): void {
    activeGame = null;
    if (!presenceShown) return;
    presenceShown = false;
    setDebugGame(null);
}

interface Slot { start: number; end: number; }

function nextSlot(durationMs: number): Slot {
    const end = cursor;
    const start = end - durationMs;
    cursor = start;
    return { start, end };
}

async function withRetry(action: () => Promise<void>): Promise<boolean> {
    const own = abortToken;
    for (let attempt = 0; attempt < 3 && running && own === abortToken; attempt++) {
        try {
            await action();
            return true;
        } catch (error) {
            errors++;
            lastError = friendly(error);
            if (attempt < 2) await sleep(RETRY_DELAY_MS);
        }
    }
    return false;
}

function shuffled<T>(items: T[]): T[] {
    const pool = [...items];
    for (let index = pool.length - 1; index > 0; index--) {
        const picked = Math.floor(Math.random() * (index + 1));
        [pool[index], pool[picked]] = [pool[picked], pool[index]];
    }
    return pool;
}

async function creditGameChunk(game: SpoofedGame, hours: number): Promise<void> {
    const slot = nextSlot(hours * 3_600_000);
    const own = abortToken;
    await creditPlaytime(game, hours * 3_600_000, slot.start);
    if (own === abortToken) hoursCredited += hours;
}

async function creditVarietySession(game: SpoofedGame, minutes: number): Promise<void> {
    const slot = nextSlot(minutes * 60_000);
    const own = abortToken;
    await creditPlaytime(game, minutes * 60_000, slot.start);
    if (own === abortToken) gamesCredited++;
}

async function runStream(targetHours: number): Promise<void> {
    const own = abortToken;
    streamPhase = "waiting";
    let announced: StreamPhase | null = null;
    notify(true);

    const session = startLiveStream({
        targetHours,
        autoSwitch: (Settings.plugins as any).BadgeFarmer?.autoSwitch !== false,
        context: liveContext,
        shouldContinue: () => running && own === abortToken && streamHoursCredited < targetHours,
        onProgress: hours => {
            if (own !== abortToken) return;
            streamHoursCredited = Math.min(hours, targetHours);
            notify();
        },
        onPhase: phase => {
            streamPhase = phase;
            if (phase !== announced) {
                announced = phase;
                const info = getLiveInfo();
                if (phase === "turbo") notice(t("toastTurbo", { n: info.viewers }), "success");
                else if (phase === "slow") notice(t("toastNoViewer"), "info");
                else notice(t(info.inVoice ? "toastNoLive" : "toastNoVoice"), "warning");
            }
            notify(true);
        },
        onError: message => {
            errors++;
            lastError = message === "errHb" ? t("errHb") : friendly(message);
            notify(true);
        }
    });

    liveSession = session;
    await session.finished;
    liveSession = null;
}

async function runGameTime(app: { id: string; name: string; exeName: string; }, targetHours: number, chunkHours = DEFAULT_CHUNK_HOURS): Promise<void> {
    let credited = 0;
    let failedBursts = 0;
    const chunkSize = Math.min(Math.max(1, chunkHours), MAX_CHUNK_HOURS);
    const own = abortToken;
    clearGame();

    while (running && own === abortToken && credited < targetHours) {
        const chunk = Math.min(chunkSize, targetHours - credited);
        const game = activeGame ?? buildGame(app, cursor);
        showGame(game);
        const ok = await withRetry(() => creditGameChunk(game, chunk));
        if (!ok) {
            if (++failedBursts >= MAX_FAILED_BURSTS) {
                lastError = t("errRepeated");
                return;
            }
            continue;
        }
        failedBursts = 0;
        credited += chunk;
        notify();
        await sleep(REQUEST_DELAY_MS);
    }
}

async function runVariety(list: SpoofedGame[], minutesPerGame: number): Promise<void> {
    const own = abortToken;
    for (varietyIndex = 0; varietyIndex < list.length && running && own === abortToken; varietyIndex++) {
        const game = list[varietyIndex];
        showGame(game);
        await withRetry(() => creditVarietySession(game, minutesPerGame));
        notify();
        await sleep(REQUEST_DELAY_MS);
    }
}

function begin(nextMode: FarmerMode): boolean {
    if (running) return false;
    if (isLocked()) {
        notice(t("lockedToast"), "warning");
        return false;
    }
    running = true;
    mode = nextMode;
    gamesCredited = 0;
    hoursCredited = 0;
    streamHoursCredited = 0;
    streamPhase = "waiting";
    needsConsent = false;
    gameTarget = 0;
    streamTarget = 0;
    errors = 0;
    lastError = null;
    finishedMessage = null;
    cursor = Date.now();
    abortToken++;
    persist(true);
    notify(true);
    return true;
}

function markFinished(message: string): void {
    finishedMessage = message;
    notice(message, "success");
}

type GameSpec = { id: string; name: string; exeName: string; };

export async function startGameTime(app: DetectableApp, hours = MAX_BADGE_HOURS, chunkHours = DEFAULT_CHUNK_HOURS): Promise<void> {
    const spec: GameSpec = { id: app.id, name: app.name, exeName: executableFor(app) };
    if (!begin("GAME_TIME")) return;
    gameTarget = hours;
    notice(t("toastStarted", { what: `${t("gameTime")}: ${spec.name}` }));
    const token = abortToken;
    try {
        await runGameTime(spec, hours, chunkHours);
        if (running && hoursCredited >= hours) {
            markFinished(t("doneGame", { h: Math.round(hoursCredited), name: spec.name }));
        }
    } catch (error) {
        lastError = friendly(error);
    } finally {
        if (token === abortToken) finish();
    }
}

export async function startVariety(apps: DetectableApp[], minutesPerGame = DEFAULT_VARIETY_MINUTES): Promise<void> {
    if (!begin("VARIETY")) return;
    notice(t("toastStarted", { what: t("variety") }));
    varietyList = apps.map(app => buildGame({ id: app.id, name: app.name, exeName: executableFor(app) }, cursor));
    varietyIndex = 0;
    const token = abortToken;
    try {
        await runVariety(varietyList, minutesPerGame);
        if (running && gamesCredited >= varietyList.length) {
            markFinished(t("doneVar", { n: gamesCredited }));
        }
    } catch (error) {
        lastError = friendly(error);
    } finally {
        if (token === abortToken) finish();
    }
}

export async function startStream(hours = MAX_BADGE_HOURS): Promise<void> {
    if (!begin("STREAM")) return;
    streamTarget = hours;
    notice(t("toastStarted", { what: t("streaming") }));
    const token = abortToken;
    try {
        await runStream(hours);
        if (running && streamHoursCredited >= hours) {
            markFinished(t("doneStream", { h: Math.round(streamHoursCredited) }));
        }
    } catch (error) {
        lastError = friendly(error);
    } finally {
        if (token === abortToken) finish();
    }
}

export async function maxAll(apps: DetectableApp[]): Promise<void> {
    if (!begin("MAX_ALL")) return;
    gameTarget = MAX_BADGE_HOURS;
    streamTarget = MAX_BADGE_HOURS;
    notice(t("toastStarted", { what: t("maxAll") }));
    const token = abortToken;
    try {
        varietyList = shuffled(apps).slice(0, MAX_VARIETY_GAMES).map(app => buildGame({ id: app.id, name: app.name, exeName: executableFor(app) }, cursor));
        varietyIndex = 0;
        await runVariety(varietyList, 1.5);

        if (running && varietyList.length > 0) {
            await runGameTime(varietyList[0], MAX_BADGE_HOURS);
        }

        if (running) {
            if (getLiveInfo().viewers > 0) await runStream(MAX_BADGE_HOURS);
            else notice(t("toastSkipStream"), "warning");
        }

        if (running && gamesCredited >= varietyList.length && hoursCredited >= MAX_BADGE_HOURS) {
            markFinished(t("doneAll", { g: gamesCredited, h: Math.round(hoursCredited), s: Math.round(streamHoursCredited) }));
        }
    } catch (error) {
        lastError = friendly(error);
    } finally {
        if (token === abortToken) finish();
    }
}

function finish(): void {
    running = false;
    mode = "IDLE";
    clearGame();
    varietyList = [];
    varietyIndex = 0;
    persist(true);
    notify(true);
}

export function stop(): void {
    if (running) notice(t("toastStopped"));
    abortToken++;
    liveSession?.stop();
    finish();
}

export function isRunning(): boolean {
    return running;
}
