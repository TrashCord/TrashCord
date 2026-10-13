/*
 * AI VTuber Bridge — WebSocket client + Discord command executor
 *
 * Connects to the AI VTuber backend via WebSocket. Receives commands
 * from the AI and executes them in Discord using internal APIs.
 * Forwards Discord events back to the AI backend.
 */

import { Logger } from "@utils/Logger";
import { sendMessage } from "@utils/discord";
import {
    ChannelActions,
    ChannelStore,
    Constants,
    FluxDispatcher,
    GuildChannelStore,
    GuildStore,
    MessageActions,
    RestAPI,
    SelectedChannelStore,
    SelectedGuildStore,
    UserStore,
    VoiceStateStore,
} from "@webpack/common";

import { settings } from "./settings";

const log = new Logger("AIBridge");

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let ws: WebSocket | null = null;
let shouldReconnect = false;
let reconnectTimeout: NodeJS.Timeout | null = null;
let reconnectDelay = 1000;
let heartbeatInterval: NodeJS.Timeout | null = null;
let connected = false;

type ConnectionListener = (connected: boolean) => void;
const connectionListeners: Set<ConnectionListener> = new Set();

export function isConnected(): boolean {
    return connected;
}

export function onConnectionChange(listener: ConnectionListener): () => void {
    connectionListeners.add(listener);
    return () => connectionListeners.delete(listener);
}

function setConnected(val: boolean) {
    connected = val;
    for (const listener of connectionListeners) {
        try { listener(val); } catch { /* ignore */ }
    }
}

// ---------------------------------------------------------------------------
// WebSocket connection
// ---------------------------------------------------------------------------

export function connectBridge(url: string) {
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
        log.warn("Already connected or connecting");
        return;
    }

    shouldReconnect = true;
    reconnectDelay = 1000;
    _connect(url);
}

export function disconnectBridge() {
    shouldReconnect = false;
    if (reconnectTimeout) {
        clearTimeout(reconnectTimeout);
        reconnectTimeout = null;
    }
    if (heartbeatInterval) {
        clearInterval(heartbeatInterval);
        heartbeatInterval = null;
    }
    if (ws) {
        ws.close(1000, "Plugin disabled");
        ws = null;
    }
    setConnected(false);
}

function _connect(url: string) {
    try {
        log.info("Connecting to %s", url);
        ws = new WebSocket(url);

        ws.addEventListener("open", () => {
            log.info("Bridge connected");
            setConnected(true);
            reconnectDelay = 1000;

            // Start heartbeat
            heartbeatInterval = setInterval(() => {
                if (ws?.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify({ type: "ping" }));
                }
            }, 30000);
        });

        ws.addEventListener("message", ({ data }) => {
            try {
                const msg = JSON.parse(data as string);
                handleMessage(msg);
            } catch (e) {
                log.warn("Failed to parse bridge message:", e);
            }
        });

        ws.addEventListener("close", (event) => {
            log.info("Bridge disconnected (code=%d reason=%s)", event.code, event.reason);
            setConnected(false);
            if (heartbeatInterval) {
                clearInterval(heartbeatInterval);
                heartbeatInterval = null;
            }
            ws = null;

            if (shouldReconnect) {
                reconnectTimeout = setTimeout(() => {
                    reconnectDelay = Math.min(reconnectDelay * 1.5, 30000);
                    _connect(url);
                }, reconnectDelay);
            }
        });

        ws.addEventListener("error", (event) => {
            log.error("Bridge WebSocket error:", event);
        });
    } catch (e) {
        log.error("Failed to create WebSocket:", e);
        if (shouldReconnect) {
            reconnectTimeout = setTimeout(() => _connect(url), reconnectDelay);
        }
    }
}

// ---------------------------------------------------------------------------
// Message handler — process commands from the AI backend
// ---------------------------------------------------------------------------

interface BridgeCommand {
    type: "command";
    action: string;
    id: string;
    payload: Record<string, any>;
}

async function handleMessage(msg: any) {
    if (msg.type === "pong") return;

    if (msg.type === "command") {
        const cmd = msg as BridgeCommand;
        log.info("Received command: %s (id=%s)", cmd.action, cmd.id);

        try {
            const result = await executeCommand(cmd.action, cmd.payload);
            sendResponse(cmd.id, true, result);
        } catch (e) {
            log.error("Command failed:", cmd.action, e);
            sendResponse(cmd.id, false, { error: String(e) });
        }
    }
}

function sendResponse(id: string, ok: boolean, payload: Record<string, any>) {
    if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
            type: "command_response",
            id,
            ok,
            payload,
        }));
    }
}

function sendEvent(event: string, payload: Record<string, any>) {
    if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
            type: "event",
            event,
            payload,
        }));
    }
}

// ---------------------------------------------------------------------------
// Command executor — maps actions to Discord API calls
// ---------------------------------------------------------------------------

async function executeCommand(action: string, payload: Record<string, any>): Promise<Record<string, any>> {
    switch (action) {
        case "send_message": return cmdSendMessage(payload);
        case "join_voice": return cmdJoinVoice(payload);
        case "leave_voice": return cmdLeaveVoice();
        case "react": return cmdReact(payload);
        case "edit_message": return cmdEditMessage(payload);
        case "delete_message": return cmdDeleteMessage(payload);
        case "typing": return cmdTyping(payload);
        case "get_channels": return cmdGetChannels();
        case "get_guilds": return cmdGetGuilds();
        case "get_voice_state": return cmdGetVoiceState();
        case "get_members": return cmdGetMembers(payload);
        case "get_current_user": return cmdGetCurrentUser();
        case "config_updated": return cmdConfigUpdated(payload);
        default:
            return { error: `Unknown action: ${action}` };
    }
}

// --- Command implementations ---

async function cmdSendMessage(payload: Record<string, any>): Promise<Record<string, any>> {
    const { channel_id, content, reply_to } = payload;
    if (!channel_id || !content) return { error: "Missing channel_id or content" };

    const channel = ChannelStore.getChannel(channel_id);
    if (!channel) return { error: `Channel ${channel_id} not found` };

    const data: Record<string, any> = {
        content,
        invalidEmojis: [],
        tts: false,
        validNonShortcutEmojis: [],
    };

    // Use Equicord's compatibility wrapper instead of calling Discord's
    // frequently-changing internal sendMessage signature directly. Passing an
    // options object is required by current Discord PTB builds (they read the
    // nonce field from it).
    const options = reply_to
        ? { messageReference: { channel_id, message_id: reply_to } }
        : {};

    await sendMessage(channel_id, data, true, options);
    return { ok: true };
}

function cmdJoinVoice(payload: Record<string, any>): Record<string, any> {
    const { channel_id } = payload;
    if (!channel_id) return { error: "Missing channel_id" };

    const channel = ChannelStore.getChannel(channel_id);
    if (!channel) return { error: `Channel ${channel_id} not found` };

    // Check if it's a voice channel (type 2 = GUILD_VOICE, type 13 = GUILD_STAGE_VOICE)
    if (channel.type !== 2 && channel.type !== 13) {
        return { error: `Channel ${channel_id} is not a voice channel (type=${channel.type})` };
    }

    ChannelActions.selectVoiceChannel(channel_id, false, true);
    return { ok: true, channel_id };
}

function cmdLeaveVoice(): Record<string, any> {
    ChannelActions.selectVoiceChannel(null, false, true);
    return { ok: true };
}

function cmdReact(payload: Record<string, any>): Record<string, any> {
    const { channel_id, message_id, emoji } = payload;
    if (!channel_id || !message_id || !emoji) {
        return { error: "Missing channel_id, message_id, or emoji" };
    }

    RestAPI.put({
        url: `${Constants.Endpoints.REACTION(channel_id, message_id, emoji, "@me")}`,
    });

    return { ok: true };
}

function cmdEditMessage(payload: Record<string, any>): Record<string, any> {
    const { channel_id, message_id, content } = payload;
    if (!channel_id || !message_id || !content) {
        return { error: "Missing channel_id, message_id, or content" };
    }

    MessageActions.editMessage(channel_id, message_id, { content });
    return { ok: true };
}

function cmdDeleteMessage(payload: Record<string, any>): Record<string, any> {
    const { channel_id, message_id } = payload;
    if (!channel_id || !message_id) {
        return { error: "Missing channel_id or message_id" };
    }

    MessageActions.deleteMessage(channel_id, message_id);
    return { ok: true };
}

function cmdTyping(payload: Record<string, any>): Record<string, any> {
    const { channel_id } = payload;
    if (!channel_id) return { error: "Missing channel_id" };

    FluxDispatcher.dispatch({
        type: "TYPING_START_LOCAL",
        channelId: channel_id,
    });

    return { ok: true };
}

function cmdGetChannels(): Record<string, any> {
    const guildId = SelectedGuildStore.getGuildId();
    if (!guildId) {
        // DMs — get private channels
        const channels = ChannelStore.getSortedPrivateChannels?.() ?? [];
        return {
            channels: channels.map((ch: any) => ({
                id: ch.id,
                name: ch.name || ch.recipients?.map((u: any) => u.username).join(", ") || "DM",
                type: ch.type,
            })),
        };
    }

    const guild = GuildStore.getGuild(guildId);
    const channelsObj = GuildChannelStore.getChannels(guildId);
    const selectable = channelsObj?.SELECTABLE ?? [];
    const vocal = channelsObj?.VOCAL ?? [];

    return {
        guild_id: guildId,
        guild_name: guild?.name,
        channels: [...selectable, ...vocal].map((ch: any) => ({
            id: ch.channel?.id ?? ch.id,
            name: ch.channel?.name ?? ch.name,
            type: ch.channel?.type ?? ch.type,
            guild_id: ch.channel?.guild_id ?? ch.guild_id,
        })),
    };
}

function cmdGetGuilds(): Record<string, any> {
    const guilds = GuildStore.getGuilds();
    return {
        guilds: Object.values(guilds).map((g: any) => ({
            id: g.id,
            name: g.name,
            icon: g.icon,
            owner_id: g.ownerId,
        })),
    };
}

function cmdGetVoiceState(): Record<string, any> {
    const currentUserId = UserStore.getCurrentUser()?.id;
    const voiceChannelId = SelectedChannelStore.getVoiceChannelId();
    const guildId = SelectedGuildStore.getGuildId();

    let users: any[] = [];
    if (voiceChannelId) {
        const voiceStates = VoiceStateStore.getVoiceStatesForChannel(voiceChannelId);
        users = Object.entries(voiceStates).map(([userId, state]: [string, any]) => ({
            user_id: userId,
            username: UserStore.getUser(userId)?.username,
            mute: state.mute,
            self_mute: state.selfMute,
            deaf: state.selfDeaf,
            self_deaf: state.selfDeaf,
        }));
    }

    return {
        connected: !!voiceChannelId,
        channel_id: voiceChannelId,
        guild_id: guildId,
        current_user_id: currentUserId,
        users,
    };
}

function cmdGetMembers(payload: Record<string, any>): Record<string, any> {
    const guildId = payload.guild_id || SelectedGuildStore.getGuildId();
    if (!guildId) return { error: "No guild_id provided and no guild selected" };

    // Voice members
    const voiceChannelId = SelectedChannelStore.getVoiceChannelId();
    if (voiceChannelId) {
        const voiceStates = VoiceStateStore.getVoiceStatesForChannel(voiceChannelId);
        return {
            guild_id: guildId,
            channel_id: voiceChannelId,
            members: Object.entries(voiceStates).map(([userId, state]: [string, any]) => ({
                user_id: userId,
                username: UserStore.getUser(userId)?.username,
                mute: state.mute,
                self_mute: state.selfMute,
                deaf: state.selfDeaf,
            })),
        };
    }

    return { guild_id: guildId, members: [] };
}

function cmdGetCurrentUser(): Record<string, any> {
    const user = UserStore.getCurrentUser();
    if (!user) return { error: "Not logged in" };
    return {
        id: user.id,
        username: user.username,
        discriminator: user.discriminator,
        avatar: user.avatar,
        bot: user.bot,
    };
}

function cmdConfigUpdated(payload: Record<string, any>): Record<string, any> {
    // Sync backend config into plugin settings (only fields the plugin uses)
    if (payload.command_prefix !== undefined) {
        settings.store.commandPrefix = payload.command_prefix;
    }
    if (payload.channel_list !== undefined) {
        settings.store.watchedChannels = Array.isArray(payload.channel_list)
            ? payload.channel_list.join(",")
            : payload.channel_list;
    }
    if (payload.auto_reply !== undefined) {
        settings.store.autoReply = payload.auto_reply;
    }
    if (payload.enabled !== undefined) {
        settings.store.autoConnect = payload.enabled;
    }
    log.info("Config synced from backend: prefix=%s channels=%s autoReply=%s enabled=%s",
        settings.store.commandPrefix, settings.store.watchedChannels, settings.store.autoReply, settings.store.autoConnect);
    return { ok: true };
}

// ---------------------------------------------------------------------------
// Event forwarding — send Discord events to the AI backend
// ---------------------------------------------------------------------------

export function startForwarding(forwardMessages: boolean, forwardVoice: boolean, forwardTyping: boolean) {
    stopForwarding();

    if (forwardMessages) {
        FluxDispatcher.subscribe("MESSAGE_CREATE", onMessageCreate);
    }
    if (forwardVoice) {
        FluxDispatcher.subscribe("VOICE_STATE_UPDATES", onVoiceStateUpdates);
        FluxDispatcher.subscribe("PASSIVE_UPDATE_V1", onPassiveUpdate);
    }
    if (forwardTyping) {
        FluxDispatcher.subscribe("TYPING_START", onTypingStart);
    }
}

export function stopForwarding() {
    FluxDispatcher.unsubscribe("MESSAGE_CREATE", onMessageCreate);
    FluxDispatcher.unsubscribe("VOICE_STATE_UPDATES", onVoiceStateUpdates);
    FluxDispatcher.unsubscribe("PASSIVE_UPDATE_V1", onPassiveUpdate);
    FluxDispatcher.unsubscribe("TYPING_START", onTypingStart);
}

function onMessageCreate({ message, optimistic }: { message: any; optimistic?: boolean; }) {
    if (optimistic) return;
    if (!message?.channel_id) return;

    // Skip bot messages and our own
    if (message.author?.bot) return;
    const currentUserId = UserStore.getCurrentUser()?.id;
    if (message.author?.id === currentUserId) return;

    sendEvent("message_create", {
        id: message.id,
        channel_id: message.channel_id,
        guild_id: message.guild_id,
        author: {
            id: message.author?.id,
            username: message.author?.username,
            discriminator: message.author?.discriminator,
            bot: message.author?.bot,
        },
        content: message.content,
        timestamp: message.timestamp,
        attachments: message.attachments?.map((a: any) => ({
            id: a.id,
            filename: a.filename,
            url: a.url,
            size: a.size,
        })),
        embeds: message.embeds,
        mention_everyone: message.mention_everyone,
        mentions: message.mentions?.map((m: any) => m.id ?? m),
    });
}

function onVoiceStateUpdates(event: { voiceStates: any[]; }) {
    for (const state of event.voiceStates ?? []) {
        sendEvent("voice_state_update", {
            user_id: state.userId,
            channel_id: state.channelId,
            old_channel_id: state.oldChannelId,
            guild_id: state.guildId,
            mute: state.mute,
            self_mute: state.selfMute,
            deaf: state.deaf,
            self_deaf: state.selfDeaf,
            session_id: state.sessionId,
        });
    }
}

function onPassiveUpdate(event: { voiceStates: any[]; guildId?: string; }) {
    // Passive updates are batched voice state changes for large guilds
    // We treat them the same as regular voice state updates
    for (const state of event.voiceStates ?? []) {
        sendEvent("voice_state_update", {
            user_id: state.userId,
            channel_id: state.channelId,
            old_channel_id: state.oldChannelId,
            guild_id: state.guildId || event.guildId,
            mute: state.mute,
            self_mute: state.selfMute,
            deaf: state.deaf,
            self_deaf: state.selfDeaf,
        });
    }
}

function onTypingStart(event: { channelId: string; userId: string; timestamp: number; }) {
    sendEvent("typing_start", {
        channel_id: event.channelId,
        user_id: event.userId,
        timestamp: event.timestamp,
    });
}
