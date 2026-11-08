/*
 * TrashCord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { findStoreLazy } from "@webpack";

import { type ApiHealth, HealthReport } from "./apiHealth";
import { T } from "./i18n";

/** Discord only knows who is speaking in the channel you are connected to. */
const SpeakingStore = findStoreLazy("SpeakingStore");

function store(): any {
    try {
        return typeof (SpeakingStore as any)?.isSpeaking === "function" ? SpeakingStore : null;
    } catch {
        return null;
    }
}

export function speakingProblems(): ApiHealth {
    return new HealthReport().nice(() => store() != null, T.apiSpeaking);
}

export function isSpeaking(userId: string): boolean {
    try {
        return store()?.isSpeaking(userId) === true;
    } catch {
        return false;
    }
}

/** Calls back whenever anyone in your channel starts or stops speaking, and returns how to stop listening. */
export function watchSpeaking(onChange: () => void): () => void {
    const speaking = store();
    if (typeof speaking?.addChangeListener !== "function") return () => { };

    speaking.addChangeListener(onChange);
    return () => speaking.removeChangeListener?.(onChange);
}
