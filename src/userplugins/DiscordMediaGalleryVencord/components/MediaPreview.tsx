/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Button } from "@components/Button";
import { copyToClipboard } from "@utils/clipboard";
import { MessageActions, showToast, useEffect } from "@webpack/common";

import { formatBytes,formatDate } from "../mediaUtils";
import { MediaItem } from "../types";

interface MediaPreviewProps {
    item: MediaItem;
    items: MediaItem[];
    onClosePreview: () => void;
    onDownloadSingle: (item: MediaItem) => void;
    onSelectIndex: (index: number) => void;
}

export function MediaPreview({
    item,
    items,
    onClosePreview,
    onDownloadSingle,
    onSelectIndex
}: MediaPreviewProps) {
    const currentIndex = items.findIndex(i => i.id === item.id);
    const hasPrev = currentIndex > 0;
    const hasNext = currentIndex >= 0 && currentIndex < items.length - 1;

    const handlePrev = () => {
        if (hasPrev) {
            onSelectIndex(currentIndex - 1);
        }
    };

    const handleNext = () => {
        if (hasNext) {
            onSelectIndex(currentIndex + 1);
        }
    };

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === "ArrowLeft") {
                e.preventDefault();
                handlePrev();
            } else if (e.key === "ArrowRight") {
                e.preventDefault();
                handleNext();
            } else if (e.key === "Escape") {
                e.preventDefault();
                onClosePreview();
            }
        };

        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [currentIndex, items]);

    const handleOpenMessage = () => {
        try {
            MessageActions.jumpToMessage({
                channelId: item.channelId,
                messageId: item.messageId,
                flash: true,
                jumpType: "ANIMATED"
            });
            onClosePreview();
        } catch {
            showToast({ text: "Unable to jump to message", variant: "critical" });
        }
    };

    const handleCopyUrl = async () => {
        try {
            await copyToClipboard(item.url);
            showToast({ text: "Media URL copied to clipboard!", variant: "success" });
        } catch {
            showToast({ text: "Failed to copy URL", variant: "critical" });
        }
    };

    return (
        <div className="vc-mg-preview-container">
            <div className="vc-mg-preview-stage">
                {hasPrev && (
                    <button
                        type="button"
                        className="vc-mg-preview-nav-btn vc-mg-preview-nav-prev"
                        onClick={handlePrev}
                        aria-label="Previous media"
                    >
                        ‹
                    </button>
                )}

                {item.type === "video" ? (
                    <video
                        className="vc-mg-preview-media"
                        src={item.url}
                        controls
                        playsInline
                        preload="metadata"
                    />
                ) : (
                    <img
                        className="vc-mg-preview-media"
                        src={item.url}
                        alt={item.filename}
                    />
                )}

                {hasNext && (
                    <button
                        type="button"
                        className="vc-mg-preview-nav-btn vc-mg-preview-nav-next"
                        onClick={handleNext}
                        aria-label="Next media"
                    >
                        ›
                    </button>
                )}
            </div>

            <div className="vc-mg-preview-info">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ fontWeight: 600, color: "var(--text-normal)", fontSize: 14 }}>
                        {item.filename}
                    </span>
                    <span style={{ color: "var(--text-muted)", fontSize: 12 }}>
                        {currentIndex >= 0 ? `${currentIndex + 1} / ${items.length}` : ""}
                    </span>
                </div>

                <div className="vc-mg-preview-meta">
                    {item.authorName && <span>Author: <strong>{item.authorName}</strong></span>}
                    {item.timestamp && <span>Date: {formatDate(item.timestamp)}</span>}
                    {item.size !== undefined && <span>Size: {formatBytes(item.size)}</span>}
                    {item.width && item.height && <span>Dimensions: {item.width} × {item.height}</span>}
                    <span>Type: {item.type.toUpperCase()}</span>
                </div>
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 4 }}>
                <Button variant="secondary" onClick={onClosePreview}>
                    ← Back to Gallery
                </Button>

                <div style={{ display: "flex", gap: 8 }}>
                    <Button variant="secondary" onClick={handleOpenMessage}>
                        Open Message
                    </Button>
                    <Button variant="secondary" onClick={handleCopyUrl}>
                        Copy URL
                    </Button>
                    {item.downloadable ? (
                        <Button variant="primary" onClick={() => onDownloadSingle(item)}>
                            Download
                        </Button>
                    ) : (
                        <Button variant="secondary" disabled>
                            Download Unavailable
                        </Button>
                    )}
                </div>
            </div>
        </div>
    );
}
