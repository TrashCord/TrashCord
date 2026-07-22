/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

interface CacheEntry {
    value: unknown;
    expires: number;
}

const cache = new Map<string, CacheEntry>();

interface RequestOptions<T> {
    key?: string;
    run: () => Promise<T>;
    ttlMs?: number;
    cacheable?: (value: T) => boolean;
}

export const RequestCoordinator = {
    request: async <T>(options: RequestOptions<T>): Promise<T> => {
        if (options.key && options.ttlMs) {
            const cached = cache.get(options.key);
            if (cached && cached.expires > Date.now()) {
                return cached.value as T;
            }
        }

        const result = await options.run();

        if (options.key && options.ttlMs) {
            const isCacheable = options.cacheable ? options.cacheable(result) : result != null;
            if (isCacheable) {
                cache.set(options.key, {
                    value: result,
                    expires: Date.now() + options.ttlMs,
                });
            }
        }

        return result;
    },
};