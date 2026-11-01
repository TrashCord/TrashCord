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

function click(ctx: AudioContext, out: AudioNode, at: number, length: number, peak: number) {
    const frames = Math.max(1, Math.floor(ctx.sampleRate * length));
    const buffer = ctx.createBuffer(1, frames, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < frames; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / frames);

    const source = ctx.createBufferSource();
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();

    filter.type = "highpass";
    filter.frequency.value = 1800;
    gain.gain.value = peak;
    source.buffer = buffer;

    source.connect(filter);
    filter.connect(gain);
    gain.connect(out);
    source.start(at);
}

export function playSound(kind: SoundKind, volume: number): Promise<void> {
    return new Promise<void>(resolve => {
        if (volume <= 0) {
            resolve();
            return;
        }

        try {
            const ctx = new AudioContext({ latencyHint: "interactive" });
            let done = false;

            const finish = () => {
                if (done) return;
                done = true;
                ctx.close().catch(() => { });
                resolve();
            };

            const master = ctx.createGain();
            master.gain.value = Math.min(1, volume);
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
                click(ctx, master, t, 0.03, 0.5);
                tone(ctx, master, "sine", 1567.98, t + 0.02, 0.09, 0.3);
                last = tone(ctx, master, "sine", 2093, t + 0.07, 0.13, 0.3);
            }

            last.onended = finish;
            ctx.resume().then(() => { if (ctx.state !== "running") finish(); }).catch(finish);
        } catch {
            resolve();
        }
    });
}
