/*
 * TrashCord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export class TtlCache<T> {
    private readonly entries = new Map<string, { value: T; expiresAt: number; }>();

    constructor(private readonly defaultTtlMs: number, private readonly maxEntries: number) { }

    get(key: string): T | undefined {
        const entry = this.entries.get(key);
        if (!entry) return undefined;

        if (Date.now() >= entry.expiresAt) {
            this.entries.delete(key);
            return undefined;
        }

        return entry.value;
    }

    set(key: string, value: T, ttlMs = this.defaultTtlMs): T {
        // Delete first, so setting a key again moves it to the end.
        this.entries.delete(key);
        this.entries.set(key, { value, expiresAt: Date.now() + ttlMs });

        if (this.entries.size > this.maxEntries) this.prune();

        return value;
    }

    clear() {
        this.entries.clear();
    }

    private prune() {
        const now = Date.now();

        for (const [key, entry] of this.entries) {
            if (now >= entry.expiresAt) this.entries.delete(key);
        }

        while (this.entries.size > this.maxEntries) {
            const oldest = this.entries.keys().next().value;
            if (oldest === undefined) break;
            this.entries.delete(oldest);
        }
    }
}
