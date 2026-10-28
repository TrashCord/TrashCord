/*
 * TrashCord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Button } from "@components/Button";
import { HeadingSecondary } from "@components/Heading";
import { Paragraph } from "@components/Paragraph";

import { formatBytes } from "../mediaUtils";
import { MediaItem } from "../types";

interface DownloadModalProps {
    items: MediaItem[];
    channelName: string;
    onConfirm: () => void;
    onCancel: () => void;
}

export function DownloadModal({
    items,
    channelName,
    onConfirm,
    onCancel
}: DownloadModalProps) {
    const totalCount = items.length;
    const imagesCount = items.filter(i => i.type === "image").length;
    const videosCount = items.filter(i => i.type === "video").length;
    const gifsCount = items.filter(i => i.type === "gif").length;

    let totalSizeBytes = 0;
    let hasUnknownSize = false;

    for (const item of items) {
        if (item.size !== undefined && item.size > 0) {
            totalSizeBytes += item.size;
        } else {
            hasUnknownSize = true;
        }
    }

    const sizeString = hasUnknownSize && totalSizeBytes === 0
        ? "Unknown"
        : hasUnknownSize
            ? `At least ${formatBytes(totalSizeBytes)}`
            : formatBytes(totalSizeBytes);

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 14, padding: "12px 0" }}>
            <HeadingSecondary>Confirm Bulk Download</HeadingSecondary>
            <Paragraph>
                You are about to download <strong>{totalCount}</strong> selected media items from <strong>{channelName}</strong>.
            </Paragraph>

            <div style={{ background: "var(--background-secondary)", padding: 12, borderRadius: 8, display: "flex", flexDirection: "column", gap: 6, fontSize: 13 }}>
                <div>• Images: <strong>{imagesCount}</strong></div>
                <div>• Videos: <strong>{videosCount}</strong></div>
                <div>• GIFs: <strong>{gifsCount}</strong></div>
                <div style={{ marginTop: 4, paddingTop: 6, borderTop: "1px solid var(--background-modifier-accent)" }}>
                    Total Estimated Size: <strong>{sizeString}</strong>
                </div>
            </div>

            <div className="vc-mg-download-destination">
                <strong>Download destination</strong>
                <span>Files will be saved using Discord/browser default download settings.</span>
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 8 }}>
                <Button variant="secondary" onClick={onCancel}>
                    Cancel
                </Button>
                <Button variant="primary" onClick={onConfirm}>
                    Download {totalCount} Files
                </Button>
            </div>
        </div>
    );
}
