/*
 * TrashCord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export type SoundKind = "recordStart" | "autoStart" | "recordSaved" | "clipSaved";

function tone(ctx: AudioContext, out: AudioNode, type: OscillatorType, freq: number, at: number, length: number, peak: number): OscillatorNode {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = type;
    osc.frequency.setValueAtTime(freq, at);
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(peak, at + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + length);

    osc.connect(gain);
    gain.connect(out);
    osc.start(at);
    osc.stop(at + length + 0.02);

    return osc;
}

function sweep(ctx: AudioContext, out: AudioNode, from: number, to: number, at: number, length: number, peak: number): OscillatorNode {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = "sine";
    osc.frequency.setValueAtTime(from, at);
    osc.frequency.exponentialRampToValueAtTime(to, at + length * 0.6);
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(peak, at + 0.014);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + length);

    osc.connect(gain);
    gain.connect(out);
    osc.start(at);
    osc.stop(at + length + 0.02);

    return osc;
}

function createContext(sinkId?: string): AudioContext {
    if (sinkId) {
        try {
            return new AudioContext({ latencyHint: "interactive", sinkId } as any);
        } catch { }
    }

    return new AudioContext({ latencyHint: "interactive" });
}

export function playSound(kind: SoundKind, volume: number, sinkId?: string): Promise<void> {
    return new Promise<void>(resolve => {
        if (volume <= 0) {
            resolve();
            return;
        }

        try {
            const ctx = createContext(sinkId);
            let done = false;

            const finish = () => {
                if (done) return;
                done = true;
                ctx.close().catch(() => { });
                resolve();
            };

            const master = ctx.createGain();
            master.gain.value = Math.min(1, volume) * 0.7;
            master.connect(ctx.destination);

            const t = ctx.currentTime + 0.02;
            let last: OscillatorNode;

            if (kind === "recordStart") {
                tone(ctx, master, "sine", 523.25, t, 0.11, 0.35);
                last = tone(ctx, master, "sine", 783.99, t + 0.1, 0.17, 0.35);
            } else if (kind === "autoStart") {
                tone(ctx, master, "triangle", 329.63, t, 0.08, 0.4);
                tone(ctx, master, "triangle", 329.63, t + 0.12, 0.08, 0.4);
                last = tone(ctx, master, "triangle", 440, t + 0.24, 0.15, 0.4);
            } else if (kind === "recordSaved") {
                tone(ctx, master, "triangle", 783.99, t, 0.1, 0.35);
                tone(ctx, master, "triangle", 659.25, t + 0.09, 0.1, 0.35);
                last = tone(ctx, master, "triangle", 523.25, t + 0.18, 0.24, 0.35);
            } else {
                last = sweep(ctx, master, 300, 560, t, 0.16, 0.3);
            }

            last.onended = finish;
            ctx.resume().then(() => { if (ctx.state !== "running") finish(); }).catch(finish);
        } catch {
            resolve();
        }
    });
}
