/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { Button } from "@components/Button";
import { detectClient } from "@plugins/_core/supportHelper";
import { Logger } from "@utils/Logger";
import { EquicordDevs } from "@utils/constants";
import definePlugin, { OptionType } from "@utils/types";
import { findByCodeLazy } from "@webpack";
import { ApplicationStreamingStore, ChannelStore, Constants, FluxDispatcher, GuildMemberStore, GuildStore, MediaEngineStore, RestAPI, RunningGameStore, SelectedChannelStore, SoundboardStore, StreamerModeStore, UserStore, VoiceStateStore } from "@webpack/common";

const startStreamFn: ((guildId: string | null, channelId: string, options: Record<string, unknown>) => void) | undefined = findByCodeLazy('type:"STREAM_START"');

const logger = new Logger("OrbolayBridgeFork");

interface ChannelState {
    userId: string;
    channelId: string;
    deaf: boolean;
    mute: boolean;
    stream: boolean;
    selfDeaf: boolean;
    selfMute: boolean;
    selfStream: boolean;
}

const manualReconnect = (): boolean => {
    try {
        if (reconnectTimeout) {
            clearTimeout(reconnectTimeout);
            reconnectTimeout = null;
        }
        reconnectDelay = (settings.store.minReconnectDelay ?? 1) * 1000;
        isRetrying = false;
        wasConnected = false;
        connect();
        return true;
    } catch {
        return false;
    }
};

const sendTestNotification = (): boolean => {
    try {
        if (ws?.readyState !== WebSocket.OPEN) return false;

        ws.send(
            JSON.stringify({
                cmd: "MESSAGE_NOTIFICATION",
                message: {
                    title: "**Test** Notification",
                    body: "**bold** *italic* __underline__ ~~strike~~ `code` ||spoiler||\n# Heading 1\n## Heading 2\n### Heading 3\n- Bullet one\n- Bullet two\n1. First\n2. Second",
                    icon: "https://raw.githubusercontent.com/Equicord/Equicord/refs/heads/main/browser/icon.png",
                    guildId: "0",
                    channelId: "0",
                    messageId: "0",
                }
            })
        );
        return true;
    } catch {
        return false;
    }
};

type BtnState = "idle" | "success" | "error";

const OrbolaySettingsButtons = () => {
    const [reconnectState, setReconnectState] = React.useState<BtnState>("idle");
    const [notifState, setNotifState] = React.useState<BtnState>("idle");

    const withFeedback = (setState: (s: BtnState) => void, action: () => boolean) => () => {
        const ok = action();
        setState(ok ? "success" : "error");
        setTimeout(() => setState("idle"), 2000);
    };

    const btnStyle = (state: BtnState): React.CSSProperties => ({
        transition: "background-color 0.2s ease",
        ...(state === "success" && { backgroundColor: "#3ba55c" }),
        ...(state === "error" && { backgroundColor: "#ed4245" }),
    });

    return (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
            <Button onClick={withFeedback(setReconnectState, manualReconnect)} style={btnStyle(reconnectState)}>
                Reconnect
            </Button>
            <Button onClick={withFeedback(setNotifState, sendTestNotification)} style={btnStyle(notifState)}>
                Send Test Notification
            </Button>
        </div>
    );
};


const settings = definePluginSettings({
    port: {
        type: OptionType.NUMBER,
        description: "Port to connect to.",
        default: 6888,
        restartNeeded: true
    },
    autoReconnect: {
        type: OptionType.BOOLEAN,
        description: "Auto-reconnect to Orbolay server when connection is lost.",
        default: true,
        restartNeeded: false
    },
    maxReconnectDelay: {
        type: OptionType.SLIDER,
        description: "Maximum reconnect delay (in seconds).",
        markers: [5, 10, 15, 30, 45, 60, 90, 120, 180, 240, 300],
        stickToMarkers: false,
        default: 60,
        restartNeeded: false
    },
    minReconnectDelay: {
        type: OptionType.SLIDER,
        description: "Minimum reconnect delay (in seconds).",
        markers: [1, 2, 5, 10, 15, 20, 25, 30],
        stickToMarkers: false,
        default: 1,
        restartNeeded: false
    },
    reconnectMultiplier: {
        type: OptionType.SLIDER,
        description: "Reconnect backoff multiplier.",
        markers: [1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5],
        stickToMarkers: false,
        default: 2,
        restartNeeded: false
    },
    sendConnectedNotification: {
        type: OptionType.BOOLEAN,
        description: "Send a connected notification to Orbolay when connected successfully.",
        default: true,
        restartNeeded: false
    },
    showToasts: {
        type: OptionType.BOOLEAN,
        description: "Show toast notifications for connection events.",
        default: true,
        restartNeeded: false
    },
    buttons: {
        type: OptionType.COMPONENT,
        component: OrbolaySettingsButtons
    }
});

const showToast = (toast: Parameters<typeof Toasts.show>[0]) => {
    if (settings.store.showToasts) {
        Toasts.show(toast);
    }
};

const sendConfig = () => {
    if (ws?.readyState !== WebSocket.OPEN) return;

    const userId = UserStore.getCurrentUser()?.id;
    if (!userId) return;

    ws.send(JSON.stringify({ cmd: "REGISTER_CONFIG", userId }));
};

let ws: WebSocket | null = null;
let currentChannel: string | null = null;
let reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
let reconnectDelay = 1000;
let wasConnected = false;
let isRetrying = false;
let shouldConnect = false;

const waitForPopulate = async <T,>(fn: () => T): Promise<T> => {
    while (true) {
        const result = await fn();
        if (result) return result;
        await new Promise(r => setTimeout(r, 500));
    }
};

const stateToPayload = (guildId: string, state: any) => {
    const activeStream = ApplicationStreamingStore.getCurrentUserActiveStream();
    let isWatchingMe = false;
    if (activeStream) {
        const viewers = ApplicationStreamingStore.getViewerIds(activeStream);
        if (viewers && viewers.includes(state.userId)) {
            isWatchingMe = true;
        }
    }

    return {
        userId: state.userId,
        username:
            GuildMemberStore.getNick(guildId, state.userId) ||
            UserStore.getUser(state.userId)?.globalName ||
            UserStore.getUser(state.userId)?.username,
        avatarUrl: UserStore.getUser(state.userId)?.avatar,
        channelId: state.channelId,
        deaf: state.deaf || state.selfDeaf,
        mute: state.mute || state.selfMute,
        streaming: state.selfStream || state.stream,
        video: state.selfVideo || state.video,
        watching: isWatchingMe,
        speaking: false,
    };
};

const getSoundboardSounds = (guildId: string) => {
    try {
        const sounds = SoundboardStore?.getSoundsForGuild?.(guildId);
        if (!sounds) return [];
        return Object.values(sounds)
            .filter((s: any) => s.available !== false)
            .map((s: any) => ({
                soundId: s.sound_id ?? s.soundId,
                name: s.name,
                volume: s.volume ?? 1,
                guildId: s.guild_id ?? s.guildId,
                emojiName: s.emoji?.name ?? "\uD83D\uDD0A",
            }));
    } catch {
        return [];
    }
};

const incoming = payload => {
    switch (payload.cmd) {
        case "TOGGLE_MUTE":
            FluxDispatcher.dispatch({
                type: "AUDIO_TOGGLE_SELF_MUTE",
                syncRemote: true,
                playSoundEffect: true,
                context: "default"
            });
            break;
        case "TOGGLE_DEAF":
            FluxDispatcher.dispatch({
                type: "AUDIO_TOGGLE_SELF_DEAF",
                syncRemote: true,
                playSoundEffect: true,
                context: "default"
            });
            break;
        case "DISCONNECT":
            FluxDispatcher.dispatch({
                type: "VOICE_CHANNEL_SELECT",
                channelId: null
            });
            break;
        case "STOP_STREAM": {
            const userId = UserStore.getCurrentUser().id;
            const voiceState = VoiceStateStore.getVoiceStateForUser(userId);
            if (!voiceState?.channelId) return;
            const channel = ChannelStore.getChannel(voiceState.channelId);
            if (!channel) return;

            FluxDispatcher.dispatch({
                type: "STREAM_STOP",
                streamKey: `guild:${channel.guild_id}:${voiceState.channelId}:${userId}`,
                appContext: "APP"
            });

            break;
        }
        case "NAVIGATE": {
            if (!payload.guild_id || !payload.channel_id || !payload.message_id) break;

            const { guild_id, channel_id, message_id } = payload;
            FluxDispatcher.dispatch({
                type: "CHANNEL_SELECT",
                guildId: String(guild_id),
                channelId: String(channel_id),
                messageId: String(message_id),
            });

            break;
        }
                case "START_STREAM": {
            if (!startStreamFn) { logger.warn("START_STREAM: startStream fn not found"); break; }
            const userId = UserStore.getCurrentUser().id;
            const voiceState = VoiceStateStore.getVoiceStateForUser(userId);
            if (!voiceState?.channelId) break;
            const channel = ChannelStore.getChannel(voiceState.channelId);
            if (!channel) break;

            const soundEnabled = ApplicationStreamingStore.getDefaultCaptureSettings?.()?.sound ?? true;

            if (payload.source === "game") {
                const games = RunningGameStore?.getRunningGames?.() ?? [];
                const game = games[0];
                if (!game) { logger.warn("START_STREAM(game): no running game detected"); break; }
                startStreamFn(channel.guild_id ?? null, voiceState.channelId, {
                    pid: game.pid,
                    sourceId: `window:${game.pid}:0`,
                    sourceName: game.name ?? "Game",
                    audioSourceId: game.name ?? "Game",
                    sound: soundEnabled,
                    previewDisabled: false,
                });
            } else {
                startStreamFn(channel.guild_id ?? null, voiceState.channelId, {
                    pid: null,
                    sourceId: "screen:0",
                    sourceName: "Screen",
                    audioSourceId: "Screen",
                    sound: soundEnabled,
                    previewDisabled: false,
                });
            }
            break;
        }
        case "TOGGLE_CAMERA": {
            const enabled = MediaEngineStore?.isVideoEnabled?.() ?? false;
            FluxDispatcher.dispatch({ type: "MEDIA_ENGINE_SET_VIDEO_ENABLED", enabled: !enabled });
            break;
        }
        case "PLAY_SOUNDBOARD_SOUND": {
            const { soundId, guildId } = payload;
            if (!soundId) break;
            const voiceId = SelectedChannelStore.getVoiceChannelId();
            if (!voiceId) break;
            // source_guild_id signals a cross-server (external) soundboard play, which
            // requires the target server to be boost level 2+. Playing a server's own
            // sound in that same server must omit it, or Discord returns 50101.
            const voiceGuildId = ChannelStore.getChannel(voiceId)?.guild_id;
            const body: Record<string, string> = { sound_id: soundId };
            if (guildId && guildId !== voiceGuildId) body.source_guild_id = guildId;
            RestAPI.post({
                url: Constants.Endpoints.SEND_SOUNDBOARD_SOUND(voiceId),
                body
            }).catch((e: any) => logger.error("PLAY_SOUNDBOARD_SOUND failed:", e?.body ?? e?.message ?? e));
            break;
        }
    }
};

const handleTyping = dispatch => {
    if (ws?.readyState !== WebSocket.OPEN) return;
    // Only forward typing events from the current voice channel's text channel,
    // or any channel in the same guild — filter to currentChannel scope.
    if (!currentChannel) return;
    const voiceChannel = ChannelStore.getChannel(currentChannel);
    if (!voiceChannel) return;
    // Only emit if typing in same guild as the voice channel
    const typingChannel = ChannelStore.getChannel(dispatch.channelId);
    if (!typingChannel || typingChannel.guild_id !== voiceChannel.guild_id) return;

    ws.send(
        JSON.stringify({
            cmd: "TYPING_START",
            userId: dispatch.userId,
            channelId: dispatch.channelId,
        })
    );
};

const handleSpeaking = dispatch => {
    if (ws?.readyState !== WebSocket.OPEN) return;
    if (!currentChannel || dispatch.channelId !== currentChannel) return;

    ws.send(
        JSON.stringify({
            cmd: "SPEAKING_UPDATE",
            userId: dispatch.userId,
            speaking: !!dispatch.speakingFlags,
        })
    );
};

// Discord fires STREAM_CREATE/STREAM_DELETE (not VOICE_STATE_UPDATES) when a
// user starts/stops streaming, so we re-emit that user's voice state with an
// explicit streaming flag to keep the overlay in sync.
const handleStreamChange = (streaming: boolean) => (dispatch: any) => {
    if (ws?.readyState !== WebSocket.OPEN) return;
    if (!currentChannel) return;
    // streamKey: "guild:<guildId>:<channelId>:<userId>" or "call:<channelId>:<userId>"
    const userId = String(dispatch.streamKey || "").split(":").pop();
    if (!userId) return;
    const voiceState = VoiceStateStore.getVoiceStateForUser(userId);
    if (!voiceState || voiceState.channelId !== currentChannel) return;
    const channel = ChannelStore.getChannel(currentChannel);
    const guildId = channel?.guild_id;
    const state = stateToPayload(guildId, { ...voiceState, userId });
    state.streaming = streaming;
    ws.send(JSON.stringify({ cmd: "VOICE_STATE_UPDATE", state }));
};

const handleVoiceStateUpdates = async dispatch => {
    const { id } = UserStore.getCurrentUser();

    for (const state of dispatch.voiceStates) {
        const ourState = state.userId === id;
        const { guildId } = state;

        if (ourState) {
            if (state.channelId && state.channelId !== currentChannel) {
                const voiceStates = await waitForPopulate(() =>
                    VoiceStateStore?.getVoiceStatesForChannel(state.channelId)
                );

                const joinedChannel = ChannelStore.getChannel(state.channelId);
                const joinedGuild = GuildStore.getGuild(guildId);
                ws?.send(
                    JSON.stringify({
                        cmd: "CHANNEL_JOINED",
                        guildId,
                        channelId: state.channelId,
                        channelName: joinedChannel?.name || "",
                        guildName: joinedGuild?.name || "",
                        states: Object.values(voiceStates).map(s => stateToPayload(guildId, s as ChannelState)),
                        soundboardSounds: getSoundboardSounds(guildId),
                    })
                );

                currentChannel = state.channelId;

                break;
            } else if (!state.channelId) {
                ws?.send(
                    JSON.stringify({
                        cmd: "CHANNEL_LEFT",
                    })
                );

                currentChannel = null;

                break;
            }
        }

        if (
            !!currentChannel &&
            (state.channelId === currentChannel ||
                state.oldChannelId === currentChannel)
        ) {
            ws?.send(
                JSON.stringify({
                    cmd: "VOICE_STATE_UPDATE",
                    state: stateToPayload(guildId, state as ChannelState),
                })
            );
        }
    }
};

const handleStreamWatchers = async () => {
    if (!currentChannel) return;
    const voiceStates = VoiceStateStore.getVoiceStatesForChannel(currentChannel);
    if (!voiceStates) return;

    const userId = UserStore.getCurrentUser()?.id;
    if (!userId) return;
    const channel = ChannelStore.getChannel(currentChannel);
    if (!channel) return;
    const guildId = channel.guild_id;
    if (!guildId) return;

    const watchersChannel = ChannelStore.getChannel(currentChannel);
    const watchersGuild = GuildStore.getGuild(guildId);
    ws?.send(
        JSON.stringify({
            cmd: "CHANNEL_JOINED",
            guildId,
            channelId: currentChannel,
            channelName: watchersChannel?.name || "",
            guildName: watchersGuild?.name || "",
            states: Object.values(voiceStates).map(s => stateToPayload(guildId, s as any)),
            soundboardSounds: getSoundboardSounds(guildId),
        })
    );
};

const handleStreamerMode = dispatch => {
    ws?.send(
        JSON.stringify({
            cmd: "STREAMER_MODE",
            enabled: dispatch.value,
        })
    );
};

const cleanWebSocket = () => {
    if (ws) {
        ws.onopen = null;
        ws.onclose = null;
        ws.onerror = null;
        ws.onmessage = null;
        try {
            ws.close();
        } catch (e) {
            logger.error("Failed to close WebSocket:", e);
        }
        ws = null;
    }
};

const connect = () => {
    if (!shouldConnect) return;

    cleanWebSocket();

    logger.info(`Connecting to Orbolay server on port ${settings.store.port}...`);

    ws = new WebSocket("ws://127.0.0.1:" + settings.store.port);

    ws.onopen = async () => {
        logger.info("Connected to Orbolay server");
        wasConnected = true;
        isRetrying = false;
        reconnectDelay = (settings.store.minReconnectDelay ?? 1) * 1000;

        showToast({
            message: "Connected to Orbolay server",
            type: Toasts.Type.SUCCESS,
            id: Toasts.genId(),
        });

        const userId = await waitForPopulate(() => UserStore.getCurrentUser()?.id);
        if (!userId) return;

        sendConfig();

        if (settings.store.sendConnectedNotification) {
            ws?.send(
                JSON.stringify({
                    cmd: "MESSAGE_NOTIFICATION",
                    message: {
                        title: "Connected ✅",
                        body: `${detectClient().name} is now connected to Orbolay`,
                        icon: "https://raw.githubusercontent.com/Equicord/Equicord/refs/heads/main/browser/icon.png",
                        guildId: "0",
                        channelId: "0",
                        messageId: "0",
                    }
                })
            );
        }

        // Let the client know whether we are in streamer mode
        ws?.send(
            JSON.stringify({
                cmd: "STREAMER_MODE",
                enabled: StreamerModeStore.enabled,
            })
        );

        const userVoiceState = VoiceStateStore.getVoiceStateForUser(userId);
        if (!userVoiceState || !userVoiceState.channelId) return;

        const channel = ChannelStore.getChannel(userVoiceState.channelId);
        if (!channel) return;

        const guildId = channel.guild_id;
        const channelState = VoiceStateStore.getVoiceStatesForChannel(userVoiceState.channelId);
        if (!guildId || !channelState) return;

        const reconnectGuild = GuildStore.getGuild(guildId);
        ws?.send(
            JSON.stringify({
                cmd: "CHANNEL_JOINED",
                guildId,
                channelId: userVoiceState.channelId,
                channelName: channel?.name || "",
                guildName: reconnectGuild?.name || "",
                states: Object.values(channelState).map(s => stateToPayload(guildId, s as ChannelState)),
                soundboardSounds: getSoundboardSounds(guildId),
            })
        );

        currentChannel = userVoiceState.channelId;
    };

    ws.onmessage = e => {
        try {
            incoming(JSON.parse(e.data));
        } catch (err) {
            logger.error("Error parsing message:", err);
        }
    };

    ws.onerror = e => {
        logger.error("WebSocket error:", e);
    };

    ws.onclose = () => {
        cleanWebSocket();

        if (wasConnected) {
            logger.info("Disconnected from Orbolay server.");
            wasConnected = false;
            showToast({
                message: "Disconnected from Orbolay server",
                type: Toasts.Type.FAILURE,
                id: Toasts.genId(),
            });
        } else if (!isRetrying) {
            showToast({
                message: "Orbolay websocket could not connect. Is it running?",
                type: Toasts.Type.FAILURE,
                id: Toasts.genId(),
            });
            isRetrying = true;
        }

        if (shouldConnect && settings.store.autoReconnect) {
            const currentDelay = reconnectDelay;
            const maxDelayMs = (settings.store.maxReconnectDelay ?? 60) * 1000;
            const minDelayMs = (settings.store.minReconnectDelay ?? 1) * 1000;
            const multiplier = settings.store.reconnectMultiplier ?? 2;
            reconnectDelay = Math.max(minDelayMs, Math.min(reconnectDelay * multiplier, maxDelayMs));

            logger.info(`Reconnecting in ${Math.round(currentDelay)}ms (next backoff: ${Math.round(reconnectDelay)}ms)`);

            reconnectTimeout = setTimeout(() => {
                connect();
            }, currentDelay);
        }
    };
};

export default definePlugin({
    name: "OrbolayBridgeFork",
    description: "Bridge plugin to connect Discord to Orbolay via WebSocket",
    authors: [EquicordDevs.SpikeHD],
    tags: ["Utility", "Voice"],
    enabledByDefault: false,
    settings,
    flux: {
        SPEAKING: handleSpeaking,
        VOICE_STATE_UPDATES: handleVoiceStateUpdates,
        // RPC_NOTIFICATION_CREATE: handleMessageNotification, // handler missing, disabled to avoid ReferenceError
        TYPING_START: handleTyping,
        STREAMER_MODE: handleStreamerMode,
        STREAM_WATCHERS_ADD: handleStreamWatchers,
        STREAM_WATCHERS_REMOVE: handleStreamWatchers,
        STREAM_CREATE: handleStreamChange(true),
        STREAM_DELETE: handleStreamChange(false),
    },
    toolboxActions: {
        "Reconnect": manualReconnect,
        "Test Notification": sendTestNotification,
    },

    start() {
        shouldConnect = true;
        wasConnected = false;
        isRetrying = false;
        reconnectDelay = (settings.store.minReconnectDelay ?? 1) * 1000;
        connect();
    },

    stop() {
        shouldConnect = false;
        if (reconnectTimeout) {
            clearTimeout(reconnectTimeout);
            reconnectTimeout = null;
        }
        cleanWebSocket();
    }
});
