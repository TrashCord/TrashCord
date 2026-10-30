/*
 * TrashCord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { muxMp4 } from "./mp4";
import { muxMatroska, type MuxPacket } from "./mux";
import { makeWav, muxOggOpus, type OpusPacket } from "./ogg";
import { emitState } from "./shared";

export interface ReplayConfig {
    audio: MediaStream;
    video: MediaStream | null;
    seconds: number;
    kbps: number;
    fps: number;
    videoKbps: number;
    format: string;
}

export interface ClipResult {
    blob: Blob;
    ext: string;
    seconds: number;
}

interface Entry {
    data: Uint8Array;
    time: number;
    dur: number;
    key: boolean;
}

interface Source {
    byteLength: number;
    copyTo(destination: AllowSharedBufferSource): void;
}

const MAX_VIDEO_BYTES = 536870912;
const KEEP_US = 3000000;

class Ring {
    buf = new Uint8Array(0);
    used = 0;
    base = 0;
    first = 0;
    total = 0;
    sizes: number[] = [];
    times: number[] = [];
    durs: number[] = [];
    keys: boolean[] = [];

    reset(capacity: number) {
        this.buf = new Uint8Array(capacity);
        this.used = 0;
        this.base = 0;
        this.first = 0;
        this.total = 0;
        this.sizes = [];
        this.times = [];
        this.durs = [];
        this.keys = [];
    }

    get count() {
        return this.sizes.length - this.first;
    }

    get bytes() {
        return this.used - this.base;
    }

    push(src: Source, time: number, dur: number, key: boolean) {
        const size = src.byteLength;

        if (this.used + size > this.buf.length) {
            this.compact();
            if (this.used + size > this.buf.length) {
                const bigger = new Uint8Array(Math.max(this.buf.length * 2, this.used + size));
                bigger.set(this.buf.subarray(0, this.used));
                this.buf = bigger;
            }
        }

        src.copyTo(this.buf.subarray(this.used, this.used + size));
        this.used += size;
        this.sizes.push(size);
        this.times.push(time);
        this.durs.push(dur);
        this.keys.push(key);
        this.total += dur;
    }

    trim(drop: (index: number) => boolean) {
        while (this.first < this.sizes.length - 1 && drop(this.first)) {
            this.total -= this.durs[this.first];
            this.base += this.sizes[this.first];
            this.first++;
        }
        if (this.first >= 1024) this.compact();
    }

    compact() {
        if (this.first === 0) return;
        this.buf.copyWithin(0, this.base, this.used);
        this.used -= this.base;
        this.base = 0;
        this.sizes.splice(0, this.first);
        this.times.splice(0, this.first);
        this.durs.splice(0, this.first);
        this.keys.splice(0, this.first);
        this.first = 0;
    }

    entries(): Entry[] {
        const out: Entry[] = [];
        let offset = this.base;
        for (let i = this.first; i < this.sizes.length; i++) {
            out.push({ data: this.buf.subarray(offset, offset + this.sizes[i]), time: this.times[i], dur: this.durs[i], key: this.keys[i] });
            offset += this.sizes[i];
        }
        return out;
    }
}

const audio = new Ring();
const video = new Ring();

let aReader: ReadableStreamDefaultReader<any> | null = null;
let aEncoder: AudioEncoder | null = null;
let vReader: ReadableStreamDefaultReader<any> | null = null;
let vEncoder: VideoEncoder | null = null;
let head: Uint8Array | undefined;
let vDesc: Uint8Array | undefined;
let vCodec: "avc" | "vp8" = "vp8";
let vFormat = "mp4";
let vWidth = 0;
let vHeight = 0;
let channels = 2;
let sampleRate = 48000;
let nextAudioUs = 0;
let newestVideo = 0;
let limitUs = 60000000;
let origin = 0;
let token = 0;

const nowUs = () => Math.round((performance.now() - origin) * 1000);

export function isRewinding(): boolean {
    return aReader !== null;
}

export function setRewindSeconds(seconds: number) {
    const s = Number(seconds);
    limitUs = (Number.isFinite(s) ? Math.max(0, s) : 60) * 1000000;
}

function toBytes(desc: AllowSharedBufferSource): Uint8Array {
    const view = ArrayBuffer.isView(desc)
        ? new Uint8Array(desc.buffer, desc.byteOffset, desc.byteLength)
        : new Uint8Array(desc);
    return view.slice();
}

function avcCodec(width: number, height: number, fps: number): string {
    const rate = width * height * fps;
    const level = rate <= 27648000 ? "1f" : rate <= 62668800 ? "28" : rate <= 124416000 ? "2a" : "33";
    return `avc1.6400${level}`;
}

function onAudioPacket(chunk: EncodedAudioChunk, meta?: EncodedAudioChunkMetadata) {
    if (!aReader) return;

    const desc = meta?.decoderConfig?.description;
    if (desc && !head) head = toBytes(desc);

    const dur = chunk.duration ?? 20000;
    audio.push(chunk, nextAudioUs, dur, true);
    nextAudioUs += dur;

    if (limitUs > 0) audio.trim(i => audio.total - audio.durs[i] > limitUs);
}

function onVideoChunk(chunk: EncodedVideoChunk, meta?: EncodedVideoChunkMetadata) {
    if (!vReader) return;

    const desc = meta?.decoderConfig?.description;
    if (desc && !vDesc) vDesc = toBytes(desc);

    video.push(chunk, chunk.timestamp, 0, chunk.type === "key");
    newestVideo = chunk.timestamp;

    video.trim(i => video.bytes > MAX_VIDEO_BYTES || (limitUs > 0 && newestVideo - video.times[i] > limitUs + KEEP_US));
}

function createAudioEncoder(my: number, rate: number, count: number, bitrate: number): AudioEncoder | null {
    try {
        const enc = new AudioEncoder({
            output: onAudioPacket,
            error: () => {
                if (my === token) stopRewind();
            }
        });
        enc.configure({ codec: "opus", sampleRate: rate, numberOfChannels: count, bitrate });
        return enc;
    } catch {
        return null;
    }
}

async function createVideoEncoder(my: number, frame: VideoFrame, cfg: ReplayConfig): Promise<VideoEncoder | null> {
    const width = frame.displayWidth & ~1;
    const height = frame.displayHeight & ~1;
    const base = { width, height, bitrate: cfg.videoKbps * 1000, framerate: cfg.fps, latencyMode: "realtime", bitrateMode: "constant" };
    const avc = { ...base, codec: avcCodec(width, height, cfg.fps), avc: { format: "avc" } };

    const candidates: any[] = cfg.format === "webm"
        ? [{ ...base, codec: "vp8" }]
        : [{ ...avc, hardwareAcceleration: "prefer-hardware" }, avc, { ...base, codec: "vp8" }];

    for (const config of candidates) {
        try {
            if (!(await VideoEncoder.isConfigSupported(config)).supported) continue;

            const enc = new VideoEncoder({
                output: onVideoChunk,
                error: () => {
                    if (my === token) dropVideo();
                }
            });
            enc.configure(config);

            vCodec = config.codec === "vp8" ? "vp8" : "avc";
            vWidth = width;
            vHeight = height;
            return enc;
        } catch { }
    }

    return null;
}

async function pumpAudio(my: number, rd: ReadableStreamDefaultReader<any>, bitrate: number) {
    let enc: AudioEncoder | null = null;

    try {
        for (; ;) {
            const { done, value } = await rd.read();
            if (done || !value) break;

            if (my !== token) {
                value.close();
                break;
            }

            if (!enc) {
                sampleRate = value.sampleRate;
                channels = value.numberOfChannels;
                enc = createAudioEncoder(my, sampleRate, channels, bitrate);
                if (!enc) {
                    value.close();
                    stopRewind();
                    break;
                }
                aEncoder = enc;
                nextAudioUs = nowUs();
            }

            enc.encode(value);
            value.close();
        }
    } catch {
        if (my === token) stopRewind();
    }
}

async function pumpVideo(my: number, rd: ReadableStreamDefaultReader<any>, cfg: ReplayConfig) {
    let enc: VideoEncoder | null = null;
    let count = 0;
    const every = Math.max(1, Math.round(cfg.fps * 2));

    try {
        for (; ;) {
            const { done, value } = await rd.read();
            if (done || !value) break;

            if (my !== token) {
                value.close();
                break;
            }

            if (!enc) {
                enc = await createVideoEncoder(my, value, cfg);
                if (!enc || my !== token) {
                    value.close();
                    enc?.close();
                    if (my === token) dropVideo();
                    break;
                }
                vEncoder = enc;
            }

            if (enc.encodeQueueSize > 4) {
                value.close();
                continue;
            }

            const frame = new VideoFrame(value, { timestamp: nowUs() });
            value.close();
            enc.encode(frame, { keyFrame: count++ % every === 0 });
            frame.close();
        }
    } catch {
        if (my === token) dropVideo();
    }
}

function dropVideo() {
    const rd = vReader;
    vReader = null;
    if (rd) rd.cancel().catch(() => { });

    const enc = vEncoder;
    vEncoder = null;
    if (enc && enc.state !== "closed") {
        try {
            enc.close();
        } catch { }
    }

    video.reset(0);
    vDesc = undefined;
    newestVideo = 0;
}

export function startRewind(cfg: ReplayConfig): boolean {
    stopRewind();

    const track = cfg.audio.getAudioTracks()[0];
    const Processor = (window as any).MediaStreamTrackProcessor;
    if (!track || !Processor || typeof AudioEncoder === "undefined") return false;

    try {
        origin = performance.now();
        vFormat = cfg.format;
        setRewindSeconds(cfg.seconds);
        audio.reset(1 << 20);
        aReader = new Processor({ track }).readable.getReader();

        const my = ++token;
        void pumpAudio(my, aReader!, cfg.kbps * 1000);

        const videoTrack = cfg.video?.getVideoTracks()[0];
        if (videoTrack && typeof VideoEncoder !== "undefined") {
            video.reset(1 << 22);
            vReader = new Processor({ track: videoTrack }).readable.getReader();
            void pumpVideo(my, vReader!, cfg);
        }

        emitState();
        return true;
    } catch {
        stopRewind();
        return false;
    }
}

export function stopRewind() {
    token++;

    const rd = aReader;
    aReader = null;
    if (rd) rd.cancel().catch(() => { });

    const enc = aEncoder;
    aEncoder = null;
    if (enc && enc.state !== "closed") {
        try {
            enc.close();
        } catch { }
    }

    dropVideo();
    audio.reset(0);
    head = undefined;
    nextAudioUs = 0;

    if (rd) emitState();
}

function buildVideoClip(): ClipResult | null {
    if (!vEncoder || !vWidth || (vCodec === "avc" && !vDesc)) return null;

    const vs = video.entries();
    if (!vs.length) return null;

    const as = audio.entries();
    const last = as[as.length - 1];
    const end = Math.max(vs[vs.length - 1].time, last ? last.time + last.dur : 0);
    const wanted = limitUs > 0 ? end - limitUs : -Infinity;

    let start = -1;
    for (let i = 0; i < vs.length; i++) {
        if (!vs[i].key) continue;
        if (start < 0 || vs[i].time <= wanted) start = i;
        else break;
    }
    if (start < 0) return null;

    const startUs = vs[start].time;
    const videoPackets: MuxPacket[] = vs.slice(start).map(e => ({ data: e.data, time: e.time, key: e.key }));
    const audioPackets: MuxPacket[] = as.filter(e => e.time + e.dur > startUs).map(e => ({ data: e.data, time: e.time, key: true, dur: e.dur }));

    const mp4 = vCodec === "avc" && vFormat === "mp4";
    const mux = mp4 ? muxMp4 : muxMatroska;
    const blob = mux({ codec: vCodec, width: vWidth, height: vHeight, description: vDesc }, videoPackets, audioPackets, head, channels, startUs);
    return { blob, ext: vCodec === "avc" ? (mp4 ? "mp4" : "mkv") : "webm", seconds: (end - startUs) / 1000000 };
}

export async function buildClip(format: "ogg" | "wav"): Promise<ClipResult | null> {
    if (audio.count === 0) return null;

    const withVideo = buildVideoClip();
    if (withVideo) return withVideo;

    const list: OpusPacket[] = audio.entries().map(e => ({ data: e.data, duration: e.dur }));
    const seconds = audio.total / 1000000;
    const ogg = muxOggOpus(list, channels, head);

    if (format !== "wav") return { blob: ogg, ext: "ogg", seconds };

    try {
        const ctx = new OfflineAudioContext(2, 1, sampleRate);
        const decoded = await ctx.decodeAudioData(await ogg.arrayBuffer());
        return { blob: makeWav(decoded), ext: "wav", seconds };
    } catch {
        return { blob: ogg, ext: "ogg", seconds };
    }
}
