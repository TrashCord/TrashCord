/*
 * TrashCord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import * as DataStore from "@api/DataStore";
import { sleep } from "@utils/misc";
import { findByPropsLazy } from "@webpack";
import { FluxDispatcher, GuildMemberStore, SnowflakeUtils, UserStore } from "@webpack/common";

import type { MutualScannerController } from "./types";

const GuildActions = findByPropsLazy("requestMembers", "requestMembersById") as {
    requestMembers?: (guildId: string, query?: string, limit?: number, includePresences?: boolean) => void;
};

const STORAGE_PREFIX = "kamidere-hydration-index:v1:";
const INDEX_TTL_MS = 3 * 24 * 60 * 60 * 1000;
const QUERY_CHARS = "abcdefghijklmnopqrstuvwxyz0123456789_.-";
const ROOT_QUERIES = ["", ...QUERY_CHARS];
const QUERY_LIMIT = 100;
const QUERY_MAX_DEPTH = 3;
const MAX_STALLED_PASSES = 2;
const PROBE_IDLE_MS = 1000;
const PROBE_GAP_MS = 140;

export interface GuildHydrationSnapshot {
    guildId: string;
    ownerId: string | null;
    memberIds: string[];
    initialCount: number;
    finalCount: number;
    delta: number;
    chunksSeen: number;
    warmedAt: number;
    finishedAt: number;
    expiresAt: number;
    timedOut: boolean;
    budgetReached: boolean;
    cancelled: boolean;
}

export interface GuildHydrationProgress {
    guildId: string;
    finalCount: number;
    delta: number;
    chunksSeen: number;
    state: "running" | "completed" | "cancelled" | "cache";
}

export interface GuildHydrationOptions {
    ownerId?: string | null;
    forceRefresh?: boolean;
    controller?: MutualScannerController;
    maxWaitMs?: number;
    memberBudget?: number;
    targetCount?: number | null;
    continueUntilTarget?: boolean;
    onProgress?: (progress: GuildHydrationProgress) => void;
}

interface Chunk {
    guildId?: string;
    guild_id?: string;
    nonce?: string;
    members?: unknown[];
    chunkIndex?: number;
    chunkCount?: number;
    chunk_index?: number;
    chunk_count?: number;
}

interface Probe {
    nonce: string | null;
    hits: number;
    touch(done: boolean): void;
}

const snapshotCache = new Map<string, GuildHydrationSnapshot>();
const inFlight = new Map<string, Promise<GuildHydrationSnapshot>>();
let queueTail: Promise<unknown> = Promise.resolve();

const getJobKey = (ownerId: string | null, guildId: string) => `${ownerId ?? "anonymous"}:${guildId}`;
const getStorageKey = (ownerId: string | null, guildId: string) => `${STORAGE_PREFIX}${getJobKey(ownerId, guildId)}`;

function getLiveIds(guildId: string): string[] {
    const ids = GuildMemberStore.getMemberIds(guildId);
    if (Array.isArray(ids) && ids.length > 0) return ids;

    const members = GuildMemberStore.getMembers(guildId);
    return Array.isArray(members) ? members.map(member => member.userId) : [];
}

function isLastChunk(chunk: Chunk) {
    const index = chunk.chunkIndex ?? chunk.chunk_index;
    const count = chunk.chunkCount ?? chunk.chunk_count;
    return typeof index === "number" && typeof count === "number" && index + 1 >= count;
}

function isReusable(snapshot: GuildHydrationSnapshot) {
    return !snapshot.cancelled && !snapshot.timedOut && (snapshot.chunksSeen > 0 || snapshot.finalCount > snapshot.initialCount);
}

function enqueue<T>(task: () => Promise<T>) {
    const run = queueTail.then(task);
    queueTail = run.catch(() => null);
    return run;
}

async function deleteSnapshot(ownerId: string | null, guildId: string) {
    snapshotCache.delete(getJobKey(ownerId, guildId));
    await DataStore.del(getStorageKey(ownerId, guildId));
}

async function loadSnapshot(ownerId: string | null, guildId: string) {
    if (!ownerId) return null;

    const key = getJobKey(ownerId, guildId);
    const snapshot = snapshotCache.get(key) ?? await DataStore.get<GuildHydrationSnapshot>(getStorageKey(ownerId, guildId));
    if (!snapshot) return null;

    if (snapshot.expiresAt <= Date.now()) {
        void deleteSnapshot(ownerId, guildId);
        return null;
    }

    snapshotCache.set(key, snapshot);
    return isReusable(snapshot) ? snapshot : null;
}

async function persistSnapshot(snapshot: GuildHydrationSnapshot) {
    if (!snapshot.ownerId || UserStore.getCurrentUser()?.id !== snapshot.ownerId) return;

    snapshotCache.set(getJobKey(snapshot.ownerId, snapshot.guildId), snapshot);
    await DataStore.set(getStorageKey(snapshot.ownerId, snapshot.guildId), snapshot);
}

async function getOwnerKeys(ownerId: string) {
    const prefix = `${STORAGE_PREFIX}${ownerId}:`;
    const keys = await DataStore.keys<string>();
    return keys.filter((key): key is string => typeof key === "string" && key.startsWith(prefix));
}

export function createGuildHydrationController(): MutualScannerController {
    const controller: MutualScannerController = {
        cancelled: false,
        cancel() {
            controller.cancelled = true;
            controller.onCancel?.();
        },
    };

    return controller;
}

export async function getHydratedGuildMemberIds(ownerId: string | null, guildId: string) {
    const liveIds = getLiveIds(guildId);
    const snapshot = await loadSnapshot(ownerId, guildId);
    return snapshot ? Array.from(new Set([...snapshot.memberIds, ...liveIds])) : liveIds;
}

export async function listHydratedGuildSnapshots(ownerId: string | null) {
    if (!ownerId) return [] as GuildHydrationSnapshot[];

    const now = Date.now();
    const snapshots = await Promise.all((await getOwnerKeys(ownerId)).map(async key => {
        const snapshot = await DataStore.get<GuildHydrationSnapshot>(key);
        if (!snapshot) return null;

        if (snapshot.expiresAt <= now) {
            void DataStore.del(key);
            return null;
        }

        return { ...snapshot, memberIds: [] } as GuildHydrationSnapshot;
    }));

    return snapshots
        .filter((snapshot): snapshot is GuildHydrationSnapshot => snapshot !== null)
        .sort((left, right) => right.warmedAt - left.warmedAt);
}

export async function clearHydratedGuildSnapshot(ownerId: string | null, guildId: string) {
    if (ownerId) await deleteSnapshot(ownerId, guildId);
}

export async function clearHydratedGuildSnapshots(ownerId: string | null) {
    if (!ownerId) return;

    for (const key of snapshotCache.keys()) {
        if (key.startsWith(`${ownerId}:`)) snapshotCache.delete(key);
    }

    await Promise.all((await getOwnerKeys(ownerId)).map(key => DataStore.del(key)));
}

async function warmup(guildId: string, ownerId: string | null, options: GuildHydrationOptions): Promise<GuildHydrationSnapshot> {
    const { controller, onProgress } = options;
    const startedAt = Date.now();
    const initialCount = getLiveIds(guildId).length;
    const maxWaitMs = options.maxWaitMs ?? 4000;
    const memberBudget = Math.max(0, options.memberBudget ?? 0);
    const target = options.continueUntilTarget === true && options.targetCount != null ? options.targetCount : null;

    if (!options.forceRefresh) {
        const cached = await loadSnapshot(ownerId, guildId);
        if (cached) {
            onProgress?.({ guildId, finalCount: cached.finalCount, delta: cached.delta, chunksSeen: cached.chunksSeen, state: "cache" });
            return cached;
        }
    }

    let lastCount = initialCount;
    let chunksSeen = 0;
    let timedOut = false;
    let budgetReached = false;
    let active: Probe | null = null;

    const emitProgress = (state: GuildHydrationProgress["state"]) =>
        onProgress?.({ guildId, finalCount: lastCount, delta: lastCount - initialCount, chunksSeen, state });

    const dispatch = (query: string, nonce: string) => {
        if (!query && typeof GuildActions?.requestMembers === "function") {
            GuildActions.requestMembers(guildId, "", 0, false);
            return;
        }

        FluxDispatcher.dispatch({
            type: "GUILD_MEMBERS_REQUEST",
            guildId,
            guildIds: [guildId],
            query,
            limit: query ? QUERY_LIMIT : 0,
            presences: false,
            includePresences: false,
            nonce,
        });
    };

    const runProbe = (query: string) => new Promise<number>(resolve => {
        const nonce = SnowflakeUtils.fromTimestamp(Date.now());
        let settled = false;
        let timer: ReturnType<typeof setTimeout> | undefined;

        const finish = () => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            if (controller) controller.onCancel = undefined;
            if (active === probe) active = null;
            resolve(probe.hits);
        };

        const probe: Probe = {
            nonce: query ? nonce : null,
            hits: 0,
            touch(done) {
                if (settled) return;
                clearTimeout(timer);
                if (done) finish();
                else timer = setTimeout(finish, PROBE_IDLE_MS);
            },
        };

        active = probe;
        if (controller) controller.onCancel = finish;
        timer = setTimeout(finish, PROBE_IDLE_MS);

        try {
            dispatch(query, nonce);
        } catch {
            finish();
        }
    });

    const onChunks = (chunks: Chunk[]) => {
        const probe = active;
        if (!probe) return;

        for (const chunk of chunks) {
            const chunkGuildId = chunk.guildId ?? chunk.guild_id;
            if (chunkGuildId != null && chunkGuildId !== guildId) continue;
            if (probe.nonce && chunk.nonce && chunk.nonce !== probe.nonce) continue;

            chunksSeen++;
            probe.hits += Array.isArray(chunk.members) ? chunk.members.length : 0;
            probe.touch(isLastChunk(chunk));
        }
    };

    const onChunk = (event: Chunk) => onChunks([event]);
    const onBatch = (event: { chunks?: Chunk[]; }) => onChunks(event?.chunks ?? []);

    FluxDispatcher.subscribe("GUILD_MEMBERS_CHUNK", onChunk);
    FluxDispatcher.subscribe("GUILD_MEMBERS_CHUNK_BATCH", onBatch);

    try {
        emitProgress("running");

        let passBase = initialCount;
        let stalled = 0;
        let finished = false;

        while (!finished) {
            const queue = [...ROOT_QUERIES];
            const queued = new Set(queue);

            for (let index = 0; index < queue.length; index++) {
                if (controller?.cancelled) {
                    finished = true;
                    break;
                }

                if (maxWaitMs > 0 && Date.now() - startedAt >= maxWaitMs) {
                    timedOut = true;
                    finished = true;
                    break;
                }

                if (index > 0) await sleep(PROBE_GAP_MS);

                const query = queue[index];
                const hits = await runProbe(query);

                lastCount = Math.max(lastCount, getLiveIds(guildId).length);
                if (memberBudget > 0 && lastCount - initialCount >= memberBudget) budgetReached = true;
                emitProgress("running");

                if (budgetReached || (target != null && lastCount >= target)) {
                    finished = true;
                    break;
                }

                if (query && query.length < QUERY_MAX_DEPTH && hits >= QUERY_LIMIT) {
                    for (const char of QUERY_CHARS) {
                        const next = query + char;
                        if (queued.has(next)) continue;
                        queued.add(next);
                        queue.push(next);
                    }
                }
            }

            if (finished || target == null || lastCount >= target) break;

            if (lastCount > passBase) {
                stalled = 0;
            } else if (++stalled >= MAX_STALLED_PASSES) {
                timedOut = true;
                break;
            }

            passBase = lastCount;
        }
    } finally {
        FluxDispatcher.unsubscribe("GUILD_MEMBERS_CHUNK", onChunk);
        FluxDispatcher.unsubscribe("GUILD_MEMBERS_CHUNK_BATCH", onBatch);
        if (controller) controller.onCancel = undefined;
    }

    const memberIds = getLiveIds(guildId).slice();
    const finishedAt = Date.now();
    lastCount = memberIds.length;

    const snapshot: GuildHydrationSnapshot = {
        guildId,
        ownerId,
        memberIds,
        initialCount,
        finalCount: memberIds.length,
        delta: memberIds.length - initialCount,
        chunksSeen,
        warmedAt: startedAt,
        finishedAt,
        expiresAt: finishedAt + INDEX_TTL_MS,
        timedOut,
        budgetReached,
        cancelled: Boolean(controller?.cancelled),
    };

    if (snapshot.cancelled) {
        emitProgress("cancelled");
        return snapshot;
    }

    await persistSnapshot(snapshot);
    emitProgress("completed");
    return snapshot;
}

export function hydrateGuildMemberCache(guildId: string, options: GuildHydrationOptions = {}) {
    const ownerId = options.ownerId ?? null;
    const key = getJobKey(ownerId, guildId);
    const existing = inFlight.get(key);
    if (existing) return existing;

    const promise = enqueue(() => warmup(guildId, ownerId, options)).finally(() => inFlight.delete(key));
    inFlight.set(key, promise);
    return promise;
}