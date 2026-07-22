/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * The kind of (purely cosmetic) moderation action the user triggered.
 * These are NEVER sent to Discord — they only describe local, fake events.
 */
export type FakeActionType = "ban" | "kick" | "timeout" | "mute" | "deafen" | "warn";

/**
 * A single fake-moderation event as persisted in the local history.
 * Everything here lives client-side only; no field is ever transmitted.
 */
export interface FakeActionRecord {
    /** Unique id for this record (used as React key + for deletion). */
    id: string;
    /** Which fake action was performed. */
    type: FakeActionType;
    /** The targeted user's snowflake id. */
    targetId: string;
    /** The targeted user's display name at the time of the action. */
    targetName: string;
    /** The reason the user typed into the modal (may be empty). */
    reason: string;
    /** Duration in seconds. Only present for timeboxed actions (timeout/mute). */
    duration?: number;
    /** Guild the action was "performed" in, if any (DMs have none). */
    guildId?: string;
    /** Epoch milliseconds the action was logged at. */
    timestamp: number;
}

/**
 * The local, fake voice state held for a user. Mirrors the on/off nature of
 * Discord's native server Mute/Deafen checkboxes — but is purely cosmetic.
 */
export interface FakeVoiceState {
    muted?: boolean;
    deafened?: boolean;
}

/**
 * Static, per-action-type metadata. Drives the context menu, the modal and the
 * notifications. Kept in one table so adding a new fake action is a one-liner.
 */
export interface FakeActionMeta {
    type: FakeActionType;
    /**
     * How the action is presented:
     * - `moderation`: a red ("danger") item that opens the reason/duration modal.
     * - `voice`: a checkbox that toggles a local mute/deafen state instantly.
     */
    kind: "moderation" | "voice";
    /** Human label shown in menus/modals, e.g. "Fake Ban". */
    label: string;
    /** Past-tense verb used in toasts/logs, e.g. "banned". */
    verb: string;
    /** Word shown in the context menu before the username, e.g. "Ban". */
    menuVerb: string;
    /** Whether this action needs a duration field in the modal. */
    needsDuration: boolean;
    /** Key of the per-action enable toggle inside the settings store. */
    enableKey: `enable${Capitalize<FakeActionType>}`;
    /** Emoji used as a lightweight icon in menus/logs. */
    emoji: string;
}
