/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export type MediaType = "image" | "video" | "gif";

export type MediaSource = "attachment" | "embed" | "gif" | "gifv";

export interface MediaItem {
    id: string;
    messageId: string;
    channelId: string;
    type: MediaType;
    url: string;
    proxyUrl?: string;
    thumbnailUrl?: string;
    filename: string;
    contentType?: string;
    width?: number;
    height?: number;
    size?: number;
    timestamp: number;
    authorId?: string;
    authorName?: string;
    messageContent?: string;
    downloadable: boolean;
    source: MediaSource;
}

export type FilterType = "all" | "images" | "videos" | "gifs";

export type SortOrder = "newest" | "oldest" | "name_asc" | "name_desc";

export type DownloadStatus = "pending" | "downloading" | "success" | "failed" | "cancelled" | "requested";

export interface DownloadItemState {
    item: MediaItem;
    status: DownloadStatus;
    error?: string;
}

export interface DownloadProgressState {
    total: number;
    completed: number;
    failed: number;
    cancelled: number;
    requested: number;
    processed: number;
    currentFilename?: string;
    currentPercent?: number;
    inProgress: boolean;
    isCancelled: boolean;
    items: DownloadItemState[];
}

export interface ChannelOption {
    id: string;
    name: string;
    isThread?: boolean;
    isDM?: boolean;
}
