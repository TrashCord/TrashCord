/*
 * TrashCord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Button } from "@components/Button";

import { FilterType, SortOrder } from "../types";

interface GalleryToolbarProps {
    filter: FilterType;
    onFilterChange: (f: FilterType) => void;
    counts: { all: number; images: number; videos: number; gifs: number; };
    searchQuery: string;
    onSearchChange: (q: string) => void;
    sortOrder: SortOrder;
    onSortChange: (s: SortOrder) => void;
    onSelectAll: () => void;
    onClearSelection: () => void;
    selectedCount: number;
    filteredCount: number;
    dateFrom: string;
    dateTo: string;
    onDateFromChange: (value: string) => void;
    onDateToChange: (value: string) => void;
}

export function GalleryToolbar({
    filter,
    onFilterChange,
    counts,
    searchQuery,
    onSearchChange,
    sortOrder,
    onSortChange,
    onSelectAll,
    onClearSelection,
    selectedCount,
    filteredCount,
    dateFrom,
    dateTo,
    onDateFromChange,
    onDateToChange
}: GalleryToolbarProps) {
    return (
        <div className="vc-mg-header">
            <div className="vc-mg-header-top">
                <div className="vc-mg-filter-tabs">
                    <button
                        type="button"
                        className={"vc-mg-tab-btn " + (filter === "all" ? "active" : "")}
                        onClick={() => onFilterChange("all")}
                    >
                        All ({counts.all})
                    </button>
                    <button
                        type="button"
                        className={"vc-mg-tab-btn " + (filter === "images" ? "active" : "")}
                        onClick={() => onFilterChange("images")}
                    >
                        Images ({counts.images})
                    </button>
                    <button
                        type="button"
                        className={"vc-mg-tab-btn " + (filter === "videos" ? "active" : "")}
                        onClick={() => onFilterChange("videos")}
                    >
                        Videos ({counts.videos})
                    </button>
                    <button
                        type="button"
                        className={"vc-mg-tab-btn " + (filter === "gifs" ? "active" : "")}
                        onClick={() => onFilterChange("gifs")}
                    >
                        GIFs ({counts.gifs})
                    </button>
                </div>

                <input
                    type="text"
                    className="vc-mg-search-input"
                    placeholder="Search media by filename..."
                    value={searchQuery}
                    onChange={e => onSearchChange(e.target.value)}
                />
            </div>

            <div className="vc-mg-header-bottom">
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <Button
                        size="small"
                        variant="secondary"
                        onClick={onSelectAll}
                        disabled={filteredCount === 0}
                    >
                        Select All ({filteredCount})
                    </Button>
                    {selectedCount > 0 && (
                        <Button
                            size="small"
                            variant="secondary"
                            onClick={onClearSelection}
                        >
                            Clear Selection
                        </Button>
                    )}
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 12, color: "var(--text-muted)" }}>Sort:</span>
                    <select
                        className="vc-mg-channel-select"
                        style={{ padding: "4px 8px", fontSize: 12 }}
                        value={sortOrder}
                        onChange={e => onSortChange(e.target.value as SortOrder)}
                    >
                        <option value="newest">Newest First</option>
                        <option value="oldest">Oldest First</option>
                        <option value="name_asc">Name A-Z</option>
                        <option value="name_desc">Name Z-A</option>
                    </select>
                </div>
            </div>

            <div className="vc-mg-date-range" aria-label="Media date range filter">
                <span className="vc-mg-date-label">Date range</span>
                <input
                    type="datetime-local"
                    className="vc-mg-date-input"
                    value={dateFrom}
                    onChange={e => onDateFromChange(e.target.value)}
                    aria-label="Scan media from date"
                />
                <span className="vc-mg-date-separator">to</span>
                <input
                    type="datetime-local"
                    className="vc-mg-date-input"
                    value={dateTo}
                    onChange={e => onDateToChange(e.target.value)}
                    aria-label="Scan media until date"
                />
                {(dateFrom || dateTo) && (
                    <button type="button" className="vc-mg-date-clear" onClick={() => {
                        onDateFromChange("");
                        onDateToChange("");
                    }}>
                        Clear
                    </button>
                )}
            </div>
        </div>
    );
}
