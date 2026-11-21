/*
 * TrashCord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import * as DataStore from "@api/DataStore";
import { React } from "@webpack/common";

import type { MutualScannerConfig, MutualScannerData, MutualScannerMatch, MutualScannerRun, MutualScannerRunStats } from "./types";

const STORAGE_PREFIX = "kamidere-mutual-scanner:";
const MAX_RUN_HISTORY = 12;
const cache = new Map<string, MutualScannerData>();
const listeners = new Set<() => void>();

const DEFAULT_CONFIG: MutualScannerConfig = {
    selectedGuildIds: [],
    requestDelayMs: 650,
    includeBots: false,
    skipExistingFriends: false,
    maxMembersPerGuild: 0,
    warmMemberCacheBeforeScan: true,
    warmupTimeoutMs: 4000,
    warmupMemberBudget: 0,
};

const EMPTY_STATS: MutualScannerRunStats = {
    guildCount: 0,
    candidateCount: 0,
    scannedCount: 0,
    matchedCount: 0,
    skippedBots: 0,
    skippedExistingFriends: 0,
    profileErrors: 0,
    countOnlyMatches: 0,
};

const byLabel = (left: string, right: string) => left.localeCompare(right);

function cloneConfig(config?: Partial<MutualScannerConfig>): MutualScannerConfig {
    return {
        selectedGuildIds: Array.from(new Set(config?.selectedGuildIds ?? DEFAULT_CONFIG.selectedGuildIds)),
        requestDelayMs: config?.requestDelayMs ?? DEFAULT_CONFIG.requestDelayMs,
        includeBots: config?.includeBots ?? DEFAULT_CONFIG.includeBots,
        skipExistingFriends: config?.skipExistingFriends ?? DEFAULT_CONFIG.skipExistingFriends,
        maxMembersPerGuild: config?.maxMembersPerGuild ?? DEFAULT_CONFIG.maxMembersPerGuild,
        warmMemberCacheBeforeScan: config?.warmMemberCacheBeforeScan ?? DEFAULT_CONFIG.warmMemberCacheBeforeScan,
        warmupTimeoutMs: config?.warmupTimeoutMs ?? DEFAULT_CONFIG.warmupTimeoutMs,
        warmupMemberBudget: config?.warmupMemberBudget ?? DEFAULT_CONFIG.warmupMemberBudget,
    };
}

function normalizeMatch(match: MutualScannerMatch): MutualScannerMatch {
    return {
        ...match,
        guildIds: Array.from(new Set(match.guildIds)),
        guildNames: Array.from(new Set(match.guildNames)).sort(byLabel),
        mutualFriendLabels: Array.from(new Set(match.mutualFriendLabels ?? [])).sort(byLabel),
        matchSource: match.matchSource ?? "count",
    };
}

function normalizeRun(run: MutualScannerRun): MutualScannerRun {
    return {
        ...run,
        configSnapshot: cloneConfig(run.configSnapshot),
        stats: { ...EMPTY_STATS, ...run.stats },
        matches: run.matches.map(normalizeMatch).sort((left, right) =>
            byLabel(left.label, right.label) || byLabel(left.userId, right.userId),
        ),
    };
}

function normalizeData(data?: Partial<MutualScannerData> | null): MutualScannerData {
    return {
        config: cloneConfig(data?.config),
        runs: (data?.runs ?? [])
            .map(normalizeRun)
            .sort((left, right) => right.startedAt - left.startedAt)
            .slice(0, MAX_RUN_HISTORY),
    };
}

const EMPTY_DATA = normalizeData();

const getStorageKey = (userId: string) => `${STORAGE_PREFIX}${userId}`;
const emit = () => listeners.forEach(listener => listener());

function subscribe(listener: () => void) {
    listeners.add(listener);
    return () => void listeners.delete(listener);
}

export async function getMutualScannerData(userId: string | null) {
    if (!userId) return EMPTY_DATA;

    const cached = cache.get(userId);
    if (cached) return cached;

    const data = normalizeData(await DataStore.get<MutualScannerData>(getStorageKey(userId)));
    if (!cache.has(userId)) {
        cache.set(userId, data);
        emit();
    }

    return cache.get(userId)!;
}

async function update(userId: string | null, updater: (current: MutualScannerData) => MutualScannerData) {
    if (!userId) return;

    const next = updater(await getMutualScannerData(userId));
    cache.set(userId, next);
    emit();
    await DataStore.set(getStorageKey(userId), next);
}

export function updateMutualScannerConfig(userId: string | null, patch: Partial<MutualScannerConfig>) {
    return update(userId, current => ({ ...current, config: cloneConfig({ ...current.config, ...patch }) }));
}

export function addMutualScannerRun(userId: string | null, run: MutualScannerRun) {
    return update(userId, current => ({
        ...current,
        runs: [normalizeRun(run), ...current.runs.filter(existing => existing.id !== run.id)].slice(0, MAX_RUN_HISTORY),
    }));
}

export function removeMutualScannerRun(userId: string | null, runId: string) {
    return update(userId, current => ({ ...current, runs: current.runs.filter(run => run.id !== runId) }));
}

export function clearMutualScannerRuns(userId: string | null) {
    return update(userId, current => ({ ...current, runs: [] }));
}

export function useMutualScannerData(userId: string | null) {
    const data = React.useSyncExternalStore(subscribe, () => (userId && cache.get(userId)) || EMPTY_DATA);

    React.useEffect(() => {
        void getMutualScannerData(userId);
    }, [userId]);

    return [data, userId !== null && data === EMPTY_DATA] as const;
}