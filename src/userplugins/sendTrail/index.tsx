/*
 * TrashCord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { MessageObject, SendMessageOptions } from "@api/MessageEvents";
import ErrorBoundary from "@components/ErrorBoundary";
import { ClockIcon } from "@components/Icons";
import SettingsPlugin from "@plugins/_core/settings";
import { Devs } from "@utils/constants";
import { LazyComponent } from "@utils/lazyReact";
import definePlugin from "@utils/types";
import { ChannelStore, GuildStore, MessageStore, UserStore } from "@webpack/common";

import RuntimeActivityButton from "../_kamidereCompat/RuntimeActivityButton";
import { removeKamidereRuntimeTask, SEND_TRAIL_PURGE_TASK_ID } from "../_kamidereCompat/runtimeActivity";
import { settings } from "./settings";
import { appendSentTrailRecord, clearSentTrailRecordsWhere, hasSentTrailRecord, mayHaveSentTrailRecord, mergeSentTrailRecordMedia, removeSentTrailRecord } from "./store";
import managedStyle from "./styles.css?managed";
import type { MessageCreatePayload, MessageDeletePayload, MessageUpdatePayload, PendingSendDraft, SendTrailMessage, SentTrailRecord } from "./types";
import { buildJumpLink, collectMessageMediaItems, getChannelRecipientIds, getMessageDisplayContent, getMessageTimestamp, getRecordPreview, hasMediaLinks, isForwardedMessage, makeAttachmentSignature, makeUploadSignature, normalizeContent } from "./utils";

const DRAFT_TTL_MS = 20_000;
const MIN_MATCH_SCORE = 4;
const SEND_TRAIL_SETTINGS_KEY = "kamidere_send_trail";
const HEADER_BAR_SETTINGS: ["showActivityButton"] = ["showActivityButton"];
const SendTrailTab = LazyComponent(() => require("./SendTrailTab").default);

let draftCounter = 0;
const pendingDrafts = new Map<string, PendingSendDraft>();

const ActivityButton = ErrorBoundary.wrap(() => {
    const { showActivityButton } = settings.use(HEADER_BAR_SETTINGS);
    return showActivityButton ? <RuntimeActivityButton /> : null;
}, { noop: true });

function cleanupExpiredDrafts() {
    if (!pendingDrafts.size) return;
    const now = Date.now();
    for (const [key, draft] of pendingDrafts) {
        if (now - draft.createdAt > DRAFT_TTL_MS) pendingDrafts.delete(key);
    }
}

function createPendingDraft(channelId: string, messageObj: MessageObject, options: SendMessageOptions) {
    const ownerId = UserStore.getCurrentUser()?.id;
    if (!ownerId) return;
    cleanupExpiredDrafts();

    const content = options.content ?? messageObj.content ?? "";
    const normalizedContent = normalizeContent(content);
    const localId = `${Date.now()}-${++draftCounter}`;

    pendingDrafts.set(localId, {
        localId,
        ownerId,
        channelId,
        createdAt: Date.now(),
        content,
        normalizedContent,
        hasText: normalizedContent.length > 0,
        mediaHint: (options.uploads?.length ?? 0) > 0 || hasMediaLinks(content),
        uploadSignature: makeUploadSignature({ uploads: options.uploads }),
        replyMessageId: options.messageReference?.message_id,
    });
}

function resolveBestDraft(message: SendTrailMessage) {
    if (!pendingDrafts.size) return null;

    const content = normalizeContent(getMessageDisplayContent(message, message.content ?? ""));
    const signature = makeAttachmentSignature(message.attachments ?? []);
    const hasMedia = collectMessageMediaItems(message).length > 0;
    const replyId = (message.messageReference ?? message.message_reference)?.message_id;
    const now = Date.now();

    let best: PendingSendDraft | null = null;
    let bestScore = Number.NEGATIVE_INFINITY;

    for (const draft of pendingDrafts.values()) {
        if (draft.channelId !== message.channel_id || draft.ownerId !== message.author?.id || now - draft.createdAt > DRAFT_TTL_MS) continue;

        let score = 2;
        if (draft.normalizedContent === content) score += 6;
        if (draft.replyMessageId && draft.replyMessageId === replyId) score += 2;
        if (draft.uploadSignature && draft.uploadSignature === signature) score += 4;
        else if (!draft.uploadSignature && !signature) score += 1;
        if (draft.mediaHint === hasMedia) score += 1;
        if (draft.mediaHint && hasMedia) score += 2;
        if (draft.hasText === (content.length > 0)) score += 1;
        score -= Math.min(4, (now - draft.createdAt) / 2000);

        if (score > bestScore || (score === bestScore && best && draft.createdAt > best.createdAt)) {
            best = draft;
            bestScore = score;
        }
    }

    if (!best || bestScore < MIN_MATCH_SCORE) return null;

    pendingDrafts.delete(best.localId);
    return best;
}

function getPlace(channelId: string, eventGuildId?: string) {
    const channel = ChannelStore.getChannel(channelId);
    const guildId = eventGuildId ?? channel?.guild_id ?? "@me";
    return { channel, guildId, guild: guildId !== "@me" ? GuildStore.getGuild(guildId) : null };
}

function buildRecord(message: SendTrailMessage, eventGuildId?: string, draft?: PendingSendDraft | null): SentTrailRecord {
    const { channel, guildId, guild } = getPlace(message.channel_id, eventGuildId ?? message.guild_id);
    const content = getMessageDisplayContent(message, draft?.content ?? "");
    const media = collectMessageMediaItems(message);

    return {
        id: `${message.channel_id}:${message.id}`,
        messageId: message.id,
        channelId: message.channel_id,
        guildId,
        timestamp: getMessageTimestamp(message),
        content,
        preview: getRecordPreview(content),
        hasText: normalizeContent(content).length > 0,
        hasMedia: media.length > 0,
        jumpLink: buildJumpLink(guildId, message.channel_id, message.id),
        media,
        channelNameSnapshot: channel?.name ?? undefined,
        guildNameSnapshot: guild?.name ?? undefined,
        recipientUserIds: getChannelRecipientIds(channel),
        replyMessageId: (message.messageReference ?? message.message_reference)?.message_id ?? draft?.replyMessageId,
    };
}

async function handleUpdate(payload: MessageUpdatePayload) {
    const currentUserId = UserStore.getCurrentUser()?.id;
    if (!currentUserId) return;

    const { channel_id: channelId, id: messageId } = payload.message;
    const cached = MessageStore.getMessage(channelId, messageId);
    if ((payload.message.author?.id ?? cached?.author.id) !== currentUserId) return;

    const eventGuildId = payload.guildId ?? payload.message.guild_id;
    const source = cached && isForwardedMessage(cached) ? cached : payload.message;

    if (isForwardedMessage(source) && !hasSentTrailRecord(currentUserId, channelId, messageId)) {
        await appendSentTrailRecord(buildRecord(source, eventGuildId));
    }

    const media = collectMessageMediaItems(payload.message);
    if (cached) media.push(...collectMessageMediaItems(cached));
    if (!media.length) return;

    const { channel, guildId, guild } = getPlace(channelId, eventGuildId);

    await mergeSentTrailRecordMedia(channelId, messageId, media, {
        guildId,
        jumpLink: buildJumpLink(guildId, channelId, messageId),
        channelNameSnapshot: channel?.name ?? undefined,
        guildNameSnapshot: guild?.name ?? undefined,
        recipientUserIds: getChannelRecipientIds(channel),
    });
}

function unregisterSendTrailSettingsTab() {
    const entries = SettingsPlugin.customEntries;
    for (let index = entries.length - 1; index >= 0; index--) {
        if (entries[index].key === SEND_TRAIL_SETTINGS_KEY) entries.splice(index, 1);
    }
}

function registerSendTrailSettingsTab() {
    unregisterSendTrailSettingsTab();

    SettingsPlugin.customEntries.push({
        key: SEND_TRAIL_SETTINGS_KEY,
        title: "Kamidere Send Trail",
        Component: SendTrailTab,
        Icon: ClockIcon,
    });
}

export default definePlugin({
    name: "SendTrail",
    description: "Tracks your newly sent messages, lets you select them, and purges them in a dedicated TrashCord settings page.",
    authors: [Devs.clrxxo, { name: "zfrancesck1", id: 456195985404592149n }],
    tags: ["Chat", "Utility"],
    enabledByDefault: false,
    managedStyle,
    requiresRestart: false,
    dependencies: ["Settings", "MessageEventsAPI", "HeaderBarAPI"],
    settings,
    headerBarButton: {
        icon: ClockIcon,
        render: () => <ActivityButton />
    },

    start() {
        registerSendTrailSettingsTab();
    },

    stop() {
        pendingDrafts.clear();
        removeKamidereRuntimeTask(SEND_TRAIL_PURGE_TASK_ID);
        unregisterSendTrailSettingsTab();
    },

    onBeforeMessageSend(channelId, messageObj, options) {
        createPendingDraft(channelId, messageObj, options);
    },

    flux: {
        async MESSAGE_CREATE(payload: MessageCreatePayload) {
            if (payload.optimistic || payload.type !== "MESSAGE_CREATE" || payload.message.state === "SENDING") return;

            const currentUserId = UserStore.getCurrentUser()?.id;
            if (!currentUserId || payload.message.author?.id !== currentUserId) return;

            cleanupExpiredDrafts();
            await appendSentTrailRecord(buildRecord(payload.message, payload.guildId, resolveBestDraft(payload.message)));
        },

        async MESSAGE_UPDATE(payload: MessageUpdatePayload) {
            await handleUpdate(payload);
        },

        async MESSAGE_DELETE(payload: MessageDeletePayload) {
            const userId = UserStore.getCurrentUser()?.id ?? null;
            if (!mayHaveSentTrailRecord(userId, payload.channelId, payload.id)) return;
            await removeSentTrailRecord(userId, payload.channelId, payload.id);
        },

        async MESSAGE_DELETE_BULK({ ids, channelId }: { ids: string[]; channelId: string; }) {
            const userId = UserStore.getCurrentUser()?.id ?? null;
            if (!userId) return;
            const deletedIds = new Set(ids);
            await clearSentTrailRecordsWhere(userId, record => record.channelId === channelId && deletedIds.has(record.messageId));
        },
    },
});