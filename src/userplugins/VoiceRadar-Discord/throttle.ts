/*
 * TrashCord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export interface Throttled {
    (): void;
    cancel(): void;
}

/** Runs at once, then replays the last call at the end of the delay. */
export function throttle(callback: () => void, delay: number): Throttled {
    let lastRun = 0;
    let timeout: ReturnType<typeof setTimeout> | null = null;

    const run = () => {
        lastRun = Date.now();
        timeout = null;
        callback();
    };

    const throttled = (() => {
        const elapsed = Date.now() - lastRun;

        if (elapsed >= delay) {
            run();
            return;
        }

        timeout ??= setTimeout(run, delay - elapsed);
    }) as Throttled;

    throttled.cancel = () => {
        if (!timeout) return;
        clearTimeout(timeout);
        timeout = null;
    };

    return throttled;
}
