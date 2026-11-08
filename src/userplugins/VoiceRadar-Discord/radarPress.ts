/*
 * TrashCord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export interface RadarState {
    /** The option to open straight in the separate window. */
    direct: boolean;
    /** The option to hide that window instead of closing it. */
    hide: boolean;
    inDiscord: boolean;
    ownWindow: boolean;
    /** Up on screen, so not minimised or hidden. */
    ownWindowShown: boolean;
}

export type RadarPress = "open-in-discord" | "close-in-discord" | "show-own-window" | "close-own-window" | "hide-own-window";

/** What the hotkey or the panel button should do right now. */
export function radarPress({ direct, hide, inDiscord, ownWindow, ownWindowShown }: RadarState): RadarPress {
    if (direct) {
        if (inDiscord) return "close-in-discord";
        if (!ownWindowShown) return "show-own-window";
        return hide ? "hide-own-window" : "close-own-window";
    }

    if (ownWindow) return "show-own-window";
    return inDiscord ? "close-in-discord" : "open-in-discord";
}
