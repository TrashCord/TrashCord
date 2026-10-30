/*
 * TrashCord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { MuxPacket, MuxVideo } from "./mux";
import { opusHead } from "./ogg";

interface Track {
    id: number;
    video: boolean;
    timescale: number;
    sizes: number[];
    deltas: number[];
    keys: number[];
    offsets: number[];
    entry: Uint8Array;
    width: number;
    height: number;
}

const textEncoder = new TextEncoder();
const MATRIX = [0x00010000, 0, 0, 0, 0x00010000, 0, 0, 0, 0x40000000];

function join(parts: Uint8Array[]): Uint8Array {
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let offset = 0;
    for (const p of parts) {
        out.set(p, offset);
        offset += p.length;
    }
    return out;
}

function u8(n: number): Uint8Array {
    return Uint8Array.of(n & 0xff);
}

function u16(n: number): Uint8Array {
    const b = new Uint8Array(2);
    new DataView(b.buffer).setUint16(0, n & 0xffff, false);
    return b;
}

function u32(n: number): Uint8Array {
    const b = new Uint8Array(4);
    new DataView(b.buffer).setUint32(0, n >>> 0, false);
    return b;
}

function u32s(values: number[]): Uint8Array {
    const b = new Uint8Array(values.length * 4);
    const dv = new DataView(b.buffer);
    values.forEach((v, i) => dv.setUint32(i * 4, v >>> 0, false));
    return b;
}

function ascii(text: string): Uint8Array {
    return textEncoder.encode(text);
}

function zeros(n: number): Uint8Array {
    return new Uint8Array(n);
}

function box(type: string, ...parts: Uint8Array[]): Uint8Array {
    const body = join(parts);
    return join([u32(body.length + 8), ascii(type), body]);
}

function full(type: string, flags: number, ...parts: Uint8Array[]): Uint8Array {
    return box(type, u32(flags), ...parts);
}

function stts(deltas: number[]): Uint8Array {
    const runs: number[] = [];
    for (const d of deltas) {
        const n = runs.length;
        if (n && runs[n - 1] === d) runs[n - 2]++;
        else runs.push(1, d);
    }
    return full("stts", 0, u32(runs.length / 2), u32s(runs));
}

function trak(t: Track, movieMs: number): Uint8Array {
    const media = t.deltas.reduce((n, d) => n + d, 0);
    const mediaMs = Math.round(media * 1000 / t.timescale);

    const stbl = box(
        "stbl",
        full("stsd", 0, u32(1), t.entry),
        stts(t.deltas),
        ...(t.video ? [full("stss", 0, u32(t.keys.length), u32s(t.keys))] : []),
        full("stsc", 0, u32(1), u32(1), u32(1), u32(1)),
        full("stsz", 0, u32(0), u32(t.sizes.length), u32s(t.sizes)),
        full("stco", 0, u32(t.offsets.length), u32s(t.offsets))
    );

    const minf = box(
        "minf",
        t.video ? full("vmhd", 1, u16(0), zeros(6)) : full("smhd", 0, u16(0), u16(0)),
        box("dinf", full("dref", 0, u32(1), full("url ", 1))),
        stbl
    );

    const mdia = box(
        "mdia",
        full("mdhd", 0, u32(0), u32(0), u32(t.timescale), u32(media), u16(0x55C4), u16(0)),
        full("hdlr", 0, u32(0), ascii(t.video ? "vide" : "soun"), zeros(12), ascii(t.video ? "Video\0" : "Audio\0")),
        minf
    );

    return box(
        "trak",
        full("tkhd", 3, u32(0), u32(0), u32(t.id), u32(0), u32(Math.max(movieMs, mediaMs)), zeros(8), u16(0), u16(0), u16(t.video ? 0 : 0x0100), u16(0), u32s(MATRIX), u32(t.width * 65536), u32(t.height * 65536)),
        mdia
    );
}

export function muxMp4(
    video: MuxVideo,
    videoPackets: MuxPacket[],
    audioPackets: MuxPacket[],
    head: Uint8Array | undefined,
    channels: number,
    startUs: number
): Blob {
    const opus = head && head.length >= 19 ? head : opusHead(channels, 312);
    const preSkip = new DataView(opus.buffer, opus.byteOffset, opus.byteLength).getUint16(10, true);

    const ticks = videoPackets.map(p => Math.max(0, Math.round((p.time - startUs) * 0.09)));
    const videoDeltas = ticks.map((t, i) => (i + 1 < ticks.length ? Math.max(1, ticks[i + 1] - t) : 0));
    if (videoDeltas.length) videoDeltas[videoDeltas.length - 1] = videoDeltas.length > 1 ? videoDeltas[videoDeltas.length - 2] : 3000;

    const videoTrack: Track = {
        id: 1,
        video: true,
        timescale: 90000,
        sizes: videoPackets.map(p => p.data.length),
        deltas: videoDeltas,
        keys: videoPackets.flatMap((p, i) => (p.key ? [i + 1] : [])),
        offsets: [],
        width: video.width,
        height: video.height,
        entry: box(
            "avc1",
            zeros(6), u16(1), zeros(16), u16(video.width), u16(video.height),
            u32(0x00480000), u32(0x00480000), u32(0), u16(1), zeros(32), u16(0x0018), u16(0xFFFF),
            box("avcC", video.description ?? new Uint8Array(0))
        )
    };

    const audioTrack: Track = {
        id: 2,
        video: false,
        timescale: 48000,
        sizes: audioPackets.map(p => p.data.length),
        deltas: audioPackets.map(p => Math.max(1, Math.round((p.dur ?? 20000) * 0.048))),
        keys: [],
        offsets: [],
        width: 0,
        height: 0,
        entry: box(
            "Opus",
            zeros(6), u16(1), zeros(8), u16(channels), u16(16), u16(0), u16(0), u32(48000 * 65536),
            box("dOps", u8(0), u8(channels), u16(preSkip), u32(48000), u16(0), u8(0))
        )
    };

    const tracks = audioPackets.length ? [videoTrack, audioTrack] : [videoTrack];

    const order: Array<{ track: Track; data: Uint8Array; }> = [];
    let a = 0;
    let v = 0;
    while (a < audioPackets.length || v < videoPackets.length) {
        const useVideo = v < videoPackets.length && (a >= audioPackets.length || videoPackets[v].time <= audioPackets[a].time);
        order.push(useVideo ? { track: videoTrack, data: videoPackets[v++].data } : { track: audioTrack, data: audioPackets[a++].data });
    }

    const relative = new Map<Track, number[]>(tracks.map(t => [t, []]));
    let position = 0;
    for (const item of order) {
        relative.get(item.track)?.push(position);
        position += item.data.length;
    }

    const movieMs = Math.max(...tracks.map(t => Math.round(t.deltas.reduce((n, d) => n + d, 0) * 1000 / t.timescale)));

    const ftyp = box("ftyp", ascii("isom"), u32(512), ascii("isom"), ascii("iso2"), ascii("avc1"), ascii("mp41"));

    const buildMoov = (base: number) => {
        tracks.forEach(t => { t.offsets = (relative.get(t) ?? []).map(o => o + base); });
        return box(
            "moov",
            full("mvhd", 0, u32(0), u32(0), u32(1000), u32(movieMs), u32(0x00010000), u16(0x0100), zeros(10), u32s(MATRIX), zeros(24), u32(tracks.length + 1)),
            ...tracks.map(t => trak(t, movieMs))
        );
    };

    const moovSize = buildMoov(0).length;
    const moov = buildMoov(ftyp.length + moovSize + 8);
    const mdat = join([u32(position + 8), ascii("mdat")]);

    return new Blob([ftyp, moov, mdat, ...order.map(o => o.data)] as BlobPart[], { type: "video/mp4" });
}
