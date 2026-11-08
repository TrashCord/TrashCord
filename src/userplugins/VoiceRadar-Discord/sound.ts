/*
 * TrashCord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { isFn } from "./apiHealth";
import { playCustomSound } from "./customSound";
import { ALERT_OFF, CUSTOM_SOUND, getJoinAlert, getJoinSoundVolume } from "./settings";

const CHIME_TONES = [784, 1047];
const CHIME_TONE_MS = 90;
const CHIME_GAIN = 0.18;

const SOUND_GAP_MS = 800;
let lastPlayedAt = 0;

let chimeContext: AudioContext | null = null;

function chimeAudioContext(): AudioContext | null {
    if (chimeContext) return chimeContext;

    const Context = (globalThis as any).AudioContext ?? (globalThis as any).webkitAudioContext;
    if (!isFn(Context)) return null;

    try {
        chimeContext = new Context();
        return chimeContext;
    } catch (error) {
        console.warn("[VoiceRadar-Discord] no audio context for the join chime:", error);
        return null;
    }
}

function playChime(volume: number): void {
    const context = chimeAudioContext();
    if (!context) return;

    try {
        void context.resume?.();

        CHIME_TONES.forEach((frequency, index) => {
            const startAt = context.currentTime + index * (CHIME_TONE_MS / 1000);
            const endAt = startAt + CHIME_TONE_MS / 1000;

            const oscillator = context.createOscillator();
            const gain = context.createGain();

            oscillator.type = "sine";
            oscillator.frequency.value = frequency;

            gain.gain.setValueAtTime(0, startAt);
            gain.gain.linearRampToValueAtTime(CHIME_GAIN * volume, startAt + 0.01);
            gain.gain.exponentialRampToValueAtTime(0.0001, endAt);

            oscillator.connect(gain);
            gain.connect(context.destination);

            oscillator.start(startAt);
            oscillator.stop(endAt + 0.02);
        });
    } catch (error) {
        console.warn("[VoiceRadar-Discord] the join chime failed:", error);
    }
}

export function playJoinSound(): void {
    const choice = getJoinAlert();
    if (choice === ALERT_OFF) return;

    const volume = getJoinSoundVolume();
    if (volume <= 0) return;

    const now = Date.now();
    if (now - lastPlayedAt < SOUND_GAP_MS) return;
    lastPlayedAt = now;

    if (choice === CUSTOM_SOUND && playCustomSound(volume)) return;
    playChime(volume);
}

export function forgetSoundState(): void {
    lastPlayedAt = 0;

    try {
        void chimeContext?.close?.();
    } catch (error) {
        console.warn("[VoiceRadar-Discord] could not close the audio context:", error);
    }

    chimeContext = null;
}
