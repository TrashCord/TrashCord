/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { useState } from "@webpack/common";
import type { KeyboardEvent, MouseEvent } from "react";

import { MediaItem } from "../types";

interface MediaGridItemProps {
    item: MediaItem;
    isSelected: boolean;
    onToggleSelect: (id: string) => void;
    onOpenPreview: (item: MediaItem) => void;
}

function MediaGridItemComponent({
    item,
    isSelected,
    onToggleSelect,
    onOpenPreview
}: MediaGridItemProps) {
    const [hasError, setHasError] = useState(false);

    const handleCheckboxClick = (e: MouseEvent) => {
        e.stopPropagation();
        onToggleSelect(item.id);
    };

    const handleKeyDown = (e: KeyboardEvent) => {
        if (e.key === " " || e.key === "Enter") {
            e.preventDefault();
            onOpenPreview(item);
        }
    };

    return (
        <div
            className={`vc-mg-grid-item ${isSelected ? "selected" : ""}`}
            onClick={() => onOpenPreview(item)}
            onKeyDown={handleKeyDown}
            tabIndex={0}
            role="button"
            aria-label={`${item.type}: ${item.filename}`}
        >
            <div className="vc-mg-checkbox-wrap" onClick={handleCheckboxClick}>
                <input
                    type="checkbox"
                    className="vc-mg-checkbox"
                    checked={isSelected}
                    onChange={() => {}}
                    tabIndex={-1}
                    aria-label={`Select ${item.filename}`}
                />
            </div>

            {item.type === "video" && (
                <div className="vc-mg-type-badge">▶ Video</div>
            )}
            {item.type === "gif" && (
                <div className="vc-mg-type-badge">GIF</div>
            )}

            {hasError ? (
                <div className="vc-mg-grid-fallback">
                    <span>{item.type.toUpperCase()}</span>
                    <span style={{ fontSize: 10, wordBreak: "break-all" }}>{item.filename}</span>
                </div>
            ) : item.type === "video" && !item.thumbnailUrl ? (
                <div className="vc-mg-grid-fallback">
                    <span style={{ fontSize: 24 }}>▶</span>
                    <span style={{ fontSize: 10, wordBreak: "break-all" }}>{item.filename}</span>
                </div>
            ) : (
                <img
                    className="vc-mg-grid-thumb"
                    src={item.thumbnailUrl || item.url}
                    alt={item.filename}
                    loading="lazy"
                    onError={() => setHasError(true)}
                />
            )}
        </div>
    );
}

export const MediaGridItem = MediaGridItemComponent;