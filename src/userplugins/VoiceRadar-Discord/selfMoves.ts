/*
 * TrashCord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { FluxDispatcher } from "@webpack/common";

/** Tells your own voice moves apart from moves made for you. */

const CHOICE_WINDOW_MS = 10_000;

let wantedChannelId: string | null = null;
let wantedAt = 0;

let everHeardAChoice = false;

function forgetMyChoice() {
    wantedChannelId = null;
    wantedAt = 0;
}

function handleChannelSelect(event: { channelId?: string | null; }) {
    wantedChannelId = event?.channelId ?? null;
    wantedAt = Date.now();
    everHeardAChoice = true;
}

export function startWatchingMyChoices() {
    stopWatchingMyChoices();
    FluxDispatcher.subscribe("VOICE_CHANNEL_SELECT", handleChannelSelect);
}

export function stopWatchingMyChoices() {
    FluxDispatcher.unsubscribe("VOICE_CHANNEL_SELECT", handleChannelSelect);
    forgetMyChoice();
    everHeardAChoice = false;
}

export function canTellMyMovesApart(): boolean {
    return everHeardAChoice;
}

export function wasMyOwnDoing(channelId: string | null): boolean {
    if (Date.now() - wantedAt > CHOICE_WINDOW_MS) return false;
    if (wantedChannelId !== channelId) return false;

    forgetMyChoice();
    return true;
}

export function isMyMoveInFlight(): boolean {
    return wantedChannelId != null && Date.now() - wantedAt <= CHOICE_WINDOW_MS;
}
