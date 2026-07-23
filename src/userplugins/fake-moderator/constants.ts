/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { FakeActionMeta, FakeActionType } from "./types";

/**
 * The single source of truth for every fake action the plugin supports.
 * The context menu, the modal and the settings toggles are all derived from
 * this table, so introducing a new action only means adding an entry here
 * (plus a matching `enableX` setting).
 */
export const ACTIONS: Record<FakeActionType, FakeActionMeta> = {
    ban: {
        type: "ban",
        kind: "moderation",
        label: "Fake Ban",
        verb: "banned",
        menuVerb: "Ban",
        needsDuration: false,
        enableKey: "enableBan",
        emoji: "🔨"
    },
    kick: {
        type: "kick",
        kind: "moderation",
        label: "Fake Kick",
        verb: "kicked",
        menuVerb: "Kick",
        needsDuration: false,
        enableKey: "enableKick",
        emoji: "👢"
    },
    timeout: {
        type: "timeout",
        kind: "moderation",
        label: "Fake Timeout",
        verb: "timed out",
        menuVerb: "Timeout",
        needsDuration: true,
        enableKey: "enableTimeout",
        emoji: "⏳"
    },
    mute: {
        type: "mute",
        kind: "voice",
        label: "Fake Mute",
        verb: "muted",
        menuVerb: "Mute",
        needsDuration: false,
        enableKey: "enableMute",
        emoji: "🔇"
    },
    deafen: {
        type: "deafen",
        kind: "voice",
        label: "Fake Deafen",
        verb: "deafened",
        menuVerb: "Deafen",
        needsDuration: false,
        enableKey: "enableDeafen",
        emoji: "🙉"
    },
    warn: {
        type: "warn",
        kind: "moderation",
        label: "Fake Warn",
        verb: "warned",
        menuVerb: "Warn",
        needsDuration: false,
        enableKey: "enableWarn",
        emoji: "⚠️"
    }
};

/** Ordered list of actions, for stable rendering in settings. */
export const ACTION_LIST = Object.values(ACTIONS);

/**
 * Order the actions appear in the context menu, mirroring Discord's native
 * moderation block (Timeout → Kick → Ban), with the extra actions after.
 */
export const MENU_ORDER: FakeActionType[] = ["timeout", "kick", "ban", "warn"];

/** Order of the voice toggle (checkbox) actions, mirroring Discord's Mute/Deafen. */
export const VOICE_ORDER: FakeActionType[] = ["mute", "deafen"];

/** Default colour used for notifications/toasts (Discord blurple). */
export const DEFAULT_COLOR = "#5865f2";

/** Preset duration choices (in seconds) offered for timeboxed actions. */
export const DURATION_PRESETS: { label: string; seconds: number; }[] = [
    { label: "60 seconds", seconds: 60 },
    { label: "5 minutes", seconds: 5 * 60 },
    { label: "10 minutes", seconds: 10 * 60 },
    { label: "1 hour", seconds: 60 * 60 },
    { label: "1 day", seconds: 24 * 60 * 60 },
    { label: "1 week", seconds: 7 * 24 * 60 * 60 }
];

/** Cap on stored history entries to keep the settings file from growing forever. */
export const MAX_HISTORY = 500;
