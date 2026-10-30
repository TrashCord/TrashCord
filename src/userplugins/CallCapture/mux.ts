/*
 * TrashCord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { opusHead } from "./ogg";

export interface MuxVideo {
    codec: "avc" | "vp8";
    width: number;
    height: number;
    description?: Uint8Array;
}

export interface MuxPacket {
    data: Uint8Array;
    time: number;
    key: boolean;
    dur?: number;
}

interface Item {
    track: number;
    t: number;
    key: boolean;
    data: Uint8Array;
}

const textEncoder = new TextEncoder();

function idBytes(id: number): Uint8Array {
    const out: number[] = [];
    let v = id;
    while (v > 0) {
        out.unshift(v % 256);
        v = Math.floor(v / 256);
    }
    return Uint8Array.from(out);
}

function sizeBytes(n: number): Uint8Array {
    const b = new Uint8Array(8);
    b[0] = 1;
    let v = n;
    for (let i = 7; i >= 1; i--) {
        b[i] = v % 256;
        v = Math.floor(v / 256);
    }
    return b;
}

function total(parts: Uint8Array[]): number {
    return parts.reduce((n, p) => n + p.length, 0);
}

function join(parts: Uint8Array[]): Uint8Array {
    const out = new Uint8Array(total(parts));
    let offset = 0;
    for (const p of parts) {
        out.set(p, offset);
        offset += p.length;
    }
    return out;
}

function wrap(id: number, parts: Uint8Array[]): Uint8Array[] {
    return [join([idBytes(id), sizeBytes(total(parts))]), ...parts];
}

function el(id: number, ...parts: Uint8Array[]): Uint8Array {
    return join(wrap(id, parts));
}

function uint(id: number, value: number): Uint8Array {
    const bytes: number[] = [];
    let n = value;
    do {
        bytes.unshift(n % 256);
        n = Math.floor(n / 256);
    } while (n > 0);
    return el(id, Uint8Array.from(bytes));
}

function float(id: number, value: number): Uint8Array {
    const b = new Uint8Array(8);
    new DataView(b.buffer).setFloat64(0, value, false);
    return el(id, b);
}

function text(id: number, value: string): Uint8Array {
    return el(id, textEncoder.encode(value));
}

function block(track: number, rel: number, key: boolean, data: Uint8Array): Uint8Array[] {
    const header = new Uint8Array(4);
    header[0] = 0x80 | track;
    new DataView(header.buffer).setInt16(1, rel, false);
    header[3] = key ? 0x80 : 0;
    return wrap(0xA3, [header, data]);
}

export function muxMatroska(
    video: MuxVideo,
    videoPackets: MuxPacket[],
    audioPackets: MuxPacket[],
    head: Uint8Array | undefined,
    channels: number,
    startUs: number
): Blob {
    const webm = video.codec === "vp8";
    const opus = head && head.length >= 19 ? head : opusHead(channels, 312);
    const preSkip = new DataView(opus.buffer, opus.byteOffset, opus.byteLength).getUint16(10, true);
    const ms = (us: number) => Math.max(0, Math.round((us - startUs) / 1000));

    const items: Item[] = [];
    let a = 0;
    let v = 0;
    while (a < audioPackets.length || v < videoPackets.length) {
        const useVideo = v < videoPackets.length && (a >= audioPackets.length || videoPackets[v].time <= audioPackets[a].time);
        const p = useVideo ? videoPackets[v++] : audioPackets[a++];
        items.push({ track: useVideo ? 1 : 2, t: ms(p.time), key: useVideo ? p.key : true, data: p.data });
    }

    const duration = items.length ? items[items.length - 1].t : 0;

    const ebml = el(
        0x1A45DFA3,
        uint(0x4286, 1),
        uint(0x42F7, 1),
        uint(0x42F2, 4),
        uint(0x42F3, 8),
        text(0x4282, webm ? "webm" : "matroska"),
        uint(0x4287, 4),
        uint(0x4285, 2)
    );

    const info = el(
        0x1549A966,
        uint(0x2AD7B1, 1000000),
        float(0x4489, duration),
        text(0x4D80, "CallCapture"),
        text(0x5741, "CallCapture")
    );

    const videoTrack = el(
        0xAE,
        uint(0xD7, 1),
        uint(0x73C5, 1),
        uint(0x83, 1),
        uint(0x9C, 0),
        text(0x86, webm ? "V_VP8" : "V_MPEG4/ISO/AVC"),
        ...(video.description ? [el(0x63A2, video.description)] : []),
        el(0xE0, uint(0xB0, video.width), uint(0xBA, video.height))
    );

    const audioTrack = el(
        0xAE,
        uint(0xD7, 2),
        uint(0x73C5, 2),
        uint(0x83, 2),
        uint(0x9C, 0),
        text(0x86, "A_OPUS"),
        el(0x63A2, opus),
        uint(0x56AA, Math.round(preSkip * 1000000000 / 48000)),
        uint(0x56BB, 80000000),
        el(0xE1, float(0xB5, 48000), uint(0x9F, channels))
    );

    const tracks = el(0x1654AE6B, videoTrack, audioTrack);

    const clusters: Uint8Array[] = [];
    let cluster: Uint8Array[] = [];
    let clusterStart = 0;
    let open = false;

    const flush = () => {
        if (!open) return;
        for (const part of wrap(0x1F43B675, cluster)) clusters.push(part);
        cluster = [];
        open = false;
    };

    for (const item of items) {
        const fresh = !open
            || (item.track === 1 && item.key && item.t - clusterStart >= 1000)
            || item.t - clusterStart > 20000;

        if (fresh) {
            flush();
            open = true;
            clusterStart = item.t;
            cluster.push(uint(0xE7, item.t));
        }

        for (const part of block(item.track, item.t - clusterStart, item.key, item.data)) cluster.push(part);
    }
    flush();

    const body = [info, tracks, ...clusters];
    const segment = join([idBytes(0x18538067), sizeBytes(total(body))]);

    return new Blob([ebml, segment, ...body] as BlobPart[], { type: webm ? "video/webm" : "video/x-matroska" });
}
