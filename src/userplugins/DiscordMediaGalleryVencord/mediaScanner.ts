/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Message, MessageAttachment } from "@vencord/discord-types";
import { Constants, MessageStore, RestAPI } from "@webpack/common";

import { fixMediaUrl, getFilenameFromUrl, sanitizeFilename } from "./mediaUtils";
import { MediaItem, MediaType } from "./types";

const IMAGE_EXTENSIONS = new Set(["jpg", "jpeg", "png", "webp", "avif"]);
const VIDEO_EXTENSIONS = new Set(["mp4", "webm", "mov", "m4v"]);
const messageMediaCache = new Map<string, MediaItem[]>();

function getFileExtension(filename: string): string {
    const parts = filename.toLowerCase().split(".");
    return parts.length > 1 ? parts.pop()! : "";
}

function classifyMedia(contentType?: string, filename = ""): MediaType | null {
    const ext = getFileExtension(filename);

    if (contentType) {
        const lowerType = contentType.toLowerCase();
        if (lowerType === "image/gif" || ext === "gif") {
            return "gif";
        }
        if (lowerType.startsWith("image/")) {
            return "image";
        }
        if (lowerType.startsWith("video/")) {
            return "video";
        }
    }

    if (ext === "gif") return "gif";
    if (IMAGE_EXTENSIONS.has(ext)) return "image";
    if (VIDEO_EXTENSIONS.has(ext)) return "video";

    return null;
}

function parseMessageTimestamp(message: any): number {
    if (message.timestamp) {
        if (typeof message.timestamp === "number") return message.timestamp;
        if (typeof message.timestamp.toDate === "function") return message.timestamp.toDate().getTime();
        if (message.timestamp instanceof Date) return message.timestamp.getTime();
        const parsed = Date.parse(message.timestamp);
        if (!isNaN(parsed)) return parsed;
    }
    return Date.now();
}

export function parseMessageMedia(message: Message): MediaItem[] {
    const items: MediaItem[] = [];
    if (!message) return items;

    const channelId = message.channel_id;
    const messageId = message.id;
    const authorId = message.author?.id;
    const authorName = message.author?.username;
    const messageContent = message.content;
    const timestamp = parseMessageTimestamp(message);

    // 1. Process attachments
    if (Array.isArray(message.attachments)) {
        for (const att of message.attachments as MessageAttachment[]) {
            if (!att || !att.url) continue;

            const mediaType = classifyMedia(att.content_type, att.filename);
            if (!mediaType) continue; // Skip non-media (PDF, ZIP, EXE, etc.)

            const cleanUrl = fixMediaUrl(att.url);
            const defaultExt = mediaType === "gif" ? "gif" : mediaType === "video" ? "mp4" : "png";
            const safeName = sanitizeFilename(att.filename, `${mediaType}_${att.id}.${defaultExt}`);

            items.push({
                id: `att_${att.id}`,
                messageId,
                channelId,
                type: mediaType,
                url: cleanUrl,
                proxyUrl: att.proxy_url,
                thumbnailUrl: att.proxy_url || cleanUrl,
                filename: safeName,
                contentType: att.content_type,
                width: att.width,
                height: att.height,
                size: att.size,
                timestamp,
                authorId,
                authorName,
                messageContent,
                downloadable: true,
                source: mediaType === "gif" ? "gif" : "attachment"
            });
        }
    }

    // 2. Process embeds
    if (Array.isArray(message.embeds)) {
        for (let i = 0; i < message.embeds.length; i++) {
            const embed = message.embeds[i];
            if (!embed) continue;

            const embedType = (embed.type as string)?.toLowerCase();

            // GIFV or Video embed
            if (embedType === "gifv" || embed.video) {
                const videoUrl = embed.video?.url || (embedType === "gifv" && embed.url && /\.(mp4|webm|mov)(\?|$)/i.test(embed.url) ? embed.url : undefined);
                if (videoUrl) {
                    const cleanUrl = fixMediaUrl(videoUrl);
                    const defaultName = `video_${messageId}_${i}.mp4`;
                    const filename = getFilenameFromUrl(cleanUrl, defaultName);

                    items.push({
                        id: `embed_vid_${messageId}_${i}_${embed.id || ""}`,
                        messageId,
                        channelId,
                        type: "video",
                        url: cleanUrl,
                        proxyUrl: embed.video?.proxyURL,
                        thumbnailUrl: embed.thumbnail?.proxyURL || embed.thumbnail?.url || embed.image?.proxyURL || embed.image?.url,
                        filename,
                        contentType: embed.video?.contentType || "video/mp4",
                        width: embed.video?.width,
                        height: embed.video?.height,
                        timestamp,
                        authorId,
                        authorName,
                        messageContent,
                        downloadable: true,
                        source: embedType === "gifv" ? "gifv" : "embed"
                    });
                }
            } else if (embedType === "image" || embed.image) {
                const imgUrl = embed.image?.url || embed.url;
                if (imgUrl) {
                    const cleanUrl = fixMediaUrl(imgUrl);
                    const defaultName = `image_${messageId}_${i}.png`;
                    const filename = getFilenameFromUrl(cleanUrl, defaultName);

                    items.push({
                        id: `embed_img_${messageId}_${i}_${embed.id || ""}`,
                        messageId,
                        channelId,
                        type: "image",
                        url: cleanUrl,
                        proxyUrl: embed.image?.proxyURL,
                        thumbnailUrl: embed.image?.proxyURL || cleanUrl,
                        filename,
                        contentType: embed.image?.contentType || "image/png",
                        width: embed.image?.width,
                        height: embed.image?.height,
                        timestamp,
                        authorId,
                        authorName,
                        messageContent,
                        downloadable: true,
                        source: "embed"
                    });
                }
            }
        }
    }

    return items;
}

export function getMessagesFromStore(channelId: string): Message[] {
    try {
        const channelMessages = MessageStore.getMessages(channelId);
        if (!channelMessages) return [];
        if (Array.isArray(channelMessages)) return channelMessages;
        if (Array.isArray((channelMessages as any)._array)) return (channelMessages as any)._array;
        if (typeof (channelMessages as any).forEach === "function") {
            const list: Message[] = [];
            (channelMessages as any).forEach((m: Message) => {
                if (m) list.push(m);
            });
            return list;
        }
    } catch {
        // Ignore store errors
    }
    return [];
}

export function scanMessagesForMedia(messages: Message[]): MediaItem[] {
    const items: MediaItem[] = [];
    const seenIds = new Set<string>();

    for (const msg of messages) {
        if (!msg) continue;
        let msgMedia = messageMediaCache.get(msg.id);
        if (!msgMedia) {
            try {
                msgMedia = parseMessageMedia(msg);
                messageMediaCache.set(msg.id, msgMedia);
            } catch {
                // A malformed attachment/embed must not abort the whole channel scan.
                continue;
            }
        }
        for (const item of msgMedia) {
            if (!seenIds.has(item.id)) {
                seenIds.add(item.id);
                items.push(item);
            }
        }
    }

    // Sort newest first
    return items.sort((a, b) => b.timestamp - a.timestamp);
}

export async function fetchOlderMessages(
    channelId: string,
    beforeMessageId?: string,
    limit = 100
): Promise<Message[]> {
    if (!channelId) return [];

    const query: Record<string, any> = { limit: Math.min(Math.max(limit, 1), 100) };
    if (beforeMessageId) query.before = beforeMessageId;
    for (let attempt = 0; attempt < 4; attempt++) {
        try {
            const res = await RestAPI.get({
                url: Constants.Endpoints.MESSAGES(channelId),
                query,
                retries: 2
            });
            if (Array.isArray(res?.body)) return res.body as Message[];
        } catch {
            if (attempt === 3) throw new Error("Message page request failed");
        }
        await new Promise(resolve => setTimeout(resolve, 500 * (attempt + 1)));
    }
    return [];
}

export function mergeMessages(current: Message[], incoming: Message[]): Message[] {
    const byId = new Map<string, Message>();
    for (const message of [...current, ...incoming]) {
        if (message?.id) byId.set(message.id, message);
    }
    return [...byId.values()].sort((a, b) => compareSnowflake(b.id, a.id));
}

export function compareSnowflake(a?: string, b?: string): number {
    if (!a) return -1;
    if (!b) return 1;
    try {
        const left = BigInt(a);
        const right = BigInt(b);
        return left < right ? -1 : left > right ? 1 : 0;
    } catch {
        return a.localeCompare(b);
    }
}

export function getOldestMessageId(messages: Message[], fallback?: string): string | undefined {
    return messages.reduce<string | undefined>((oldest, message) => {
        if (!message?.id) return oldest;
        return !oldest || compareSnowflake(message.id, oldest) < 0 ? message.id : oldest;
    }, fallback);
}
