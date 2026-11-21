/*
 * TrashCord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { fetchUserProfile } from "@utils/discord";
import { sleep } from "@utils/misc";
import type { ToastVariant, User } from "@vencord/discord-types";
import { GuildMemberCountStore, GuildStore, IconUtils, RelationshipStore, showToast as showDiscordToast, UserProfileStore, UserStore } from "@webpack/common";

import { getHydratedGuildMemberIds, type GuildHydrationSnapshot, hydrateGuildMemberCache } from "./memberHydrator";
import type {
    MutualScannerConfig,
    MutualScannerController,
    MutualScannerExecutionResult,
    MutualScannerGuildOption,
    MutualScannerMatch,
    MutualScannerProgress,
    MutualScannerRun,
    MutualScannerRunStats,
    MutualScannerRunStatus,
} from "./types";

interface RawIdentity {
    avatar?: string | null;
    username?: string;
    globalName?: string;
    global_name?: string;
    bot?: boolean;
}

export type HydrationSnapshotQuality = "complete" | "partial" | "stale" | "cancelled";

export interface MutualScannerRunComparison {
    previousRun: MutualScannerRun | null;
    newMatches: MutualScannerMatch[];
    disappearedMatches: MutualScannerMatch[];
    sameMatches: MutualScannerMatch[];
}

let dateFormatter: Intl.DateTimeFormat | undefined;

export function showToast(message: string, variant: ToastVariant) {
    showDiscordToast({ text: message, variant, position: "bottom" });
}

export function clampNumber(value: number, min: number, max: number) {
    return Math.min(max, Math.max(min, value));
}

export function makeLocalId(prefix: string) {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

export function getGuildMemberCount(guildId: string) {
    return GuildMemberCountStore.getMemberCount(guildId)
        ?? (GuildStore.getGuild(guildId) as { memberCount?: number; } | undefined)?.memberCount
        ?? null;
}

function buildIdentityFromUser(userId: string, user?: RawIdentity | null) {
    const displayName = user?.globalName || user?.global_name || user?.username || userId;
    const avatarUrl = user?.avatar
        ? IconUtils.getUserAvatarURL({ id: userId, avatar: user.avatar } as User, true, 80)
        : IconUtils.getDefaultAvatarURL(userId);

    return {
        label: displayName,
        username: user?.username,
        details: user?.username && user.username !== displayName ? `@${user.username}` : `User ID ${userId}`,
        avatarUrl,
        isBot: Boolean(user?.bot),
    };
}

export function formatDateTime(timestamp: number) {
    dateFormatter ??= new Intl.DateTimeFormat(undefined, {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
    });

    return dateFormatter.format(new Date(timestamp));
}

export function formatDurationMs(durationMs: number) {
    if (durationMs < 1000) return `${durationMs}ms`;

    const totalSeconds = Math.round(durationMs / 1000);
    if (totalSeconds < 60) return `${totalSeconds}s`;

    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return seconds ? `${minutes}m ${seconds}s` : `${minutes}m`;
}

export function estimateScanRemainingMs(
    progress: MutualScannerProgress | null,
    startedAt: number | null,
    requestDelayMs: number,
) {
    if (!progress || !startedAt) return null;
    if (progress.phase === "warming" || progress.phase === "collecting") return null;
    if (progress.totalCandidates <= 0) return null;

    const remaining = Math.max(0, progress.totalCandidates - progress.scannedCount);
    if (remaining === 0) return 0;

    const observed = progress.scannedCount > 0 ? (Date.now() - startedAt) / progress.scannedCount : 0;
    const baseline = requestDelayMs > 0 ? requestDelayMs + 250 : 850;
    return Math.round(remaining * Math.max(baseline, observed));
}

export function buildGuildOptions(): MutualScannerGuildOption[] {
    return GuildStore.getGuildsArray()
        .map(guild => ({
            id: guild.id,
            label: guild.name,
            memberCount: getGuildMemberCount(guild.id),
            iconUrl: guild.icon
                ? IconUtils.getGuildIconURL({ id: guild.id, icon: guild.icon, size: 80, canAnimate: true })
                : undefined,
        }))
        .sort((left, right) => left.label.localeCompare(right.label) || left.id.localeCompare(right.id));
}

export function areGuildOptionsEqual(left: MutualScannerGuildOption[], right: MutualScannerGuildOption[]) {
    if (left.length !== right.length) return false;

    for (let index = 0; index < left.length; index++) {
        const a = left[index];
        const b = right[index];
        if (a.id !== b.id || a.label !== b.label || a.memberCount !== b.memberCount || a.iconUrl !== b.iconUrl) return false;
    }

    return true;
}

export function getHydrationSnapshotQuality(
    snapshot: GuildHydrationSnapshot,
    targetCount: number | null,
    now = Date.now(),
): HydrationSnapshotQuality {
    if (snapshot.cancelled) return "cancelled";

    if (snapshot.timedOut || snapshot.budgetReached || (targetCount != null && snapshot.finalCount < targetCount)) {
        return "partial";
    }

    const lifetimeMs = Math.max(1, snapshot.expiresAt - snapshot.warmedAt);
    const staleThresholdMs = Math.min(12 * 60 * 60 * 1000, Math.round(lifetimeMs * 0.2));
    return snapshot.expiresAt - now <= staleThresholdMs ? "stale" : "complete";
}

export function getHydrationSnapshotQualityLabel(quality: HydrationSnapshotQuality) {
    switch (quality) {
        case "cancelled": return "Cancelled";
        case "partial": return "Partial";
        case "stale": return "Stale";
        default: return "Complete";
    }
}

export function isHydrationSnapshotWeak(snapshot: GuildHydrationSnapshot | null | undefined, targetCount: number | null) {
    return !snapshot || getHydrationSnapshotQuality(snapshot, targetCount) !== "complete";
}

function getScopeGuildIds(run: MutualScannerRun) {
    return Array.from(new Set(run.configSnapshot.selectedGuildIds)).sort();
}

export function isComparableMutualScannerRun(left: MutualScannerRun, right: MutualScannerRun) {
    const leftIds = getScopeGuildIds(left);
    const rightIds = getScopeGuildIds(right);

    return leftIds.length === rightIds.length
        && leftIds.every((guildId, index) => guildId === rightIds[index])
        && left.configSnapshot.includeBots === right.configSnapshot.includeBots
        && left.configSnapshot.skipExistingFriends === right.configSnapshot.skipExistingFriends
        && left.configSnapshot.maxMembersPerGuild === right.configSnapshot.maxMembersPerGuild;
}

export function buildMutualScannerRunComparison(
    currentRun: MutualScannerRun,
    previousRun: MutualScannerRun | null,
): MutualScannerRunComparison {
    if (!previousRun) return { previousRun: null, newMatches: [], disappearedMatches: [], sameMatches: [] };

    const previousIds = new Set(previousRun.matches.map(match => match.userId));
    const currentIds = new Set(currentRun.matches.map(match => match.userId));

    return {
        previousRun,
        newMatches: currentRun.matches.filter(match => !previousIds.has(match.userId)),
        sameMatches: currentRun.matches.filter(match => previousIds.has(match.userId)),
        disappearedMatches: previousRun.matches.filter(match => !currentIds.has(match.userId)),
    };
}

function emitProgress(
    stats: MutualScannerRunStats,
    totalCandidates: number,
    phase: MutualScannerProgress["phase"],
    onProgress?: (progress: MutualScannerProgress) => void,
    currentUserId?: string,
    currentLabel?: string,
) {
    onProgress?.({
        phase,
        totalCandidates,
        scannedCount: stats.scannedCount,
        matchedCount: stats.matchedCount,
        skippedBots: stats.skippedBots,
        skippedExistingFriends: stats.skippedExistingFriends,
        profileErrors: stats.profileErrors,
        countOnlyMatches: stats.countOnlyMatches,
        currentUserId,
        currentLabel,
    });
}

function toErrorMessage(error: unknown) {
    if (error instanceof Error && error.message) return error.message;
    if (typeof error === "string" && error.trim()) return error;
    return "Unexpected scanner failure.";
}

async function collectCandidates(config: MutualScannerConfig, ownerId: string | null) {
    const candidates = new Map<string, string[]>();
    const selfId = UserStore.getCurrentUser()?.id;

    for (const guildId of config.selectedGuildIds) {
        const ids = await getHydratedGuildMemberIds(ownerId, guildId);
        const limit = config.maxMembersPerGuild > 0 ? Math.min(ids.length, config.maxMembersPerGuild) : ids.length;

        for (let index = 0; index < limit; index++) {
            const userId = ids[index];
            if (!userId || userId === selfId) continue;

            const guildIds = candidates.get(userId);
            if (guildIds) guildIds.push(guildId);
            else candidates.set(userId, [guildId]);
        }
    }

    return candidates;
}

function buildMatch(
    userId: string,
    guildIds: string[],
    mutualFriends: Array<{ user?: RawIdentity | null; key: string; }> | undefined,
    matchSource: "list" | "count",
): MutualScannerMatch {
    const identity = buildIdentityFromUser(userId, UserStore.getUser(userId) as RawIdentity | undefined);

    return {
        userId,
        label: identity.label,
        username: identity.username,
        details: identity.details,
        avatarUrl: identity.avatarUrl,
        guildIds,
        guildNames: guildIds.map(guildId => GuildStore.getGuild(guildId)?.name ?? guildId).sort((left, right) => left.localeCompare(right)),
        mutualFriendCount: UserProfileStore.getMutualFriendsCount(userId) ?? UserProfileStore.getMutualFriends(userId)?.length ?? 0,
        mutualFriendLabels: Array.isArray(mutualFriends)
            ? mutualFriends
                .map(friend => {
                    const cachedUser = (friend.user ?? UserStore.getUser(friend.key)) as RawIdentity | undefined;
                    return RelationshipStore.getNickname(friend.key) || buildIdentityFromUser(friend.key, cachedUser).label;
                })
                .filter(Boolean)
            : [],
        matchSource,
        matchedAt: Date.now(),
        isExistingFriend: RelationshipStore.isFriend(userId),
        isBot: identity.isBot,
    };
}

export async function executeMutualScan(
    config: MutualScannerConfig,
    options: {
        ownerId?: string | null;
        controller?: MutualScannerController;
        onProgress?: (progress: MutualScannerProgress) => void;
        onMatch?: (match: MutualScannerMatch) => void;
    } = {},
): Promise<MutualScannerExecutionResult> {
    const { controller, onProgress, onMatch } = options;
    const ownerId = options.ownerId ?? UserStore.getCurrentUser()?.id ?? null;
    const matches: MutualScannerMatch[] = [];
    const stats: MutualScannerRunStats = {
        guildCount: config.selectedGuildIds.length,
        candidateCount: 0,
        scannedCount: 0,
        matchedCount: 0,
        skippedBots: 0,
        skippedExistingFriends: 0,
        profileErrors: 0,
        countOnlyMatches: 0,
    };

    const finish = (status: MutualScannerRunStatus, error?: string): MutualScannerExecutionResult => ({
        status,
        finishedAt: Date.now(),
        stats: { ...stats, matchedCount: matches.length },
        matches,
        error,
    });

    if (config.warmMemberCacheBeforeScan) {
        const total = config.selectedGuildIds.length;

        for (let index = 0; index < total; index++) {
            const guildId = config.selectedGuildIds[index];
            const guildName = GuildStore.getGuild(guildId)?.name ?? guildId;

            emitProgress(stats, 0, "warming", onProgress, guildId, `${guildName} (${index + 1}/${total})`);

            const hydration = await hydrateGuildMemberCache(guildId, {
                ownerId,
                controller,
                maxWaitMs: config.warmupTimeoutMs,
                memberBudget: config.warmupMemberBudget,
                onProgress: progress => emitProgress(
                    stats,
                    0,
                    "warming",
                    onProgress,
                    guildId,
                    `${guildName} ${progress.state === "cache" ? "cached index" : `+${progress.delta}`}`,
                ),
            });

            if (hydration.cancelled || controller?.cancelled) return finish("cancelled");
        }
    }

    const candidates = await collectCandidates(config, ownerId);
    const total = candidates.size;

    stats.candidateCount = total;
    emitProgress(stats, total, "collecting", onProgress);

    try {
        for (const [candidateId, guildIds] of candidates) {
            if (controller?.cancelled) return finish("cancelled");

            const cachedUser = UserStore.getUser(candidateId) as RawIdentity | undefined;

            if (config.skipExistingFriends && RelationshipStore.isFriend(candidateId)) {
                stats.skippedExistingFriends++;
                stats.scannedCount++;
                continue;
            }

            if (!config.includeBots && cachedUser?.bot) {
                stats.skippedBots++;
                stats.scannedCount++;
                continue;
            }

            emitProgress(stats, total, "scanning", onProgress, candidateId, buildIdentityFromUser(candidateId, cachedUser).label);

            let profileFailed = false;

            try {
                await fetchUserProfile(candidateId, {
                    guild_id: guildIds[0],
                    with_mutual_guilds: true,
                    with_mutual_friends_count: true,
                }, false);
            } catch {
                profileFailed = true;
            }

            if (profileFailed) {
                stats.profileErrors++;
            } else if (!config.includeBots && (UserStore.getUser(candidateId) as RawIdentity | undefined)?.bot) {
                stats.skippedBots++;
            } else {
                const mutualFriends = UserProfileStore.getMutualFriends(candidateId);
                const mutualFriendCount = UserProfileStore.getMutualFriendsCount(candidateId);

                if (mutualFriends?.length || (mutualFriendCount ?? 0) > 0) {
                    const matchSource = mutualFriends?.length ? "list" : "count";
                    if (matchSource === "count") stats.countOnlyMatches++;

                    const match = buildMatch(candidateId, guildIds, mutualFriends, matchSource);
                    matches.push(match);
                    stats.matchedCount = matches.length;
                    onMatch?.(match);
                }
            }

            stats.scannedCount++;
            if (config.requestDelayMs > 0) await sleep(config.requestDelayMs);
        }

        emitProgress(stats, total, "finishing", onProgress);
        return finish("completed");
    } catch (error) {
        return finish("failed", toErrorMessage(error));
    }
}