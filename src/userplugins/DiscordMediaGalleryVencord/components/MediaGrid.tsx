/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Button } from "@components/Button";

import { MediaItem } from "../types";
import { EmptyState } from "./EmptyState";
import { MediaGridItem } from "./MediaGridItem";

interface MediaGridProps {
    items: MediaItem[];
    selectedIds: Set<string>;
    onToggleSelect: (id: string) => void;
    onOpenPreview: (item: MediaItem) => void;
    onLoadMore: () => void;
    isLoadingMore: boolean;
    hasMore: boolean;
}

export function MediaGrid({
    items,
    selectedIds,
    onToggleSelect,
    onOpenPreview,
    onLoadMore,
    isLoadingMore,
    hasMore
}: MediaGridProps) {
    if (items.length === 0) {
        return <EmptyState />;
    }

    return (
        <div className="vc-mg-content">
            <div className="vc-mg-grid">
                {items.map(item => (
                    <MediaGridItem
                        key={item.id}
                        item={item}
                        isSelected={selectedIds.has(item.id)}
                        onToggleSelect={onToggleSelect}
                        onOpenPreview={onOpenPreview}
                    />
                ))}
            </div>

            {hasMore && (
                <div className="vc-mg-load-more">
                    <Button
                        size="medium"
                        variant="secondary"
                        onClick={onLoadMore}
                        disabled={isLoadingMore}
                    >
                        {isLoadingMore ? "Scanning older messages..." : "Load Older Media (50 messages)"}
                    </Button>
                </div>
            )}
        </div>
    );
}
