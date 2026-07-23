/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { MAX_HISTORY } from "./constants";
import { settings } from "./settings";
import { FakeActionRecord, FakeActionType, FakeVoiceState } from "./types";

/**
 * Thin store wrapping the auto-persisted `settings.store.history`. Centralising
 * reads/writes here keeps persistence concerns out of the UI and guarantees the
 * newest-first ordering + size cap are always applied.
 *
 * Nothing in this module ever touches the network — the "history" is just a
 * local array saved alongside the plugin's other settings.
 */

/** Generate a reasonably-unique id for a record without extra dependencies. */
function makeId() {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Return the full history, newest first. */
export function getHistory(): FakeActionRecord[] {
    return settings.store.history;
}

/** Append a new fake action and return the created record. */
export function addAction(data: {
    type: FakeActionType;
    targetId: string;
    targetName: string;
    reason: string;
    duration?: number;
    guildId?: string;
}): FakeActionRecord {
    const record: FakeActionRecord = {
        id: makeId(),
        timestamp: Date.now(),
        ...data
    };

    // Newest first, then trim to the cap so the settings blob stays small.
    const next = [record, ...settings.store.history].slice(0, MAX_HISTORY);
    settings.store.history = next;

    return record;
}

/** Delete a single record by id. */
export function removeAction(id: string) {
    settings.store.history = settings.store.history.filter(r => r.id !== id);
}

/** Wipe the entire fake history. */
export function clearHistory() {
    settings.store.history = [];
}

/** Serialise the whole history to a pretty-printed JSON string. */
export function exportHistoryJson(): string {
    return JSON.stringify(settings.store.history, null, 4);
}

/* ------------------------------------------------------------------ */
/*  Fake voice state (Mute / Deafen checkboxes)                        */
/* ------------------------------------------------------------------ */

/** Read the local fake voice state for a user (empty object if none). */
export function getVoiceState(userId: string): FakeVoiceState {
    return settings.store.voiceStates[userId] ?? {};
}

/**
 * Toggle/set a fake voice flag for a user. Writes a fresh object so the settings
 * store notices the change and re-renders subscribed components.
 */
export function setVoiceFlag(userId: string, key: keyof FakeVoiceState, value: boolean) {
    const current = settings.store.voiceStates[userId] ?? {};
    settings.store.voiceStates = {
        ...settings.store.voiceStates,
        [userId]: { ...current, [key]: value }
    };
}
