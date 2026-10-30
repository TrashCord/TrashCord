/*
 * TrashCord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { findStoreLazy } from "@webpack";
import { showToast } from "@webpack/common";

import { fixBufferDuration } from "./mediaFixer";
import { startRewind, stopRewind } from "./rewind";
import { Common, emitState, getNative, Levels, Profile, SaveResult } from "./shared";

interface Input {
    ctx: AudioContext;
    dest: MediaStreamAudioDestinationNode;
    micGain: GainNode | null;
    sysGain: GainNode | null;
    gate: AudioWorkletNode | null;
    video: MediaStream | null;
    streams: Array<MediaStream | null>;
    label: string;
}

interface Recording {
    recorder: MediaRecorder;
    input: Input;
    profile: Profile;
    ask: boolean;
    sub: string;
    filename: string;
    streamMode: boolean;
    startMs: number;
}

const MediaEngineStore = findStoreLazy("MediaEngineStore");

const MIN_SAVE_MS = 800;
const VOICE_DIMS = { width: 320, height: 180, fps: 1 };
const SUBS = { record: "Recordings", auto: "Auto" };

const GATE_CODE = `class Gate extends AudioWorkletProcessor {
    static get parameterDescriptors() {
        return [{ name: "threshold", defaultValue: 0.003, minValue: 0, maxValue: 1 }];
    }

    constructor() {
        super();
        this.env = 0;
        this.gain = 0;
        this.decay = Math.exp(-1 / (0.15 * sampleRate));
        this.open = 1 - Math.exp(-1 / (0.004 * sampleRate));
        this.close = 1 - Math.exp(-1 / (0.06 * sampleRate));
    }

    process(inputs, outputs, parameters) {
        const input = inputs[0];
        const output = outputs[0];
        if (!input || !input.length) return true;

        const threshold = parameters.threshold[0];
        const length = input[0].length;

        for (let i = 0; i < length; i++) {
            let peak = 0;
            for (let c = 0; c < input.length; c++) {
                const v = Math.abs(input[c][i]);
                if (v > peak) peak = v;
            }

            this.env = peak > this.env ? peak : this.env * this.decay;
            const target = this.env > threshold ? 1 : 0;
            this.gain += (target - this.gain) * (target > this.gain ? this.open : this.close);

            for (let c = 0; c < input.length; c++) output[c][i] = input[c][i] * this.gain;
        }

        return true;
    }
}

registerProcessor("callcapture-gate", Gate);`;

const inputs = new Set<Input>();

let gateUrl = "";
let replay: Input | null = null;
let rec: Recording | null = null;
let epoch = 0;
let startingReplay = false;
let startingRec = false;
let stopping = false;
let testing = false;
let chunks: Blob[] = [];
let pendingWrites: Promise<void> = Promise.resolve();
let savedHandler: ((result: SaveResult) => void) | null = null;
let muted = false;
let warnedOutput = false;
let watching = false;
let levels: Levels = { micVolume: 100, othersVolume: 100, follow: true, gateDb: -50 };

export function onSaved(fn: ((result: SaveResult) => void) | null) {
    savedHandler = fn;
}

export function getMicLabel(): string {
    return rec?.input.label ?? replay?.input.label ?? "";
}

export function getRecordingStart(): number {
    return rec?.startMs ?? 0;
}

export function isCurrentlyRecording(): boolean {
    return rec !== null;
}

function readMuted(): boolean {
    const store = MediaEngineStore as any;
    try {
        return !!(store?.isSelfMute?.() || store?.isSelfDeaf?.() || store?.isMute?.());
    } catch {
        return false;
    }
}

function applyLevels() {
    const mic = levels.follow && muted ? 0 : levels.micVolume / 100;
    const others = levels.othersVolume / 100;
    const threshold = levels.gateDb < 0 ? Math.pow(10, levels.gateDb / 20) : 0;

    inputs.forEach(input => {
        const now = input.ctx.currentTime;
        input.micGain?.gain.setTargetAtTime(mic, now, 0.015);
        input.sysGain?.gain.setTargetAtTime(others, now, 0.015);
        input.gate?.parameters.get("threshold")?.setValueAtTime(threshold, now);
    });
}

function onMediaChange() {
    const next = readMuted();
    if (next === muted) return;
    muted = next;
    if (levels.follow) applyLevels();
}

function watch() {
    const want = inputs.size > 0;
    if (want === watching) return;
    watching = want;

    const store = MediaEngineStore as any;
    if (want) {
        muted = readMuted();
        store.addChangeListener(onMediaChange);
    } else {
        store.removeChangeListener(onMediaChange);
    }
}

export function setLevels(next: Levels) {
    levels = { micVolume: next.micVolume, othersVolume: next.othersVolume, follow: next.follow, gateDb: next.gateDb };
    applyLevels();
}

function stopTracks(stream: MediaStream | null | undefined) {
    stream?.getTracks().forEach(tr => tr.stop());
}

function closeInput(input: Input | null | undefined) {
    if (!input) return;
    inputs.delete(input);
    watch();
    input.streams.forEach(stopTracks);
    if (input.ctx.state !== "closed") input.ctx.close().catch(() => { });
}

function pickMime(list: string[], fallback: string): string {
    for (const m of list) {
        if (MediaRecorder.isTypeSupported(m)) return m;
    }
    return fallback;
}

function getRecordingConfig(p: Profile): { mimeType: string; ext: string; } {
    if (p.video) {
        if (p.videoFormat === "mkv") {
            return {
                mimeType: pickMime([
                    "video/x-matroska;codecs=avc1,opus",
                    "video/x-matroska;codecs=avc1,aac",
                    "video/x-matroska",
                    "video/webm;codecs=vp8,opus",
                    "video/webm"
                ], "video/webm"),
                ext: "mkv"
            };
        }

        if (p.videoFormat === "webm") {
            return {
                mimeType: pickMime([
                    "video/webm;codecs=vp8,opus",
                    "video/webm;codecs=h264,opus",
                    "video/webm;codecs=vp9,opus",
                    "video/webm"
                ], "video/webm"),
                ext: "webm"
            };
        }

        const mimeType = pickMime([
            "video/mp4;codecs=avc1,mp4a.40.2",
            "video/mp4;codecs=avc1,opus",
            "video/mp4;codecs=h264,aac",
            "video/mp4;codecs=avc1",
            "video/mp4;codecs=h264",
            "video/mp4",
            "video/webm;codecs=vp8,opus",
            "video/webm;codecs=vp9,opus",
            "video/webm"
        ], "video/mp4");
        return { mimeType, ext: mimeType.includes("mp4") ? "mp4" : "webm" };
    }

    if (p.audioFormat === "ogg") {
        const mimeType = pickMime([
            "audio/ogg;codecs=opus",
            "audio/ogg",
            "audio/webm;codecs=opus",
            "audio/webm"
        ], "audio/ogg");
        return { mimeType, ext: mimeType.includes("ogg") ? "ogg" : "webm" };
    }

    if (p.audioFormat === "webm") {
        return {
            mimeType: pickMime(["audio/webm;codecs=opus", "audio/webm"], "audio/webm"),
            ext: "webm"
        };
    }

    const mimeType = pickMime([
        "audio/mp4;codecs=mp4a.40.2",
        "audio/mp4;codecs=aac",
        "audio/mp4;codecs=opus",
        "audio/mp4",
        "video/mp4;codecs=mp4a.40.2",
        "video/mp4;codecs=avc1,opus",
        "video/mp4",
        "audio/webm;codecs=opus",
        "audio/webm"
    ], "audio/webm");
    return { mimeType, ext: mimeType.includes("mp4") ? "mp4" : "webm" };
}

async function resolveMicId(pref: string): Promise<string | null> {
    try {
        const list = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === "audioinput");

        if (pref && pref !== "auto") return list.some(d => d.deviceId === pref) ? pref : null;

        const store = MediaEngineStore as any;
        const name = String(store?.getInputDevices?.()?.[store?.getInputDeviceId?.()]?.name ?? "").toLowerCase();
        if (!name) return null;

        const clean = (s: string) => s.toLowerCase().replace(/^(default|communications) - /, "");
        const match = list.find(d => d.deviceId !== "default" && d.deviceId !== "communications" && clean(d.label).includes(name));
        return match?.deviceId ?? null;
    } catch {
        return null;
    }
}

export async function checkOutput(playback: string): Promise<string | null> {
    try {
        const outputs = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === "audiooutput");
        const system = outputs.find(d => d.deviceId === "default")?.label.replace(/^default - /i, "");
        if (!system) return null;

        const same = (a: string, b: string) => {
            const x = a.toLowerCase();
            const y = b.toLowerCase();
            return x.includes(y) || y.includes(x);
        };

        if (playback.startsWith("out:")) {
            const wanted = outputs.find(d => d.deviceId === playback.slice(4))?.label;
            if (wanted && !same(wanted, system)) {
                return `System audio captures "${system}", not "${wanted}". Set "${wanted}" as the Windows default output.`;
            }
            return null;
        }

        const store = MediaEngineStore as any;
        const id = store?.getOutputDeviceId?.();
        if (!id || id === "default") return null;

        const discord = String(store?.getOutputDevices?.()?.[id]?.name ?? "");
        if (!discord || same(discord, system)) return null;

        return `Discord plays on "${discord}" but System audio captures "${system}". Set "${discord}" as the Windows default output or the others will be silent.`;
    } catch {
        return null;
    }
}

function describeMic(stream: MediaStream, gateDb: number | null): string {
    const track = stream.getAudioTracks()[0];
    if (!track) return "";
    const st = track.getSettings();
    const gate = gateDb !== null ? `, gate ${gateDb} dB` : "";
    return `${track.label} (echo ${st.echoCancellation ? "on" : "off"}, noise ${st.noiseSuppression ? "on" : "off"}${gate})`;
}

async function captureMic(common: Common): Promise<MediaStream | null> {
    const id = await resolveMicId(common.micDevice);
    const processing = { echoCancellation: common.echo, noiseSuppression: common.noise, autoGainControl: false };
    const attempts: MediaTrackConstraints[] = id ? [{ ...processing, deviceId: { exact: id } }, processing] : [processing];
    let blocked = false;

    for (const audio of attempts) {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio });
            if (stream.getAudioTracks().length > 0) return stream;
            stopTracks(stream);
        } catch (err) {
            if (err instanceof DOMException && err.name === "NotAllowedError") blocked = true;
        }
    }

    if (blocked) {
        showToast({ text: "Microphone access is blocked, so your voice will not be recorded.", variant: "critical" });
    }
    return null;
}

async function captureInput(deviceId: string): Promise<MediaStream | null> {
    try {
        return await navigator.mediaDevices.getUserMedia({
            audio: { deviceId: { exact: deviceId }, echoCancellation: false, noiseSuppression: false, autoGainControl: false }
        });
    } catch {
        return null;
    }
}

async function pickSourceId(target: string): Promise<string | null> {
    const native = getNative();

    const windowId = async (): Promise<string | null> => (native?.getWindowSourceId ? await native.getWindowSourceId() : null);
    const screens = async (): Promise<Array<{ id: string; }>> => (native?.getDesktopSources ? await native.getDesktopSources() : []);

    if (target === "window") return (await windowId()) ?? (await screens())[0]?.id ?? null;

    const list = await screens();
    return list.find(s => s.id === target)?.id ?? list[0]?.id ?? (await windowId());
}

async function captureDesktop(target: string, dims: { width: number; height: number; fps: number; }): Promise<MediaStream | null> {
    try {
        const sourceId = await pickSourceId(target);
        if (!sourceId) return null;

        for (const strict of [true, false]) {
            try {
                return await navigator.mediaDevices.getUserMedia({
                    audio: { mandatory: { chromeMediaSource: "desktop", chromeMediaSourceId: sourceId } },
                    video: {
                        mandatory: {
                            chromeMediaSource: "desktop",
                            chromeMediaSourceId: sourceId,
                            maxWidth: dims.width,
                            maxHeight: dims.height,
                            maxFrameRate: dims.fps,
                            ...(strict ? { minFrameRate: dims.fps } : {})
                        }
                    }
                } as any);
            } catch (e) {
                if (e instanceof DOMException && e.name === "NotAllowedError") throw e;
            }
        }
    } catch (e) {
        if (e instanceof DOMException && e.name === "NotAllowedError") {
            showToast({ text: "System audio capture is blocked, so the other people in the call will not be recorded.", variant: "critical" });
        }
    }

    return null;
}

async function addGate(ctx: AudioContext): Promise<AudioWorkletNode | null> {
    try {
        if (!gateUrl) gateUrl = URL.createObjectURL(new Blob([GATE_CODE], { type: "text/javascript" }));
        await ctx.audioWorklet.addModule(gateUrl);
        return new AudioWorkletNode(ctx, "callcapture-gate");
    } catch {
        return null;
    }
}

async function openInput(common: Common, p: Profile, rate: number): Promise<Input | null> {
    const my = epoch;
    const streams: Array<MediaStream | null> = [];
    let ctx: AudioContext | null = null;

    const abort = (): null => {
        streams.forEach(stopTracks);
        if (ctx && ctx.state !== "closed") ctx.close().catch(() => { });
        return null;
    };

    try {
        const AudioCtxClass = window.AudioContext || (window as any).webkitAudioContext;
        const audioCtx: AudioContext = new AudioCtxClass({ latencyHint: "playback", sampleRate: rate });
        ctx = audioCtx;
        audioCtx.resume().catch(() => { });

        const dest = audioCtx.createMediaStreamDestination();

        const mic = p.mic ? await captureMic(common) : null;
        streams.push(mic);
        if (my !== epoch) return abort();

        const loopback = p.others && (common.playback === "system" || common.playback.startsWith("out:"));
        const desktop = loopback || p.video ? await captureDesktop(p.video ? p.target : "screen", p.video ? p : VOICE_DIMS) : null;
        streams.push(desktop);
        if (my !== epoch) return abort();

        if (loopback && !warnedOutput) {
            warnedOutput = true;
            void checkOutput(common.playback).then(msg => {
                if (msg && my === epoch) showToast({ text: msg, variant: "critical" });
            });
        }

        const device = p.others && !loopback ? await captureInput(common.playback) : null;
        streams.push(device);
        if (my !== epoch) return abort();

        desktop?.getVideoTracks().forEach(tr => {
            if (p.video) tr.contentHint = "motion";
            else tr.stop();
        });
        if (!loopback) desktop?.getAudioTracks().forEach(tr => tr.stop());

        const sysTracks = (loopback ? desktop : device)?.getAudioTracks() ?? [];
        const sys = sysTracks.length ? new MediaStream(sysTracks) : null;
        const videoTracks = p.video ? desktop?.getVideoTracks() ?? [] : [];
        const video = videoTracks.length ? new MediaStream(videoTracks) : null;

        let micGain: GainNode | null = null;
        let sysGain: GainNode | null = null;
        let gate: AudioWorkletNode | null = null;

        if (mic) {
            gate = common.gateDb < 0 ? await addGate(audioCtx) : null;
            if (my !== epoch) return abort();

            micGain = audioCtx.createGain();
            const source = audioCtx.createMediaStreamSource(mic);

            if (gate) {
                source.connect(gate);
                gate.connect(micGain);
            } else {
                source.connect(micGain);
            }

            micGain.connect(dest);
        }

        if (sys) {
            sysGain = audioCtx.createGain();
            audioCtx.createMediaStreamSource(sys).connect(sysGain);
            sysGain.connect(dest);
        }

        if (!mic && !sys) {
            const osc = audioCtx.createOscillator();
            const silent = audioCtx.createGain();
            silent.gain.value = 0;
            osc.connect(silent);
            silent.connect(dest);
            osc.start();
        }

        const label = [
            mic ? describeMic(mic, gate ? common.gateDb : null) : p.mic ? "no microphone" : "mic off",
            sys ? "others on" : p.others ? "no others audio" : "others off"
        ].join(" · ");

        const input: Input = { ctx: audioCtx, dest, micGain, sysGain, gate, video, streams, label };
        inputs.add(input);
        watch();
        applyLevels();
        return input;
    } catch {
        return abort();
    }
}

export async function testMic(common: Common, p: Profile): Promise<string> {
    if (testing) return "";
    testing = true;

    let input: Input | null = null;

    try {
        input = await openInput(common, { ...p, video: false, mic: true, others: false }, 48000);
        if (!input) return "Microphone unavailable";

        input.micGain?.gain.setValueAtTime(levels.micVolume / 100, input.ctx.currentTime);

        const recorder = new MediaRecorder(input.dest.stream, { mimeType: pickMime(["audio/webm;codecs=opus", "audio/webm"], "audio/webm") });
        const parts: Blob[] = [];

        const finished = new Promise<void>(resolve => {
            recorder.ondataavailable = e => {
                if (e.data.size) parts.push(e.data);
                if (parts.length >= 4 && recorder.state === "recording") recorder.stop();
            };
            recorder.onstop = () => resolve();
        });

        recorder.start(1000);
        await finished;

        const url = URL.createObjectURL(new Blob(parts, { type: "audio/webm" }));
        const player = new Audio(url);
        player.onended = () => URL.revokeObjectURL(url);
        await player.play();

        return input.label;
    } catch {
        return "Test failed";
    } finally {
        closeInput(input);
        testing = false;
    }
}

export async function startReplay(common: Common, p: Profile, seconds: number): Promise<boolean> {
    if (replay || startingReplay) return false;
    startingReplay = true;

    const my = epoch;
    let input: Input | null = null;
    let ok = false;

    try {
        input = await openInput(common, p, p.khz === 44100 ? 48000 : p.khz);
        if (!input || my !== epoch) return false;

        if (p.video && !input.video) showToast({ text: "Video capture unavailable, shadowplay is audio only.", variant: "critical" });

        const started = startRewind({
            audio: input.dest.stream,
            video: input.video,
            seconds,
            kbps: p.audioKbps,
            fps: p.fps,
            videoKbps: p.videoKbps,
            format: p.videoFormat
        });

        if (!started) {
            showToast({ text: "Shadowplay is not supported on this client.", variant: "critical" });
            return false;
        }

        replay = input;
        ok = true;
        return true;
    } catch {
        return false;
    } finally {
        startingReplay = false;
        if (!ok) closeInput(input);
    }
}

function stopReplay() {
    stopRewind();
    const r = replay;
    replay = null;
    closeInput(r);
}

function handleChunk(blob: Blob, streamMode: boolean, native: any) {
    if (!blob || blob.size === 0) return;

    if (streamMode) {
        pendingWrites = pendingWrites.then(async () => {
            try {
                await native.appendRecordingChunk(new Uint8Array(await blob.arrayBuffer()));
            } catch { }
        });
        return;
    }

    chunks.push(blob);
}

export async function startRecording(kind: "record" | "auto", common: Common, p: Profile): Promise<boolean> {
    if (rec || startingRec) return false;
    startingRec = true;

    const my = epoch;
    const native = getNative();
    let input: Input | null = null;
    let streamMode = false;
    let ok = false;

    try {
        const { mimeType, ext } = getRecordingConfig(p);

        input = await openInput(common, p, mimeType.includes("mp4") && p.khz < 44100 ? 44100 : p.khz);
        if (!input || my !== epoch) return false;

        if (p.video && !input.video) showToast({ text: "Video capture unavailable, recording audio only.", variant: "critical" });

        const stream = new MediaStream([...(input.video?.getVideoTracks() ?? []), ...input.dest.stream.getAudioTracks()]);

        const options: any = { mimeType, audioBitsPerSecond: p.audioKbps * 1000 };
        if (input.video) {
            options.videoBitsPerSecond = p.videoKbps * 1000;
            options.videoKeyFrameIntervalDuration = 2000;
        }

        let recorder: MediaRecorder;
        try {
            recorder = new MediaRecorder(stream, options);
        } catch {
            recorder = new MediaRecorder(stream);
        }

        const dateStr = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
        const filename = `Call_${dateStr}.${ext}`;

        if (native?.initStreamRecording && native?.appendRecordingChunk && native?.finalizeStreamRecording) {
            try {
                streamMode = (await native.initStreamRecording(filename)) === true;
            } catch {
                streamMode = false;
            }
            if (my !== epoch) return false;
        }

        chunks = [];
        pendingWrites = Promise.resolve();

        recorder.ondataavailable = e => handleChunk(e.data, streamMode, native);
        recorder.onstop = () => {
            if (rec && !stopping) void stopRecording();
        };
        recorder.start(input.video ? 5000 : 10000);

        rec = { recorder, input, profile: p, ask: common.ask, sub: SUBS[kind], filename, streamMode, startMs: Date.now() };
        ok = true;
        emitState();
        return true;
    } catch {
        return false;
    } finally {
        startingRec = false;
        if (!ok) {
            if (streamMode) Promise.resolve(native?.abortStreamRecording?.()).catch(() => { });
            closeInput(input);
        }
    }
}

export function stopRecording(): Promise<void> {
    const r = rec;
    if (!r || stopping) return Promise.resolve();
    stopping = true;

    const elapsed = Date.now() - r.startMs;
    const mimeType = r.recorder.mimeType || "audio/webm";
    const native = getNative();

    return new Promise<void>(resolve => {
        const finish = async () => {
            let result: SaveResult | null = null;

            try {
                await pendingWrites;

                if (elapsed >= MIN_SAVE_MS) {
                    if (r.streamMode && native?.finalizeStreamRecording) {
                        result = await native.finalizeStreamRecording(r.profile.folder, r.filename, elapsed, r.ask, r.sub);
                    } else if (chunks.length > 0) {
                        result = await saveBlob(new Blob(chunks, { type: mimeType }), r, elapsed);
                    }
                } else if (r.streamMode && native?.abortStreamRecording) {
                    await native.abortStreamRecording();
                }
            } catch {
                result = { status: "error" };
            } finally {
                r.recorder.ondataavailable = null;
                r.recorder.onstop = null;
                closeInput(r.input);
                rec = null;
                stopping = false;
                chunks = [];
                pendingWrites = Promise.resolve();

                emitState();
                if (result) savedHandler?.(result);
                resolve();
            }
        };

        if (r.recorder.state === "inactive") {
            void finish();
            return;
        }

        r.recorder.onstop = () => { void finish(); };

        try {
            r.recorder.stop();
        } catch {
            void finish();
        }
    });
}

export async function stopAll(): Promise<void> {
    epoch++;
    warnedOutput = false;
    await stopRecording();
    stopReplay();
}

async function saveBlob(blob: Blob, r: Recording, durationMs: number): Promise<SaveResult> {
    const native = getNative();

    try {
        const bytes = fixBufferDuration(new Uint8Array(await blob.arrayBuffer()), durationMs);
        const folder = r.profile.folder;

        if (r.ask && native?.promptSaveRecording) return await native.promptSaveRecording(bytes, folder, r.filename, r.sub);

        return (await native?.saveRecording?.(bytes, folder, r.filename, r.sub)) ?? { status: "error" };
    } catch {
        return { status: "error" };
    }
}
