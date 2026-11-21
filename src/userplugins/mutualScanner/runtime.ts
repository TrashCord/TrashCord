/*
 * TrashCord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { GuildStore, React } from "@webpack/common";

import {
    removeKamidereRuntimeTask,
    upsertKamidereRuntimeTask,
} from "../_kamidereCompat/runtimeActivity";
import {
    createGuildHydrationController,
    type GuildHydrationSnapshot,
    hydrateGuildMemberCache,
} from "./memberHydrator";
import { addMutualScannerRun } from "./store";
import type {
    MutualScannerConfig,
    MutualScannerController,
    MutualScannerExecutionResult,
    MutualScannerMatch,
    MutualScannerProgress,
    MutualScannerRun,
} from "./types";
import {
    clampNumber,
    estimateScanRemainingMs,
    executeMutualScan,
    formatDurationMs,
    getGuildMemberCount,
    makeLocalId,
    showToast,
} from "./utils";

const SCAN_TASK_ID = "kamidere-mutual-scanner:scan";
const WARMUP_TASK_ID = "kamidere-mutual-scanner:warmup";

export interface MutualScannerWarmupProgressState {
    guildId: string;
    guildLabel: string;
    guildIndex: number;
    totalGuilds: number;
    indexedCount: number;
    targetCount: number | null;
    remainingCount: number | null;
    delta: number;
    chunksSeen: number;
    state: "queued" | "running" | "completed" | "cancelled" | "cache" | "failed";
}

export interface MutualScannerRuntimeState {
    scan: {
        active: boolean;
        startedAt: number | null;
        scopeLabel: string | null;
        requestDelayMs: number;
        progress: MutualScannerProgress | null;
        result: MutualScannerExecutionResult | null;
        matches: MutualScannerMatch[];
        revision: number;
    };
    warmup: {
        active: boolean;
        startedAt: number | null;
        status: string | null;
        progress: MutualScannerWarmupProgressState | null;
        revision: number;
    };
}

type ScanState = MutualScannerRuntimeState["scan"];
type WarmupState = MutualScannerRuntimeState["warmup"];

const defaultState = (): MutualScannerRuntimeState => ({
    scan: {
        active: false,
        startedAt: null,
        scopeLabel: null,
        requestDelayMs: 0,
        progress: null,
        result: null,
        matches: [],
        revision: 0,
    },
    warmup: {
        active: false,
        startedAt: null,
        status: null,
        progress: null,
        revision: 0,
    },
});

let state = defaultState();
let scanController: MutualScannerController | null = null;
let warmupController: MutualScannerController | null = null;
const listeners = new Set<() => void>();

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

function patchScan(patch: Partial<ScanState> | ((scan: ScanState) => Partial<ScanState>)) {
    const scan = { ...state.scan, ...(typeof patch === "function" ? patch(state.scan) : patch) };
    state = { ...state, scan };
    listeners.forEach(listener => listener());
}

function patchWarmup(patch: Partial<WarmupState> | ((warmup: WarmupState) => Partial<WarmupState>)) {
    const warmup = { ...state.warmup, ...(typeof patch === "function" ? patch(state.warmup) : patch) };
    state = { ...state, warmup };
    listeners.forEach(listener => listener());
}

function syncScanTask() {
    const { scan } = state;
    if (!scan.active) {
        removeKamidereRuntimeTask(SCAN_TASK_ID);
        return;
    }

    const { progress } = scan;
    const remainingMs = estimateScanRemainingMs(progress, scan.startedAt, scan.requestDelayMs);
    const eta = remainingMs == null ? null : remainingMs === 0 ? "finishing now" : `~${formatDurationMs(remainingMs)} left`;
    const total = progress?.totalCandidates || null;
    const counts = `${progress?.scannedCount ?? 0}/${total ?? "?"}`;

    upsertKamidereRuntimeTask({
        id: SCAN_TASK_ID,
        toolId: "mutual-scanner",
        name: "Mutual Scanner",
        status: "running",
        subtitle: progress?.currentLabel ?? scan.scopeLabel ?? "Preparing scan",
        detail: !progress
            ? "Preparing candidates"
            : progress.phase === "warming"
                ? "warming cache"
                : progress.phase === "collecting"
                    ? total ? `${total} queued` : "collecting"
                    : eta ?? counts,
        progressCurrent: progress?.scannedCount ?? 0,
        progressTotal: total,
        startedAt: scan.startedAt ?? Date.now(),
    });
}

function syncWarmupTask() {
    const { warmup } = state;
    if (!warmup.active) {
        removeKamidereRuntimeTask(WARMUP_TASK_ID);
        return;
    }

    const { progress } = warmup;
    upsertKamidereRuntimeTask({
        id: WARMUP_TASK_ID,
        toolId: "manual-cache-warmup",
        name: "Manual Cache Warmup",
        status: "running",
        subtitle: progress?.guildLabel ?? warmup.status ?? "Hydrating selected servers",
        detail: progress?.targetCount != null
            ? `${progress.indexedCount}/${progress.targetCount}`
            : progress ? `${progress.indexedCount} indexed` : "warming",
        progressCurrent: progress?.indexedCount,
        progressTotal: progress?.targetCount ?? null,
        startedAt: warmup.startedAt ?? Date.now(),
    });
}

function finishScan(result: MutualScannerExecutionResult | null) {
    patchScan(scan => ({
        active: false,
        result,
        progress: null,
        matches: result?.matches ?? scan.matches,
        revision: scan.revision + 1,
    }));
    removeKamidereRuntimeTask(SCAN_TASK_ID);
}

function finishWarmup() {
    patchWarmup(warmup => ({ active: false, revision: warmup.revision + 1 }));
    removeKamidereRuntimeTask(WARMUP_TASK_ID);
}

export function subscribeMutualScannerRuntime(listener: () => void) {
    listeners.add(listener);
    return () => void listeners.delete(listener);
}

export function useMutualScannerRuntime<T>(selector: (current: MutualScannerRuntimeState) => T) {
    return React.useSyncExternalStore(subscribeMutualScannerRuntime, () => selector(state));
}

export function resetMutualScannerRuntime() {
    scanController?.cancel();
    warmupController?.cancel();
    scanController = null;
    warmupController = null;
    removeKamidereRuntimeTask(SCAN_TASK_ID);
    removeKamidereRuntimeTask(WARMUP_TASK_ID);
    state = defaultState();
    listeners.forEach(listener => listener());
}

export function cancelMutualScannerRun() {
    if (!scanController) return;
    scanController.cancel();
    showToast("Mutual scan cancellation requested.", "default");
}

export function cancelMutualScannerWarmup() {
    if (!warmupController) return;
    warmupController.cancel();
    showToast("Manual cache warmup cancellation requested.", "default");
}

export function startMutualScannerRun(ownerId: string | null, config: MutualScannerConfig) {
    if (!ownerId || state.scan.active || config.selectedGuildIds.length === 0) return false;

    const normalizedConfig: MutualScannerConfig = {
        ...config,
        requestDelayMs: clampNumber(Number(config.requestDelayMs) || 0, 0, 5000),
        maxMembersPerGuild: clampNumber(Number(config.maxMembersPerGuild) || 0, 0, 50000),
        warmupMemberBudget: clampNumber(Number(config.warmupMemberBudget) || 0, 0, 100000),
    };
    const startedAt = Date.now();
    const scopeLabel = `${plural(normalizedConfig.selectedGuildIds.length, "server")} / any mutual`;
    const controller = createGuildHydrationController();

    scanController = controller;
    patchScan({
        active: true,
        startedAt,
        scopeLabel,
        requestDelayMs: normalizedConfig.requestDelayMs,
        progress: {
            phase: "collecting",
            totalCandidates: 0,
            scannedCount: 0,
            matchedCount: 0,
            skippedBots: 0,
            skippedExistingFriends: 0,
            profileErrors: 0,
            countOnlyMatches: 0,
        },
        result: null,
        matches: [],
    });
    syncScanTask();

    void (async () => {
        const result = await executeMutualScan(normalizedConfig, {
            ownerId,
            controller,
            onProgress: progress => {
                if (scanController !== controller) return;
                patchScan({ progress });
                syncScanTask();
            },
            onMatch: match => {
                if (scanController !== controller) return;
                patchScan(scan => ({ matches: [...scan.matches.slice(-29), match] }));
            },
        });

        if (scanController !== controller) return;

        const run: MutualScannerRun = {
            id: makeLocalId("mutual-run"),
            scopeLabel,
            startedAt,
            finishedAt: result.finishedAt,
            status: result.status,
            configSnapshot: normalizedConfig,
            stats: result.stats,
            matches: result.matches,
            error: result.error,
        };

        await addMutualScannerRun(ownerId, run);
        if (scanController !== controller) return;

        scanController = null;
        finishScan(result);

        if (result.status === "completed") {
            showToast(`Mutual scan finished with ${result.matches.length} match${result.matches.length === 1 ? "" : "es"}.`, "success");
        } else if (result.status === "cancelled") {
            showToast(`Mutual scan cancelled after ${plural(result.stats.scannedCount, "profile")}.`, "default");
        } else {
            showToast(result.error ?? "Mutual scan failed.", "critical");
        }
    })().catch(() => {
        if (scanController !== controller) return;
        scanController = null;
        finishScan(null);
        showToast("Could not complete the mutual scan.", "critical");
    });

    return true;
}

export function startMutualScannerWarmup(
    ownerId: string | null,
    config: Pick<MutualScannerConfig, "selectedGuildIds" | "warmupMemberBudget" | "warmupTimeoutMs">,
) {
    if (!ownerId || state.warmup.active || config.selectedGuildIds.length === 0) return false;

    const controller = createGuildHydrationController();
    const guildIds = [...config.selectedGuildIds];
    const memberBudget = clampNumber(Number(config.warmupMemberBudget) || 0, 0, 100000);
    const timeoutMs = clampNumber(Number(config.warmupTimeoutMs) || 4000, 500, 20000);

    warmupController = controller;
    patchWarmup({
        active: true,
        startedAt: Date.now(),
        status: `Queueing ${plural(guildIds.length, "selected server")} for cache hydration.`,
        progress: null,
    });
    syncWarmupTask();

    void (async () => {
        try {
            const results: GuildHydrationSnapshot[] = [];

            for (const [index, guildId] of guildIds.entries()) {
                const targetCount = getGuildMemberCount(guildId);
                const guildLabel = GuildStore.getGuild(guildId)?.name ?? guildId;

                const result = await hydrateGuildMemberCache(guildId, {
                    ownerId,
                    forceRefresh: true,
                    maxWaitMs: targetCount != null ? 0 : timeoutMs,
                    memberBudget,
                    targetCount,
                    continueUntilTarget: targetCount != null,
                    controller,
                    onProgress: progress => {
                        if (warmupController !== controller) return;

                        patchWarmup({
                            status: `${guildLabel} / ${progress.finalCount}${targetCount != null ? `/${targetCount}` : ""} indexed`,
                            progress: {
                                guildId: progress.guildId,
                                guildLabel,
                                guildIndex: index + 1,
                                totalGuilds: guildIds.length,
                                indexedCount: progress.finalCount,
                                targetCount,
                                remainingCount: targetCount != null ? Math.max(targetCount - progress.finalCount, 0) : null,
                                delta: progress.delta,
                                chunksSeen: progress.chunksSeen,
                                state: progress.state,
                            },
                        });
                        syncWarmupTask();
                    },
                });

                results.push(result);
                if (controller.cancelled) break;
            }

            if (warmupController !== controller) return;

            if (controller.cancelled) {
                patchWarmup(warmup => ({
                    status: "Manual cache warmup cancelled.",
                    progress: warmup.progress ? { ...warmup.progress, state: "cancelled" } : null,
                }));
                showToast("Manual cache warmup cancelled.", "default");
                return;
            }

            const completedGuilds = results.filter(result => !result.cancelled).length;
            const hydratedMembers = results.reduce((total, result) => total + Math.max(0, result.delta), 0);
            const meaningful = hydratedMembers > 0;
            const last = results.at(-1);

            if (last) {
                const targetCount = getGuildMemberCount(last.guildId);

                patchWarmup({
                    status: meaningful
                        ? `Hydrated ${plural(hydratedMembers, "additional member")} across ${plural(completedGuilds, "server")}.`
                        : "Discord did not add any members to the local cache for the selected servers.",
                    progress: {
                        guildId: last.guildId,
                        guildLabel: GuildStore.getGuild(last.guildId)?.name ?? last.guildId,
                        guildIndex: completedGuilds,
                        totalGuilds: guildIds.length,
                        indexedCount: last.finalCount,
                        targetCount,
                        remainingCount: targetCount != null ? Math.max(targetCount - last.finalCount, 0) : null,
                        delta: last.delta,
                        chunksSeen: last.chunksSeen,
                        state: meaningful ? "completed" : "failed",
                    },
                });
            }

            if (meaningful) {
                showToast(`Cache warmup finished for ${plural(completedGuilds, "server")} with ${plural(hydratedMembers, "additional member")} hydrated.`, "success");
            } else {
                showToast("Manual cache warmup finished without adding any members to the local cache.", "critical");
            }
        } catch (error) {
            if (warmupController !== controller) return;

            const message = error instanceof Error ? error.message : "Manual cache warmup failed.";
            patchWarmup(warmup => ({
                status: message,
                progress: warmup.progress ? { ...warmup.progress, state: "failed" } : null,
            }));
            showToast(message, "critical");
        } finally {
            if (warmupController === controller) {
                warmupController = null;
                finishWarmup();
            }
        }
    })();

    return true;
}