/*
 * TrashCord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export type Kind = "replay" | "record" | "auto";

export interface Profile {
    video: boolean;
    mic: boolean;
    others: boolean;
    target: string;
    audioFormat: string;
    videoFormat: string;
    khz: number;
    audioKbps: number;
    width: number;
    height: number;
    fps: number;
    videoKbps: number;
    folder: string;
}

export interface Levels {
    micVolume: number;
    othersVolume: number;
    follow: boolean;
    gateDb: number;
}

export interface Common extends Levels {
    micDevice: string;
    playback: string;
    echo: boolean;
    noise: boolean;
    ask: boolean;
}

export interface SaveResult {
    status: "saved" | "canceled" | "error";
    path?: string;
}

const listeners = new Set<() => void>();

export const getNative = (): any => (window as any).VencordNative?.pluginHelpers?.CallCapture;

export function subscribeState(fn: () => void): () => void {
    listeners.add(fn);
    return () => {
        listeners.delete(fn);
    };
}

export function emitState() {
    listeners.forEach(fn => fn());
}
