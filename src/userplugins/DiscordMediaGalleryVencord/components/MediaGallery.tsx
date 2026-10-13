/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Button } from "@components/Button";
import ErrorBoundary from "@components/ErrorBoundary";
import { Message, RenderModalProps } from "@vencord/discord-types";
import { ChannelStore, Modal, showToast, Toasts, useEffect, useMemo, useRef, useState } from "@webpack/common";

import { DownloadManager } from "../downloadManager";
import { fetchOlderMessages, getMessagesFromStore, getOldestMessageId, mergeMessages, scanMessagesForMedia } from "../mediaScanner";
import { DownloadProgressState, FilterType, MediaItem, SortOrder } from "../types";
import { ChannelSelector } from "./ChannelSelector";
import { DownloadModal } from "./DownloadModal";
import { DownloadProgress } from "./DownloadProgress";
import { GalleryToolbar } from "./GalleryToolbar";
import { MediaGrid } from "./MediaGrid";
import { MediaPreview } from "./MediaPreview";

interface MediaGalleryModalProps {
    initialChannelId: string;
    modalProps: RenderModalProps;
    defaultFilter?: FilterType;
    concurrency?: number;
    confirmDownload?: boolean;
}

export function MediaGalleryModal({
    initialChannelId,
    modalProps,
    defaultFilter = "all",
    concurrency = 3,
    confirmDownload = true
}: MediaGalleryModalProps) {
    const [channelId, setChannelId] = useState(initialChannelId);
    const [filter, setFilter] = useState<FilterType>(defaultFilter);
    const [searchQuery, setSearchQuery] = useState("");
    const [sortOrder, setSortOrder] = useState<SortOrder>("newest");
    const [dateFrom, setDateFrom] = useState("");
    const [dateTo, setDateTo] = useState("");
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

    // Messages and media state
    const [allMessages, setAllMessages] = useState<Message[]>([]);
    const [isLoadingMore, setIsLoadingMore] = useState(false);
    const [hasMore, setHasMore] = useState(true);

    // Sub-views
    const [activePreviewItem, setActivePreviewItem] = useState<MediaItem | null>(null);
    const [isConfirmingDownload, setIsConfirmingDownload] = useState(false);
    const [downloadProgress, setDownloadProgress] = useState<DownloadProgressState | null>(null);

    const downloadManagerRef = useRef<DownloadManager>(new DownloadManager(concurrency));
    const abortControllerRef = useRef<AbortController | null>(null);

    // Initial load when channel changes
    useEffect(() => {
        setSelectedIds(new Set());
        setActivePreviewItem(null);
        setIsConfirmingDownload(false);
        setDownloadProgress(null);

        const storeMessages = getMessagesFromStore(channelId);
        setAllMessages(storeMessages);
        setHasMore(true);
        setIsLoadingMore(true);
        const controller = new AbortController();
        abortControllerRef.current = controller;
        (async () => {
            let combined = storeMessages;
            let before = getOldestMessageId(combined);
            while (!controller.signal.aborted) {
                const older = await fetchOlderMessages(channelId, before, 100);
                if (older.length === 0) break;
                const previousOldest = before;
                combined = mergeMessages(combined, older);
                before = getOldestMessageId(older, before);
                if (!controller.signal.aborted) setAllMessages(combined);
                if (!before || before === previousOldest) break;
                if (dateFrom) {
                    const rangeStart = new Date(dateFrom).getTime();
                    const oldestTimestamp = Math.min(...older.map(message => Date.parse(String((message as any).timestamp)) || 0));
                    if (rangeStart && oldestTimestamp && oldestTimestamp <= rangeStart) break;
                }
                await new Promise(resolve => setTimeout(resolve, 0));
            }
            if (!controller.signal.aborted) setHasMore(false);
        })().catch(() => undefined).finally(() => {
            if (!controller.signal.aborted) setIsLoadingMore(false);
        });

        return () => {
            controller.abort();
        };
    }, [channelId, dateFrom]);

    // Setup download manager callbacks
    useEffect(() => {
        const dm = downloadManagerRef.current;
        dm.setConcurrency(concurrency);
        dm.onProgress(progress => {
            setDownloadProgress({ ...progress });
        });
    }, [concurrency]);

    // Parse all media from messages
    const allMediaItems = useMemo(() => {
        return scanMessagesForMedia(allMessages);
    }, [allMessages]);

    // Filter & search
    const filteredItems = useMemo(() => {
        let result = allMediaItems;

        if (filter === "images") {
            result = result.filter(i => i.type === "image");
        } else if (filter === "videos") {
            result = result.filter(i => i.type === "video" && i.source !== "gifv");
        } else if (filter === "gifs") {
            result = result.filter(i => i.type === "gif" || i.source === "gifv");
        }

        if (searchQuery.trim()) {
            const query = searchQuery.toLowerCase().trim();
            result = result.filter(i => i.filename.toLowerCase().includes(query));
        }

        const from = dateFrom ? new Date(dateFrom).getTime() : 0;
        const to = dateTo ? new Date(dateTo).getTime() : Number.MAX_SAFE_INTEGER;
        if (from || dateTo) {
            result = result.filter(item => item.timestamp >= from && item.timestamp <= to);
        }

        const sorted = [...result];
        if (sortOrder === "newest") {
            sorted.sort((a, b) => b.timestamp - a.timestamp);
        } else if (sortOrder === "oldest") {
            sorted.sort((a, b) => a.timestamp - b.timestamp);
        } else if (sortOrder === "name_asc") {
            sorted.sort((a, b) => a.filename.localeCompare(b.filename));
        } else if (sortOrder === "name_desc") {
            sorted.sort((a, b) => b.filename.localeCompare(a.filename));
        }

        return sorted;
    }, [allMediaItems, filter, searchQuery, sortOrder, dateFrom, dateTo]);

    // Counts for filter tabs
    const counts = useMemo(() => {
        return {
            all: allMediaItems.length,
            images: allMediaItems.filter(i => i.type === "image").length,
            videos: allMediaItems.filter(i => i.type === "video" && i.source !== "gifv").length,
            gifs: allMediaItems.filter(i => i.type === "gif" || i.source === "gifv").length
        };
    }, [allMediaItems]);

    // Selected items
    const selectedItems = useMemo(() => {
        return allMediaItems.filter(i => selectedIds.has(i.id));
    }, [allMediaItems, selectedIds]);

    const handleToggleSelect = (id: string) => {
        setSelectedIds(prev => {
            const next = new Set(prev);
            if (next.has(id)) {
                next.delete(id);
            } else {
                next.add(id);
            }
            return next;
        });
    };

    const handleSelectAll = () => {
        setSelectedIds(prev => {
            const next = new Set(prev);
            for (const item of filteredItems) {
                if (item.downloadable) {
                    next.add(item.id);
                }
            }
            return next;
        });
    };

    const handleClearSelection = () => {
        setSelectedIds(new Set());
    };

    const handleLoadMore = async () => {
        if (isLoadingMore || allMessages.length === 0) return;

        setIsLoadingMore(true);
        abortControllerRef.current = new AbortController();

        try {
            // Find oldest message in current array
            const oldestMessage = allMessages.find(message => message.id === getOldestMessageId(allMessages));

            const older = await fetchOlderMessages(
                channelId,
                oldestMessage?.id,
                100
            );

            if (older.length > 0) {
                setAllMessages(prev => mergeMessages(prev, older));
            } else {
                setHasMore(false);
                showToast("Reached beginning of channel history", Toasts.Type.MESSAGE);
            }
        } catch {
            showToast("Failed to fetch older messages", Toasts.Type.FAILURE);
        } finally {
            setIsLoadingMore(false);
        }
    };

    // Download triggers
    const handleStartBulkDownload = () => {
        if (selectedItems.length === 0) return;

        if (confirmDownload && !isConfirmingDownload) {
            setIsConfirmingDownload(true);
            return;
        }

        setIsConfirmingDownload(false);
        downloadManagerRef.current.start(selectedItems);
    };

    const handleDownloadSingle = (item: MediaItem) => {
        downloadManagerRef.current.start([item]);
    };

    const channelName = useMemo(() => {
        try {
            const ch = ChannelStore.getChannel(channelId);
            return ch?.name ? `#${ch.name}` : "Channel";
        } catch {
            return "Channel";
        }
    }, [channelId]);

    return (
        <ErrorBoundary>
            <Modal
                {...modalProps}
                size="xl"
                title={
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <span>Media Gallery</span>
                        <ChannelSelector
                            currentChannelId={channelId}
                            onSelectChannel={setChannelId}
                        />
                    </div>
                }
            >
                <div className="vc-media-gallery-modal">
                    {activePreviewItem ? (
                        <MediaPreview
                            item={activePreviewItem}
                            items={filteredItems}
                            onClosePreview={() => setActivePreviewItem(null)}
                            onDownloadSingle={handleDownloadSingle}
                            onSelectIndex={idx => setActivePreviewItem(filteredItems[idx] || null)}
                        />
                    ) : isConfirmingDownload ? (
                        <DownloadModal
                            items={selectedItems}
                            channelName={channelName}
                            onConfirm={handleStartBulkDownload}
                            onCancel={() => setIsConfirmingDownload(false)}
                        />
                    ) : downloadProgress ? (
                        <DownloadProgress
                            progress={downloadProgress}
                            onCancel={() => downloadManagerRef.current.cancel()}
                            onRetry={() => downloadManagerRef.current.retryFailed()}
                            onClose={() => setDownloadProgress(null)}
                        />
                    ) : (
                        <>
                            <GalleryToolbar
                                filter={filter}
                                onFilterChange={setFilter}
                                counts={counts}
                                searchQuery={searchQuery}
                                onSearchChange={setSearchQuery}
                                sortOrder={sortOrder}
                                onSortChange={setSortOrder}
                                onSelectAll={handleSelectAll}
                                onClearSelection={handleClearSelection}
                                selectedCount={selectedIds.size}
                                filteredCount={filteredItems.length}
                                dateFrom={dateFrom}
                                dateTo={dateTo}
                                onDateFromChange={setDateFrom}
                                onDateToChange={setDateTo}
                            />

                            <MediaGrid
                                items={filteredItems}
                                selectedIds={selectedIds}
                                onToggleSelect={handleToggleSelect}
                                onOpenPreview={setActivePreviewItem}
                                onLoadMore={handleLoadMore}
                                isLoadingMore={isLoadingMore}
                                hasMore={hasMore}
                            />

                            <div className="vc-mg-footer">
                                <div className="vc-mg-footer-left">
                                    <span style={{ fontWeight: 600, color: "var(--text-normal)" }}>
                                        {selectedIds.size} selected
                                    </span>
                                    <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
                                        ({filteredItems.length} displayed / {allMediaItems.length} total)
                                    </span>
                                </div>

                                <div className="vc-mg-footer-right">
                                    {selectedIds.size > 0 && (
                                        <Button
                                            variant="secondary"
                                            onClick={handleClearSelection}
                                        >
                                            Clear
                                        </Button>
                                    )}
                                    <Button
                                        variant="primary"
                                        disabled={selectedIds.size === 0}
                                        onClick={handleStartBulkDownload}
                                    >
                                        Download Selected ({selectedIds.size})
                                    </Button>
                                </div>
                            </div>
                        </>
                    )}
                </div>
            </Modal>
        </ErrorBoundary>
    );
}
