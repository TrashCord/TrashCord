/*
 * TrashCord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Button, TextButton } from "@components/Button";
import { Card } from "@components/Card";
import { Heading } from "@components/Heading";
import { ClockIcon, CloudUploadIcon, FolderIcon, LinkIcon, LogIcon, MagnifyingGlassIcon, RestartIcon } from "@components/Icons";
import { Notice } from "@components/Notice";
import { Paragraph } from "@components/Paragraph";
import { SettingsTab, wrapTab } from "@components/settings";
import { SpecialCard } from "@components/settings/SpecialCard";
import { Switch } from "@components/Switch";
import { classNameFactory } from "@utils/css";
import { openUserProfile } from "@utils/discord";
import { Margins } from "@utils/margins";
import { Alerts, GuildMemberCountStore, GuildStore, React, UserStore, useStateFromStores } from "@webpack/common";

import { BRAND_ICON_DATA_URL, BRAND_NAME } from "../_kamidereCompat/branding";
import {
    clearHydratedGuildSnapshot,
    clearHydratedGuildSnapshots,
    type GuildHydrationSnapshot,
    listHydratedGuildSnapshots,
} from "./memberHydrator";
import {
    cancelMutualScannerRun,
    cancelMutualScannerWarmup,
    type MutualScannerWarmupProgressState,
    startMutualScannerRun,
    startMutualScannerWarmup,
    useMutualScannerRuntime,
} from "./runtime";
import {
    clearMutualScannerRuns,
    removeMutualScannerRun,
    updateMutualScannerConfig,
    useMutualScannerData,
} from "./store";
import type {
    MutualScannerConfig,
    MutualScannerExecutionResult,
    MutualScannerGuildOption,
    MutualScannerMatch,
    MutualScannerProgress,
    MutualScannerRun,
} from "./types";
import {
    areGuildOptionsEqual,
    buildGuildOptions,
    buildMutualScannerRunComparison,
    clampNumber,
    formatDateTime,
    formatDurationMs,
    getHydrationSnapshotQuality,
    getHydrationSnapshotQualityLabel,
    isComparableMutualScannerRun,
    isHydrationSnapshotWeak,
    type MutualScannerRunComparison,
    showToast,
} from "./utils";

const cl = classNameFactory("vc-mutual-scanner-");

const MATCH_PREVIEW = 20;
const LIVE_LIMIT = 30;
const HERO_BACKGROUND = `data:image/svg+xml;utf8,${encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 600"><rect width="1200" height="600" fill="#1a222c"/><circle cx="920" cy="160" r="170" fill="#7ca7d4" opacity=".1"/><circle cx="250" cy="460" r="190" fill="#f0c26f" opacity=".1"/></svg>',
)}`;

type NumericField = "requestDelayMs" | "maxMembersPerGuild" | "warmupTimeoutMs" | "warmupMemberBudget";
type ToggleField = "includeBots" | "skipExistingFriends" | "warmMemberCacheBeforeScan";

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

function formatRelativeWindow(timestamp: number) {
    const seconds = Math.round((timestamp - Date.now()) / 1000);
    if (seconds <= 0) return "expired";
    if (seconds < 60) return `${seconds}s left`;

    const minutes = Math.round(seconds / 60);
    if (minutes < 60) return `${minutes}m left`;

    const hours = Math.round(minutes / 60);
    return hours < 24 ? `${hours}h left` : `${Math.round(hours / 24)}d left`;
}

function formatProgress(progress?: MutualScannerProgress | null) {
    if (!progress) return "Idle";
    if (progress.phase === "warming") return "Loading guild member cache";
    if (progress.phase === "collecting") return "Collecting candidate members";
    if (progress.phase === "finishing") return "Finalizing run";
    return `Scanning ${progress.scannedCount}/${progress.totalCandidates}`;
}

function formatWarmupState(state: MutualScannerWarmupProgressState["state"]) {
    switch (state) {
        case "cache": return "Cached index";
        case "cancelled": return "Cancelled";
        case "failed": return "No chunks";
        case "completed": return "Completed";
        case "queued": return "Queued";
        default: return "Running";
    }
}

function formatDiffNames(matches: MutualScannerMatch[], limit = 3) {
    const labels = matches.slice(0, limit).map(match => match.label).join(", ");
    return matches.length > limit ? `${labels} +${matches.length - limit}` : labels;
}

function buildRunQuery(run: MutualScannerRun) {
    return [
        run.scopeLabel,
        run.status,
        ...run.matches.flatMap(match => [match.label, match.userId, ...match.guildNames]),
    ].join(" ").toLowerCase();
}

function MetricTag({ icon, label, value }: { icon: React.ReactNode; label: string; value: string; }) {
    return (
        <span className={cl("hero-tag")}>
            {icon}
            <span className={cl("hero-tag-value")}>{value}</span>
            <span className={cl("hero-tag-label")}>{label}</span>
        </span>
    );
}

function ScanStatusBanner({
    progress,
    result,
    duration,
}: {
    progress: MutualScannerProgress | null;
    result: MutualScannerExecutionResult | null;
    duration: number;
}) {
    const phase = result
        ? result.status === "completed" ? "success" : result.status === "cancelled" ? "cancelled" : "failure"
        : "running";
    const running = phase === "running";
    const width = !running
        ? 100
        : progress?.totalCandidates
            ? Math.max(8, Math.round((progress.scannedCount / progress.totalCandidates) * 100))
            : progress?.phase === "warming" ? 16 : progress?.phase === "collecting" ? 28 : 12;

    let title = "Preparing scan";
    let subtitle = "Building the next scan stage.";

    if (running && progress) {
        const verb = progress.phase === "warming"
            ? "Hydrating member cache for"
            : progress.phase === "collecting" ? "Collecting candidates from" : "Inspecting";
        title = formatProgress(progress);
        subtitle = progress.currentLabel ? `${verb} ${progress.currentLabel}.` : "Running the mutual scan sequentially.";
    } else if (result?.status === "completed") {
        title = "Scan complete";
        subtitle = `Found ${result.matches.length} match${result.matches.length === 1 ? "" : "es"} after ${plural(result.stats.scannedCount, "scanned profile")} in ${formatDurationMs(duration)}.`;
    } else if (result?.status === "cancelled") {
        title = "Scan cancelled";
        subtitle = `Stopped after ${plural(result.stats.scannedCount, "scanned profile")} and ${result.matches.length} match${result.matches.length === 1 ? "" : "es"}.`;
    } else if (result) {
        title = "Scan failed";
        subtitle = result.error ?? "The scanner could not finish this run.";
    }

    const countOnly = progress?.countOnlyMatches ?? result?.stats.countOnlyMatches ?? 0;

    return (
        <div className={cl("scan-status", phase)}>
            <span className={cl("scan-status-icon")}>{running ? "..." : phase === "failure" ? "ERR" : "OK"}</span>
            <div className={cl("scan-status-body")}>
                <div className={cl("row")}>
                    <Heading tag="h4" className={Margins.reset}>{title}</Heading>
                    <div className={cl("chips")}>
                        <span className={cl("badge", "quiet")}>{progress?.matchedCount ?? result?.stats.matchedCount ?? 0} matches</span>
                        <span className={cl("badge", "quiet")}>{progress?.profileErrors ?? result?.stats.profileErrors ?? 0} errors</span>
                        {countOnly > 0 && <span className={cl("badge", "warn")}>{countOnly} count-only</span>}
                    </div>
                </div>
                <Paragraph className={cl("muted")}>{subtitle}</Paragraph>
                <div className={cl("track")}>
                    <div className={cl("fill")} style={{ width: `${width}%` }} />
                </div>
            </div>
        </div>
    );
}

const MatchRow = React.memo(function MatchRow({ match, compact = false }: { match: MutualScannerMatch; compact?: boolean; }) {
    const extraGuilds = match.guildNames.length - 1;
    const contextLabel = compact && extraGuilds > 0
        ? `Seen in ${match.guildNames[0]} +${extraGuilds}`
        : `Seen in ${match.guildNames.join(", ")}`;
    const labels = match.mutualFriendLabels;
    const mutualsLabel = compact
        ? `${labels[0]}${labels.length > 1 ? ` +${labels.length - 1}` : ""}`
        : labels.join(", ");

    return (
        <Card className={cl("match-card", compact && "match-card-compact")}>
            <div className={cl("row")}>
                <button
                    type="button"
                    className={cl("match-profile")}
                    onClick={() => {
                        void openUserProfile(match.userId).catch(() => showToast("Could not open that profile.", "critical"));
                    }}
                >
                    <img className={cl("avatar")} src={match.avatarUrl} alt="" loading="lazy" decoding="async" />
                    <div className={cl("grow")}>
                        <Heading tag="h4" className={`${Margins.reset} ${cl("ellipsis")}`}>{match.label}</Heading>
                        <Paragraph className={cl("muted", "ellipsis")}>{match.details}</Paragraph>
                    </div>
                </button>

                <div className={cl("chips")}>
                    <span className={cl("badge")}>{match.mutualFriendCount} mutual</span>
                    {match.matchSource === "count" && <span className={cl("badge", "warn")}>{compact ? "Count" : "Count only"}</span>}
                    {match.isExistingFriend && <span className={cl("badge", "quiet")}>Already your friend</span>}
                    {match.isBot && <span className={cl("badge", "quiet")}>Bot</span>}
                </div>
            </div>

            <Paragraph className={cl("muted")}>{contextLabel}</Paragraph>
            {labels.length > 0 && <Paragraph className={cl("muted", "ellipsis")}>Mutuals: {mutualsLabel}</Paragraph>}
        </Card>
    );
});

const RunCard = React.memo(function RunCard({
    run,
    comparison,
    onRemove,
}: {
    run: MutualScannerRun;
    comparison: MutualScannerRunComparison;
    onRemove(runId: string): void;
}) {
    const [expanded, setExpanded] = React.useState(false);
    const shown = expanded ? run.matches : run.matches.slice(0, MATCH_PREVIEW);

    return (
        <Card className={cl("run-card")} defaultPadding>
            <div className={cl("row")}>
                <div className={cl("grow")}>
                    <Heading tag="h4" className={Margins.reset}>{run.scopeLabel}</Heading>
                    <Paragraph className={cl("muted")}>
                        {formatDateTime(run.startedAt)} / {formatDurationMs(Math.max(0, run.finishedAt - run.startedAt))}
                    </Paragraph>
                </div>
                <div className={cl("chips")}>
                    <span className={cl("pill", run.status)}>{run.status}</span>
                    <TextButton variant="danger" onClick={() => onRemove(run.id)}>Del</TextButton>
                </div>
            </div>

            <div className={cl("chips")}>
                <span className={cl("badge")}>{run.stats.matchedCount} matches</span>
                <span className={cl("badge", "quiet")}>{run.stats.scannedCount}/{run.stats.candidateCount} scanned</span>
                <span className={cl("badge", "quiet")}>{run.stats.profileErrors} errors</span>
                {run.stats.countOnlyMatches > 0 && <span className={cl("badge", "warn")}>{run.stats.countOnlyMatches} count</span>}
            </div>

            {comparison.previousRun && (
                <div className={cl("diff")}>
                    <Paragraph className={cl("muted")}>Compared with {formatDateTime(comparison.previousRun.startedAt)}</Paragraph>
                    <div className={cl("chips")}>
                        <span className={cl("badge", "success")}>+{comparison.newMatches.length} new</span>
                        <span className={cl("badge", "quiet")}>{comparison.sameMatches.length} same</span>
                        <span className={cl("badge", "danger")}>-{comparison.disappearedMatches.length} gone</span>
                    </div>
                    {comparison.newMatches.length > 0 && <Paragraph className={cl("muted")}>New: {formatDiffNames(comparison.newMatches)}</Paragraph>}
                    {comparison.disappearedMatches.length > 0 && <Paragraph className={cl("muted")}>Gone: {formatDiffNames(comparison.disappearedMatches)}</Paragraph>}
                </div>
            )}

            {run.error && <Notice.Info>{run.error}</Notice.Info>}

            <div className={cl("list")}>
                {run.matches.length === 0 && (
                    <div className={cl("empty")}>
                        <MagnifyingGlassIcon className={cl("empty-icon")} />
                        <Paragraph className={cl("muted")}>No candidates with mutual friends were found in this scope.</Paragraph>
                    </div>
                )}

                {shown.map(match => <MatchRow key={match.userId} match={match} compact />)}

                {run.matches.length > MATCH_PREVIEW && (
                    <TextButton variant="secondary" onClick={() => setExpanded(value => !value)}>
                        {expanded ? "Show less" : `Show all ${run.matches.length}`}
                    </TextButton>
                )}
            </div>
        </Card>
    );
});

const HydrationCacheRow = React.memo(function HydrationCacheRow({
    snapshot,
    targetCount,
    disabled,
    onRewarm,
    onClear,
}: {
    snapshot: GuildHydrationSnapshot;
    targetCount: number | null;
    disabled: boolean;
    onRewarm(guildId: string): void;
    onClear(guildId: string): void;
}) {
    const quality = getHydrationSnapshotQuality(snapshot, targetCount);
    const tone = quality === "partial" ? "failed" : quality === "cancelled" ? "cancelled" : quality === "stale" ? "running" : "completed";

    return (
        <Card className={cl("run-card")} defaultPadding>
            <div className={cl("row")}>
                <div className={cl("grow")}>
                    <Heading tag="h4" className={Margins.reset}>{GuildStore.getGuild(snapshot.guildId)?.name ?? snapshot.guildId}</Heading>
                    <Paragraph className={cl("muted")}>{formatDateTime(snapshot.warmedAt)} / {formatRelativeWindow(snapshot.expiresAt)}</Paragraph>
                </div>
                <div className={cl("chips")}>
                    <span className={cl("pill", tone)}>{getHydrationSnapshotQualityLabel(quality)}</span>
                    <TextButton variant="secondary" disabled={disabled} onClick={() => onRewarm(snapshot.guildId)}>Rewarm</TextButton>
                    <TextButton variant="danger" onClick={() => onClear(snapshot.guildId)}>Clear</TextButton>
                </div>
            </div>

            <div className={cl("chips")}>
                <span className={cl("badge")}>{snapshot.finalCount} indexed</span>
                {targetCount != null && <span className={cl("badge", "quiet")}>{snapshot.finalCount}/{targetCount} target</span>}
                <span className={cl("badge", "quiet")}>+{snapshot.delta} hydrated</span>
                {snapshot.chunksSeen > 0 && <span className={cl("badge", "quiet")}>{snapshot.chunksSeen} chunks</span>}
                {snapshot.budgetReached && <span className={cl("badge", "warn")}>budget reached</span>}
                {snapshot.timedOut && <span className={cl("badge", "danger")}>timed out</span>}
                {snapshot.cancelled && <span className={cl("badge", "danger")}>cancelled</span>}
            </div>
        </Card>
    );
});

const GuildRow = React.memo(function GuildRow({
    guild,
    selected,
    disabled,
    onToggle,
}: {
    guild: MutualScannerGuildOption;
    selected: boolean;
    disabled: boolean;
    onToggle(guildId: string, enabled: boolean): void;
}) {
    return (
        <Card className={cl("guild-card")}>
            <div className={cl("guild-title")}>
                {guild.iconUrl
                    ? <img className={cl("icon")} src={guild.iconUrl} alt="" loading="lazy" decoding="async" />
                    : <div className={cl("icon", "icon-fallback")}>{guild.label.slice(0, 1)}</div>}
                <div className={cl("grow")}>
                    <Heading tag="h4" className={`${Margins.reset} ${cl("ellipsis")}`}>{guild.label}</Heading>
                    <Paragraph className={cl("muted", "ellipsis")}>{guild.memberCount ?? "?"} members / {guild.id}</Paragraph>
                </div>
            </div>
            <Switch checked={selected} disabled={disabled} onChange={(checked: boolean) => onToggle(guild.id, checked)} />
        </Card>
    );
});

const NumberField = React.memo(function NumberField({
    userId,
    field,
    label,
    value,
    min,
    max,
    disabled,
}: {
    userId: string | null;
    field: NumericField;
    label: string;
    value: number;
    min: number;
    max: number;
    disabled: boolean;
}) {
    return (
        <label className={cl("field")}>
            <span className={cl("field-label")}>{label}</span>
            <input
                key={value}
                className={cl("input")}
                type="number"
                min={min}
                max={max}
                defaultValue={value}
                disabled={disabled}
                onBlur={event => void updateMutualScannerConfig(userId, {
                    [field]: clampNumber(Number(event.currentTarget.value) || 0, min, max),
                } as Partial<MutualScannerConfig>)}
            />
        </label>
    );
});

const ToggleRow = React.memo(function ToggleRow({
    userId,
    field,
    title,
    description,
    checked,
}: {
    userId: string | null;
    field: ToggleField;
    title: string;
    description: string;
    checked: boolean;
}) {
    return (
        <div className={cl("toggle-row")}>
            <div>
                <Heading tag="h4" className={Margins.reset}>{title}</Heading>
                <Paragraph className={cl("muted")}>{description}</Paragraph>
            </div>
            <Switch
                checked={checked}
                onChange={(value: boolean) => void updateMutualScannerConfig(userId, { [field]: value } as Partial<MutualScannerConfig>)}
            />
        </div>
    );
});

const ScopePanel = React.memo(function ScopePanel({
    userId,
    config,
    guilds,
}: {
    userId: string | null;
    config: MutualScannerConfig;
    guilds: MutualScannerGuildOption[];
}) {
    const warmup = useMutualScannerRuntime(current => current.warmup);
    const scanActive = useMutualScannerRuntime(current => current.scan.active);
    const [search, setSearch] = React.useState("");
    const idsRef = React.useRef(config.selectedGuildIds);
    idsRef.current = config.selectedGuildIds;

    const selected = React.useMemo(() => new Set(config.selectedGuildIds), [config.selectedGuildIds]);
    const filtered = React.useMemo(() => {
        const query = search.trim().toLowerCase();
        return query
            ? guilds.filter(guild => guild.label.toLowerCase().includes(query) || guild.id.includes(query))
            : guilds;
    }, [guilds, search]);

    const count = config.selectedGuildIds.length;
    const progress = warmup.progress;
    const warmupPercent = progress?.targetCount
        ? Math.min(100, Math.round((progress.indexedCount / progress.targetCount) * 100))
        : progress?.state === "cache" || progress?.state === "completed" ? 100
            : progress?.state === "queued" ? 10 : progress?.state === "failed" ? 18 : 32;

    const toggle = React.useCallback((guildId: string, enabled: boolean) => {
        const next = new Set(idsRef.current);
        if (enabled) next.add(guildId);
        else next.delete(guildId);
        void updateMutualScannerConfig(userId, { selectedGuildIds: Array.from(next) });
    }, [userId]);

    const triggerWarmup = () => {
        if (warmup.active) {
            cancelMutualScannerWarmup();
            return;
        }

        if (!userId) return;
        if (count === 0) {
            showToast("Select at least one server before warming the cache.", "critical");
            return;
        }

        if (!startMutualScannerWarmup(userId, config)) showToast("Manual cache warmup could not start.", "critical");
    };

    return (
        <Card className={cl("panel")} defaultPadding>
            <div className={cl("row", "head")}>
                <div className={cl("grow")}>
                    <Heading tag="h4">Server Scope</Heading>
                    <Paragraph className={cl("muted")}>Pick the servers whose members should be checked for any mutual friend relationship with your account.</Paragraph>
                </div>
                <div className={cl("chips")}>
                    <TextButton variant="secondary" disabled={scanActive || warmup.active || filtered.length === 0} onClick={() => void updateMutualScannerConfig(userId, { selectedGuildIds: filtered.map(guild => guild.id) })}>Select visible</TextButton>
                    <TextButton variant="secondary" disabled={scanActive || warmup.active || count === 0} onClick={() => void updateMutualScannerConfig(userId, { selectedGuildIds: [] })}>Clear</TextButton>
                </div>
            </div>

            <div className={cl("toolbar")}>
                <label className={cl("search")}>
                    <MagnifyingGlassIcon className={cl("empty-icon")} width={16} height={16} />
                    <input
                        className={cl("search-input")}
                        type="text"
                        value={search}
                        placeholder="Filter servers by name or id"
                        onChange={event => setSearch(event.currentTarget.value)}
                        disabled={scanActive}
                        spellCheck={false}
                    />
                </label>

                <Button
                    variant={warmup.active ? "overlayPrimary" : "secondary"}
                    size="iconOnly"
                    title={warmup.active ? "Cancel manual cache warmup" : "Warm selected servers into cache"}
                    aria-label={warmup.active ? "Cancel manual cache warmup" : "Warm selected servers into cache"}
                    disabled={!warmup.active && (scanActive || count === 0)}
                    onClick={triggerWarmup}
                >
                    {warmup.active
                        ? <RestartIcon width={16} height={16} />
                        : <CloudUploadIcon width={16} height={16} />}
                </Button>
            </div>

            <div className={cl("row", "footer")}>
                <Paragraph className={cl("muted", "grow")}>
                    {warmup.active
                        ? warmup.status ?? "Hydrating selected servers into the local cache."
                        : count > 0
                            ? `${plural(count, "server")} selected for scan and optional cache warmup.`
                            : "Select one or more servers, then start the scan or pre-warm the member cache from the upload button."}
                </Paragraph>
                <span className={cl("badge")}>{count} selected</span>
            </div>

            {progress && (
                <Card className={cl("sub-card")} defaultPadding>
                    <div className={cl("row")}>
                        <div className={cl("grow")}>
                            <Heading tag="h4" className={Margins.reset}>Manual Cache Warmup</Heading>
                            <Paragraph className={cl("muted")}>{progress.guildLabel} / guild {progress.guildIndex} of {progress.totalGuilds}</Paragraph>
                        </div>
                        <span className={cl("badge")}>{formatWarmupState(progress.state)}</span>
                    </div>

                    <div className={cl("row")}>
                        <Paragraph className={cl("muted")}>
                            {progress.targetCount != null ? `${progress.indexedCount} verified / ${progress.targetCount} target` : `${progress.indexedCount} verified`}
                        </Paragraph>
                        <Paragraph className={cl("muted")}>
                            {progress.remainingCount != null ? `${progress.remainingCount} remaining` : `${progress.chunksSeen} chunks seen`}
                        </Paragraph>
                    </div>

                    <div className={cl("track")}>
                        <div className={cl("fill")} style={{ width: `${warmupPercent}%` }} />
                    </div>

                    <div className={cl("chips")}>
                        <span className={cl("badge")}>{progress.indexedCount} indexed</span>
                        {progress.chunksSeen > 0 && <span className={cl("badge", "quiet")}>{progress.chunksSeen} chunks</span>}
                        <span className={cl("badge", progress.delta > 0 ? "warn" : "quiet")}>+{progress.delta} hydrated</span>
                    </div>
                </Card>
            )}

            <div className={cl("list", "scroll", "guild-list")}>
                {filtered.map(guild => (
                    <GuildRow key={guild.id} guild={guild} selected={selected.has(guild.id)} disabled={warmup.active} onToggle={toggle} />
                ))}

                {filtered.length === 0 && (
                    <div className={cl("empty")}>
                        <FolderIcon className={cl("empty-icon")} />
                        <Paragraph className={cl("muted")}>No servers match this filter.</Paragraph>
                    </div>
                )}
            </div>
        </Card>
    );
});

const LivePanel = React.memo(function LivePanel({
    userId,
    config,
    runCount,
}: {
    userId: string | null;
    config: MutualScannerConfig;
    runCount: number;
}) {
    const scan = useMutualScannerRuntime(current => current.scan);
    const warmupActive = useMutualScannerRuntime(current => current.warmup.active);
    const { progress, result, matches } = scan;
    const locked = scan.active;
    const duration = scan.startedAt ? (scan.active ? Date.now() : result?.finishedAt ?? Date.now()) - scan.startedAt : 0;
    const percent = progress?.totalCandidates ? Math.min(100, Math.round((progress.scannedCount / progress.totalCandidates) * 100)) : 0;
    const liveMatches = React.useMemo(() => matches.slice(-LIVE_LIMIT).reverse(), [matches]);

    const start = () => {
        if (!userId) return;
        if (config.selectedGuildIds.length === 0) {
            showToast("Select at least one server before starting the scan.", "critical");
            return;
        }

        if (!startMutualScannerRun(userId, config)) showToast("Mutual scan could not start.", "critical");
    };

    const clearHistory = () => Alerts.show({
        title: "Clear Mutual Scanner history?",
        body: "This removes all saved scan runs from this device only.",
        confirmText: "Clear History",
        cancelText: "Cancel",
        async onConfirm() {
            await clearMutualScannerRuns(userId);
            showToast("Cleared local Mutual Scanner history.", "success");
        },
    });

    return (
        <Card className={cl("panel")} defaultPadding>
            <div className={cl("row", "head")}>
                <div className={cl("grow")}>
                    <Heading tag="h4">Live Run</Heading>
                    <Paragraph className={cl("muted")}>Run the sweep sequentially, watch matches appear, and stop it at any time.</Paragraph>
                </div>
                <span className={cl("badge")}>{locked ? formatProgress(progress) : "Idle"}</span>
            </div>

            <div className={cl("surface")}>
                <div className={cl("config-grid")}>
                    <NumberField userId={userId} field="requestDelayMs" label="Delay between profiles (ms)" value={config.requestDelayMs} min={0} max={5000} disabled={locked} />
                    <NumberField userId={userId} field="maxMembersPerGuild" label="Max members per server" value={config.maxMembersPerGuild} min={0} max={50000} disabled={locked} />
                    <NumberField userId={userId} field="warmupTimeoutMs" label="Warmup timeout per server (ms)" value={config.warmupTimeoutMs} min={500} max={20000} disabled={locked || !config.warmMemberCacheBeforeScan} />
                    <NumberField userId={userId} field="warmupMemberBudget" label="Warmup member budget" value={config.warmupMemberBudget} min={0} max={100000} disabled={locked || !config.warmMemberCacheBeforeScan} />
                </div>

                <div className={cl("toggle-grid")}>
                    <ToggleRow userId={userId} field="includeBots" title="Include bots" description="Leave off if you only care about human accounts." checked={config.includeBots} />
                    <ToggleRow userId={userId} field="skipExistingFriends" title="Skip users already in your friends" description="Useful if you only want new or non-friend candidates." checked={config.skipExistingFriends} />
                    <ToggleRow userId={userId} field="warmMemberCacheBeforeScan" title="Warm member cache before scan" description="Attempts to expand each selected guild beyond what is already in GuildMemberStore before scanning." checked={config.warmMemberCacheBeforeScan} />
                </div>
            </div>

            <div className={cl("chips", "actions")}>
                <Button variant="positive" size="small" className={cl("primary")} disabled={locked || warmupActive || config.selectedGuildIds.length === 0} onClick={start}>
                    <MagnifyingGlassIcon width={14} height={14} />
                    <span>Start Scan</span>
                </Button>
                <Button variant="dangerPrimary" size="small" disabled={!locked} onClick={cancelMutualScannerRun}>Cancel</Button>
                <TextButton variant="danger" disabled={runCount === 0 || locked} onClick={clearHistory}>Clear History</TextButton>
            </div>

            {(scan.active || result) && (
                <ScanStatusBanner progress={scan.active ? progress : null} result={scan.active ? null : result} duration={duration} />
            )}

            <div className={cl("surface")}>
                <div className={cl("row")}>
                    <Paragraph className={cl("muted")}>{progress?.currentLabel ? `Current profile: ${progress.currentLabel}` : "No active profile."}</Paragraph>
                    <Paragraph className={cl("muted")}>{scan.startedAt ? `Runtime ${formatDurationMs(duration)}` : "Waiting for a new run."}</Paragraph>
                </div>
                <div className={cl("track")}>
                    <div className={cl("fill")} style={{ width: `${percent}%` }} />
                </div>
                <div className={cl("chips")}>
                    <span className={cl("badge")}>{progress?.matchedCount ?? matches.length} matches</span>
                    <span className={cl("badge", "quiet")}>{progress?.scannedCount ?? 0} scanned</span>
                    <span className={cl("badge", "quiet")}>{progress?.profileErrors ?? 0} errors</span>
                    {(progress?.countOnlyMatches ?? 0) > 0 && <span className={cl("badge", "warn")}>{progress?.countOnlyMatches} count-only</span>}
                </div>
            </div>

            <div className={cl("list")}>
                {liveMatches.length === 0 && !locked && (
                    <Card className={cl("empty")} defaultPadding>
                        <MagnifyingGlassIcon className={cl("empty-icon")} />
                        <Heading tag="h4">Run a scan to populate live matches</Heading>
                        <Paragraph className={cl("muted")}>Results appear here as soon as the scanner finds profiles with any mutual friend relationship. Saved runs stay in history.</Paragraph>
                    </Card>
                )}

                {liveMatches.map(match => <MatchRow key={match.userId} match={match} />)}

                {matches.length > LIVE_LIMIT && (
                    <Paragraph className={cl("muted")}>Showing the latest {LIVE_LIMIT} of {matches.length} matches. The full list is saved in run history.</Paragraph>
                )}
            </div>

            {result?.status === "completed" && result.stats.countOnlyMatches > 0 && (
                <Notice.Info className={cl("notice")}>
                    {result.stats.countOnlyMatches} matches were accepted from mutual-friend count data only. Those are valid `has mutual` hits, but the client did not expose the resolved mutual-friend names for them.
                </Notice.Info>
            )}

            {config.warmMemberCacheBeforeScan && (
                <Notice.Info className={cl("notice")}>
                    Warmup runs one guild at a time through the shared hydration service. It can reuse a temporary local member index from recent runs, stops on timeout, or earlier if the per-guild member budget is reached. Set the budget to 0 for no member cap.
                </Notice.Info>
            )}
        </Card>
    );
});

const HistoryPanel = React.memo(function HistoryPanel({
    userId,
    runs,
    pending,
}: {
    userId: string | null;
    runs: MutualScannerRun[];
    pending: boolean;
}) {
    const [search, setSearch] = React.useState("");
    const queries = React.useMemo(() => runs.map(buildRunQuery), [runs]);
    const comparisons = React.useMemo(() => runs.map((run, index) =>
        buildMutualScannerRunComparison(run, runs.slice(index + 1).find(candidate => isComparableMutualScannerRun(run, candidate)) ?? null),
    ), [runs]);
    const visible = React.useMemo(() => {
        const query = search.trim().toLowerCase();
        return runs.map((run, index) => index).filter(index => !query || queries[index].includes(query));
    }, [runs, queries, search]);

    const remove = React.useCallback((runId: string) => void removeMutualScannerRun(userId, runId), [userId]);

    return (
        <Card className={cl("panel")} defaultPadding>
            <div className={cl("row", "head")}>
                <div className={cl("grow")}>
                    <Heading tag="h4">Run History</Heading>
                    <Paragraph className={cl("muted")}>Saved locally per account on this device.</Paragraph>
                </div>
                <span className={cl("badge")}>{runs.length} runs</span>
            </div>

            <label className={cl("search")}>
                <MagnifyingGlassIcon className={cl("empty-icon")} width={16} height={16} />
                <input
                    className={cl("search-input")}
                    type="text"
                    value={search}
                    placeholder="Search history by scope, user, or guild"
                    onChange={event => setSearch(event.currentTarget.value)}
                    spellCheck={false}
                />
            </label>

            <div className={cl("list", "scroll", "history-list")}>
                {pending && <Paragraph className={cl("muted")}>Loading history...</Paragraph>}

                {!pending && visible.length === 0 && (
                    <Card className={cl("empty")} defaultPadding>
                        <LogIcon className={cl("empty-icon")} />
                        <Heading tag="h4">No saved runs match this filter</Heading>
                        <Paragraph className={cl("muted")}>Broaden the search or run a new scan to build a stronger local history.</Paragraph>
                    </Card>
                )}

                {visible.map(index => (
                    <RunCard key={runs[index].id} run={runs[index]} comparison={comparisons[index]} onRemove={remove} />
                ))}
            </div>
        </Card>
    );
});

const CachePanel = React.memo(function CachePanel({
    userId,
    config,
    guilds,
}: {
    userId: string | null;
    config: MutualScannerConfig;
    guilds: MutualScannerGuildOption[];
}) {
    const busy = useMutualScannerRuntime(current => current.scan.active || current.warmup.active);
    const revision = useMutualScannerRuntime(current => current.scan.revision + current.warmup.revision);
    const [snapshots, setSnapshots] = React.useState<GuildHydrationSnapshot[]>([]);
    const [loading, setLoading] = React.useState(true);
    const [nonce, setNonce] = React.useState(0);

    React.useEffect(() => {
        let alive = true;

        void listHydratedGuildSnapshots(userId).then(list => {
            if (!alive) return;
            setSnapshots(list);
            setLoading(false);
        });

        return () => {
            alive = false;
        };
    }, [userId, revision, nonce]);

    const targets = React.useMemo(() => new Map(guilds.map(guild => [guild.id, guild.memberCount])), [guilds]);
    const retryIds = React.useMemo(() => {
        const byGuild = new Map(snapshots.map(snapshot => [snapshot.guildId, snapshot]));
        const selectedWeak = config.selectedGuildIds.filter(guildId =>
            isHydrationSnapshotWeak(byGuild.get(guildId), targets.get(guildId) ?? null),
        );

        return selectedWeak.length > 0
            ? selectedWeak
            : snapshots.filter(snapshot => isHydrationSnapshotWeak(snapshot, targets.get(snapshot.guildId) ?? null)).map(snapshot => snapshot.guildId);
    }, [config.selectedGuildIds, snapshots, targets]);

    const warm = React.useCallback((guildIds: string[], successLabel: string, failureLabel: string) => {
        if (!userId) return;
        if (guildIds.length === 0) {
            showToast(failureLabel, "critical");
            return;
        }

        if (!startMutualScannerWarmup(userId, { ...config, selectedGuildIds: guildIds })) {
            showToast("Manual cache warmup could not start.", "critical");
            return;
        }

        showToast(successLabel, "success");
    }, [userId, config]);

    const rewarm = React.useCallback((guildId: string) => {
        warm([guildId], `Rewarming ${GuildStore.getGuild(guildId)?.name ?? guildId}.`, "This guild could not be queued for rewarm.");
    }, [warm]);

    const clearOne = React.useCallback(async (guildId: string) => {
        await clearHydratedGuildSnapshot(userId, guildId);
        setNonce(value => value + 1);
        showToast("Removed guild hydration snapshot.", "success");
    }, [userId]);

    const clearAll = () => Alerts.show({
        title: "Clear hydration cache?",
        body: "This removes all local member-index snapshots for the current account on this device.",
        confirmText: "Clear Cache",
        cancelText: "Cancel",
        async onConfirm() {
            await clearHydratedGuildSnapshots(userId);
            setNonce(value => value + 1);
            showToast("Cleared local hydration cache.", "success");
        },
    });

    return (
        <Card className={cl("panel")} defaultPadding>
            <div className={cl("row", "head")}>
                <div className={cl("grow")}>
                    <Heading tag="h4">Hydration Cache</Heading>
                    <Paragraph className={cl("muted")}>Temporary member-index snapshots reused by the shared hydration service.</Paragraph>
                </div>
                <div className={cl("chips")}>
                    <span className={cl("badge")}>{snapshots.length} cached</span>
                    <TextButton
                        variant="secondary"
                        disabled={retryIds.length === 0 || loading || busy}
                        onClick={() => warm(
                            retryIds,
                            `Retrying cache warmup for ${plural(retryIds.length, "server")}.`,
                            "No incomplete or stale guild caches need a retry right now.",
                        )}
                    >
                        Retry Weak Guilds
                    </TextButton>
                    <TextButton variant="danger" disabled={snapshots.length === 0 || loading} onClick={clearAll}>Clear All</TextButton>
                </div>
            </div>

            <div className={cl("list", "scroll", "cache-list")}>
                {loading && <Paragraph className={cl("muted")}>Loading cache...</Paragraph>}

                {!loading && snapshots.length === 0 && (
                    <Card className={cl("empty")} defaultPadding>
                        <CloudUploadIcon className={cl("empty-icon")} />
                        <Heading tag="h4">No hydration snapshots yet</Heading>
                        <Paragraph className={cl("muted")}>Run a warmup-enabled scan and the selected guilds will start building temporary local member indexes here.</Paragraph>
                    </Card>
                )}

                {!loading && snapshots.map(snapshot => (
                    <HydrationCacheRow
                        key={`${snapshot.guildId}:${snapshot.warmedAt}`}
                        snapshot={snapshot}
                        targetCount={targets.get(snapshot.guildId) ?? null}
                        disabled={busy}
                        onRewarm={rewarm}
                        onClear={clearOne}
                    />
                ))}
            </div>
        </Card>
    );
});

function MutualScannerAccount({ userId }: { userId: string | null; }) {
    const [data, pending] = useMutualScannerData(userId);
    const guilds = useStateFromStores(
        [GuildStore, GuildMemberCountStore],
        buildGuildOptions,
        [],
        areGuildOptionsEqual,
    ) as MutualScannerGuildOption[];

    return (
        <SettingsTab>
            <div className={cl("shell")}>
                <SpecialCard
                    title="Mutual Scanner"
                    subtitle="Any-mutual sweep"
                    description={`Select the servers you want to inspect and ${BRAND_NAME} will locally scan cached members to find profiles that share at least one mutual friend with your account.`}
                    cardImage={BRAND_ICON_DATA_URL}
                    backgroundImage={HERO_BACKGROUND}
                    backgroundColor="#23211a"
                >
                    <div className={cl("chips", "hero")}>
                        <MetricTag icon={<LinkIcon width={14} height={14} />} label="Match mode" value="Any mutual" />
                        <MetricTag icon={<FolderIcon width={14} height={14} />} label="Selected servers" value={String(data.config.selectedGuildIds.length)} />
                        <MetricTag icon={<ClockIcon width={14} height={14} />} label="Saved runs" value={String(data.runs.length)} />
                    </div>
                </SpecialCard>

                <Notice.Info className={Margins.top20} style={{ width: "100%" }}>
                    The scan is local to this client session. It uses your current Discord state, selected guild member caches, and user profile mutual data already accessible to the client. Large servers may take time and not every member is guaranteed to be loaded in cache.
                </Notice.Info>

                <div className={cl("layout")}>
                    <div className={cl("column")}>
                        <ScopePanel userId={userId} config={data.config} guilds={guilds} />
                        <LivePanel userId={userId} config={data.config} runCount={data.runs.length} />
                    </div>

                    <div className={cl("column")}>
                        <HistoryPanel userId={userId} runs={data.runs} pending={pending} />
                        <CachePanel userId={userId} config={data.config} guilds={guilds} />
                    </div>
                </div>
            </div>
        </SettingsTab>
    );
}

function MutualScannerTab() {
    const userId = useStateFromStores([UserStore], () => UserStore.getCurrentUser()?.id ?? null);
    return <MutualScannerAccount key={userId} userId={userId} />;
}

export default wrapTab(MutualScannerTab, "Mutual Scanner");