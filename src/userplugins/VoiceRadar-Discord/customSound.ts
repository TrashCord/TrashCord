/*
 * TrashCord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { DataStore } from "@api/index";

const DATASTORE_KEY = "VoiceRadar-Discord_JoinSound";
export const MAX_CUSTOM_SOUND_BYTES = 2 * 1024 * 1024;
/** A whole song chosen by mistake stops here instead of playing over a game. */
export const MAX_CUSTOM_SOUND_MS = 5000;

const TYPES_BY_EXTENSION: Record<string, string> = {
    mp3: "audio/mpeg",
    ogg: "audio/ogg",
    opus: "audio/ogg",
    wav: "audio/wav",
    m4a: "audio/mp4",
    aac: "audio/aac",
    flac: "audio/flac",
    webm: "audio/webm"
};

interface StoredSound {
    name: string;
    type: string;
    data: ArrayBuffer;
}

let current: { name: string; url: string | null; } | null = null;
const listeners = new Set<() => void>();

function objectUrl(sound: StoredSound): string | null {
    try {
        return typeof URL.createObjectURL === "function" ? URL.createObjectURL(new Blob([sound.data], { type: sound.type })) : null;
    } catch {
        return null;
    }
}

function setCurrent(sound: StoredSound | null) {
    if (current?.url) URL.revokeObjectURL?.(current.url);
    current = sound ? { name: sound.name, url: objectUrl(sound) } : null;
    listeners.forEach(listener => listener());
}

function isStoredSound(value: any): value is StoredSound {
    return value != null && typeof value.name === "string" && typeof value.type === "string" && value.data instanceof ArrayBuffer;
}

/** Windows often leaves the type empty for ogg and opus, so the extension decides then. */
export function audioType(file: { name: string; type: string; }): string | null {
    if (file.type.startsWith("audio/")) return file.type;

    const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
    return TYPES_BY_EXTENSION[extension] ?? null;
}

export async function loadCustomSound(): Promise<void> {
    try {
        const stored = await DataStore.get(DATASTORE_KEY);
        setCurrent(isStoredSound(stored) ? stored : null);
    } catch (error) {
        console.warn("[VoiceRadar-Discord] could not read the custom join sound:", error);
    }
}

export function customSoundName(): string | null {
    return current?.name ?? null;
}

export type SaveProblem = "too-big" | "not-audio" | "failed";

export async function saveCustomSound(file: File): Promise<SaveProblem | null> {
    if (file.size > MAX_CUSTOM_SOUND_BYTES) return "too-big";

    const type = audioType(file);
    if (!type) return "not-audio";

    try {
        const sound: StoredSound = { name: file.name, type, data: await file.arrayBuffer() };
        await DataStore.set(DATASTORE_KEY, sound);
        setCurrent(sound);
        return null;
    } catch (error) {
        console.warn("[VoiceRadar-Discord] could not save the custom join sound:", error);
        return "failed";
    }
}

export async function clearCustomSound(): Promise<void> {
    try {
        await DataStore.del(DATASTORE_KEY);
    } catch (error) {
        console.warn("[VoiceRadar-Discord] could not remove the custom join sound:", error);
    }
    setCurrent(null);
}

/** Says false when there is no file, so the caller can play the chime instead. */
export function playCustomSound(volume: number): boolean {
    if (!current?.url || typeof Audio === "undefined") return false;

    try {
        const audio = new Audio(current.url);
        audio.volume = Math.min(1, Math.max(0, volume));
        audio.play().catch(error => console.warn("[VoiceRadar-Discord] the custom join sound did not play:", error));
        setTimeout(() => audio.pause(), MAX_CUSTOM_SOUND_MS);
        return true;
    } catch (error) {
        console.warn("[VoiceRadar-Discord] the custom join sound failed:", error);
        return false;
    }
}

export function subscribeToCustomSound(listener: () => void): () => void {
    listeners.add(listener);
    return () => void listeners.delete(listener);
}

export function forgetCustomSound() {
    setCurrent(null);
}
