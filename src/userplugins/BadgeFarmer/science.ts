/*
 * TrashCord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { RunningGame } from "@vencord/discord-types";
import { findByPropsLazy, findStoreLazy } from "@webpack";
import { RestAPI } from "@webpack/common";

const SCIENCE_URL = "/science";
const ME_URL = "/users/@me";
const TOKEN_MAX_AGE = 12 * 60 * 60 * 1_000;
const MIN_DURATION_MS = 60_000;
const HOUR_MS = 3_600_000;

export const TURBO_HOURS_PER_MINUTE = 10;

const SuperProperties: { getSuperProperties(): Record<string, unknown>; } = findByPropsLazy("getSuperProperties");
const RunningGameStore: {
    getRunningGames(): DetectedGame[];
    getGamesSeen(includeHidden?: boolean): DetectedGame[];
} = findStoreLazy("RunningGameStore");

type DetectedGame = RunningGame & { executableFingerprint?: string; };

export interface CreditableGame {
    id: string;
    name: string;
    exeName: string;
}

let analyticsToken = "";
let analyticsTokenFetchedAt = 0;
let sequence = Math.floor(Math.random() * 100_000);
const fingerprints = new Map<string, string>();

export function fingerprintFor(gameId: string): string {
    const known = fingerprints.get(gameId);
    if (known != null) return known;

    let detected: DetectedGame[] = [];
    try {
        detected = [...RunningGameStore.getRunningGames(), ...RunningGameStore.getGamesSeen(true)];
    } catch { }

    const fingerprint = detected.find(game => game.id === gameId && game.executableFingerprint)?.executableFingerprint ?? "";
    fingerprints.set(gameId, fingerprint);

    return fingerprint;
}

async function getAnalyticsToken(): Promise<string> {
    if (analyticsToken !== "" && Date.now() - analyticsTokenFetchedAt < TOKEN_MAX_AGE) return analyticsToken;

    const { body } = await RestAPI.get({ url: ME_URL, query: { with_analytics_token: true } });
    if (typeof body?.analytics_token !== "string") throw new Error("Discord returned no analytics_token");

    analyticsToken = body.analytics_token;
    analyticsTokenFetchedAt = Date.now();

    return analyticsToken;
}

interface ClientSession { heartbeatSession: string; launchSignature: string; locale: string; }
let cachedSession: ClientSession | null = null;

function clientSession(): ClientSession {
    if (cachedSession != null) return cachedSession;

    let properties: Record<string, unknown> = {};
    try {
        properties = SuperProperties.getSuperProperties() ?? {};
    } catch { }

    cachedSession = {
        heartbeatSession: properties.client_heartbeat_session_id as string ?? crypto.randomUUID(),
        launchSignature: properties.launch_signature as string ?? crypto.randomUUID(),
        locale: properties.system_locale as string ?? "en-US"
    };
    return cachedSession;
}

function buildLaunch(game: CreditableGame, fingerprint: string, at: number): Record<string, unknown> {
    const { heartbeatSession, launchSignature, locale } = clientSession();

    const properties: Record<string, unknown> = {
        client_track_timestamp: at,
        client_heartbeat_session_id: heartbeatSession,
        event_sequence_number: ++sequence,
        game: game.name,
        game_id: game.id,
        verified: true,
        elevated: false,
        is_launcher: false,
        game_platform: "desktop",
        detection_method: "verified_game",
        is_overlay_enabled: false,
        is_overlay_game_enabled: true,
        is_overlay_game_source: "OOP_DEFAULT_DATABASE",
        fullscreen_type: "UNKNOWN",
        hardware_display_count: 1,
        overlay_method: "Disabled",
        activity_status_enabled: true,
        activity_status_shared_guilds: [],
        current_user_status: "online",
        game_detection_enabled: true,
        executable_path: game.exeName,
        voice_channel_id: null,
        voice_channel_type: null,
        voice_channel_bitrate: null,
        voice_channel_guild_id: null,
        hidden_by_distributor: false,
        game_metadata: null,
        client_performance_cpu: null,
        client_performance_memory: null,
        cpu_core_count: null,
        accessibility_features: 0,
        rendered_locale: locale,
        launch_signature: launchSignature,
        client_rtc_state: null,
        client_app_state: "focused",
        client_send_timestamp: at
    };

    if (fingerprint !== "") properties.executable_fingerprint = fingerprint;

    return { type: "launch_game", properties };
}

function buildHeartbeat(game: CreditableGame, durationMs: number, gameSession: string, initial: boolean, at: number): Record<string, unknown> {
    const { heartbeatSession, launchSignature } = clientSession();

    return {
        type: "running_game_heartbeat",
        properties: {
            client_track_timestamp: at,
            client_heartbeat_session_id: heartbeatSession,
            event_sequence_number: ++sequence,
            game_id: game.id,
            game_name: game.name,
            game_metadata: null,
            game_executable: game.exeName,
            game_detection_enabled: true,
            initial_heartbeat: initial,
            final_heartbeat: !initial,
            game_session_id: gameSession,
            duration_tracked_ms: durationMs,
            rtc_connection_id: null,
            media_session_id: null,
            launch_signature: launchSignature,
            client_app_state: "focused",
            client_send_timestamp: at
        }
    };
}

const MAX_BACKDATE_MS = 24 * HOUR_MS;

function resolveStart(duration: number, startedAt: number | undefined): number {
    const now = Date.now();
    if (startedAt == null) return Math.max(now - duration, now - MAX_BACKDATE_MS);
    return Math.max(startedAt, now - MAX_BACKDATE_MS);
}

export async function creditPlaytime(game: CreditableGame, durationMs: number, startedAt?: number): Promise<void> {
    const duration = Math.floor(durationMs);
    if (duration < MIN_DURATION_MS) return;

    const fingerprint = fingerprintFor(game.id);
    const token = await getAnalyticsToken();
    const gameSession = crypto.randomUUID();
    const start = resolveStart(duration, startedAt);

    await RestAPI.post({
        url: SCIENCE_URL,
        body: {
            token,
            events: [
                buildHeartbeat(game, 0, gameSession, true, start),
                buildLaunch(game, fingerprint, start),
                buildHeartbeat(game, duration, gameSession, false, start + duration)
            ]
        }
    });
}

export interface StreamLocation {
    guildId: string;
    channelId: string;
}

export type StreamPhase = "waiting" | "slow" | "turbo";

export interface LiveContext {
    location: StreamLocation | null;
    viewers: number;
}

export interface LiveStreamOptions {
    targetHours: number;
    autoSwitch: boolean;
    context: () => LiveContext;
    shouldContinue: () => boolean;
    onProgress: (creditedHours: number) => void;
    onPhase: (phase: StreamPhase) => void;
    onError: (message: string) => void;
}

export interface LiveStreamHandle {
    stop(): void;
    finished: Promise<void>;
}

type ScienceEvent = { type: string; properties: Record<string, unknown>; };

const POLL_MS = 5_000;
const MINUTE_MS = 60_000;

export function startLiveStream(o: LiveStreamOptions): LiveStreamHandle {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let wake: (() => void) | null = null;

    const pause = (ms: number) => new Promise<boolean>(resolve => {
        wake = () => resolve(false);
        timer = setTimeout(() => { wake = null; resolve(true); }, ms);
    });

    const finished = (async () => {
        const heartbeatSessionId = crypto.randomUUID();
        const launchSignature = crypto.randomUUID();

        let fatal: string | null = null;
        let lastFailure = "";
        let joined: string | null = null;
        let joinedAt = 0;
        let claimedMs = 0;
        let turboHours = 0;
        let slowMinutes = 0;
        let slowMs = 0;
        let lastTurbo = 0;
        let lastTick = Date.now();
        let failures = 0;
        let locked: boolean | null = null;
        let phase: StreamPhase | null = null;
        let props: Record<string, unknown> = {};

        const credited = () => turboHours + slowMinutes / 60;

        const setPhase = (next: StreamPhase) => {
            if (next === phase) return;
            phase = next;
            o.onPhase(next);
        };

        const send = async (events: ScienceEvent[]): Promise<boolean> => {
            try {
                const token = await getAnalyticsToken();
                await RestAPI.post({
                    url: SCIENCE_URL,
                    body: {
                        token,
                        events: events.map(ev => ({
                            type: ev.type,
                            properties: {
                                client_track_timestamp: Date.now(),
                                client_send_timestamp: Date.now(),
                                client_heartbeat_session_id: heartbeatSessionId,
                                launch_signature: launchSignature,
                                event_sequence_number: ++sequence,
                                client_app_state: "focused",
                                ...ev.properties
                            }
                        }))
                    }
                });
                return true;
            } catch (error) {
                lastFailure = String(error);
                if (lastFailure.includes("analytics_token")) fatal = lastFailure;
                return false;
            }
        };

        const beat = (ms: number): ScienceEvent => ({
            type: "video_stream_heartbeat",
            properties: { ...props, duration_tracked_ms: ms, total_duration_ms: claimedMs + ms }
        });

        const leave = async () => {
            if (joined == null) return;
            joined = null;
            await send([{ type: "video_stream_ended", properties: { ...props, duration_ms: claimedMs || Date.now() - joinedAt } }]);
        };

        try {
            while (!stopped && fatal == null && o.shouldContinue() && credited() < o.targetHours) {
                const now = Date.now();
                const delta = now - lastTick;
                lastTick = now;
                const ctx = o.context();

                if (ctx.location == null) {
                    setPhase("waiting");
                    await leave();
                    slowMs = 0;
                    if (!await pause(POLL_MS)) break;
                    continue;
                }

                const key = `${ctx.location.guildId}:${ctx.location.channelId}`;
                if (key !== joined) {
                    await leave();
                    props = { guild_id: ctx.location.guildId, channel_id: ctx.location.channelId, channel_type: 2 };
                    await send([
                        { type: "media_session_joined", properties: { ...props } },
                        { type: "video_stream_started", properties: { ...props } }
                    ]);
                    joined = key;
                    joinedAt = Date.now();
                    claimedMs = 0;
                    slowMs = 0;
                    lastTurbo = 0;
                }

                let turbo = ctx.viewers > 0;
                if (!o.autoSwitch) {
                    locked ??= turbo;
                    turbo = locked;
                }
                setPhase(turbo ? "turbo" : "slow");

                if (turbo) {
                    slowMs = 0;
                    if (now - lastTurbo >= MINUTE_MS) {
                        const claim = Math.min(TURBO_HOURS_PER_MINUTE, o.targetHours - credited());
                        if (await send([beat(claim * HOUR_MS)])) {
                            failures = 0;
                            claimedMs += claim * HOUR_MS;
                            turboHours += claim;
                            lastTurbo = Date.now();
                            o.onProgress(credited());
                        } else failures++;
                    }
                } else {
                    slowMs += delta;
                    if (slowMs >= MINUTE_MS) {
                        slowMs -= MINUTE_MS;
                        if (await send([beat(MINUTE_MS)])) {
                            failures = 0;
                            claimedMs += MINUTE_MS;
                            slowMinutes++;
                            o.onProgress(credited());
                        } else failures++;
                    }
                }

                if (failures >= 10) {
                    fatal = lastFailure || "errHb";
                    break;
                }
                if (!await pause(POLL_MS)) break;
            }
        } catch (error) {
            fatal = String(error);
        }

        if (fatal != null) o.onError(fatal);
        else await leave();
    })();

    return {
        stop() {
            stopped = true;
            if (timer != null) clearTimeout(timer);
            wake?.();
        },
        finished
    };
}
