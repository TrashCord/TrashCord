/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/*
 * Auto-render allowlists. IDs (Discord user / guild snowflakes) stored as a
 * comma/space-separated string in settings; pure helpers to read and toggle
 * membership. Immutable throughout. Verified by the html-viewer-core unit suite.
 */

export function parseIds(csv: string | undefined | null): string[] {
    return (csv ?? "").split(/[\s,]+/).map(s => s.trim()).filter(Boolean);
}

export function hasId(csv: string | undefined | null, id: string | undefined | null): boolean {
    return !!id && parseIds(csv).includes(id);
}

/** Return a new CSV with `id` added if absent, removed if present. */
export function toggleId(csv: string | undefined | null, id: string): string {
    if (!id) return csv ?? "";
    const ids = parseIds(csv);
    const next = ids.includes(id) ? ids.filter(x => x !== id) : [...ids, id];
    return next.join(",");
}
