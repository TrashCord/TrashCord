/*
 * TrashCord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export interface OpusPacket {
    data: Uint8Array;
    duration: number;
}

const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
        let r = i << 24;
        for (let j = 0; j < 8; j++) r = r & 0x80000000 ? ((r << 1) ^ 0x04c11db7) : r << 1;
        t[i] = r >>> 0;
    }
    return t;
})();

function crc32(bytes: Uint8Array): number {
    let c = 0;
    for (let i = 0; i < bytes.length; i++) c = ((c << 8) ^ CRC_TABLE[((c >>> 24) ^ bytes[i]) & 0xff]) >>> 0;
    return c;
}

function oggPage(packets: Uint8Array[], granule: number, serial: number, seq: number, flags: number): Uint8Array {
    const lacing: number[] = [];
    for (const p of packets) {
        let len = p.length;
        while (len >= 255) {
            lacing.push(255);
            len -= 255;
        }
        lacing.push(len);
    }

    const body = packets.reduce((n, p) => n + p.length, 0);
    const page = new Uint8Array(27 + lacing.length + body);
    const dv = new DataView(page.buffer);
    page.set([0x4f, 0x67, 0x67, 0x53], 0);
    page[4] = 0;
    page[5] = flags;
    dv.setBigInt64(6, BigInt(granule), true);
    dv.setUint32(14, serial, true);
    dv.setUint32(18, seq, true);
    dv.setUint32(22, 0, true);
    page[26] = lacing.length;
    page.set(lacing, 27);

    let off = 27 + lacing.length;
    for (const p of packets) {
        page.set(p, off);
        off += p.length;
    }

    dv.setUint32(22, crc32(page), true);
    return page;
}

export function opusHead(channels: number, preSkip: number): Uint8Array {
    const b = new Uint8Array(19);
    const dv = new DataView(b.buffer);
    b.set([0x4f, 0x70, 0x75, 0x73, 0x48, 0x65, 0x61, 0x64], 0);
    b[8] = 1;
    b[9] = channels;
    dv.setUint16(10, preSkip, true);
    dv.setUint32(12, 48000, true);
    dv.setInt16(16, 0, true);
    b[18] = 0;
    return b;
}

function opusTags(): Uint8Array {
    const vendor = new TextEncoder().encode("AutoCallRecorder");
    const b = new Uint8Array(8 + 4 + vendor.length + 4);
    const dv = new DataView(b.buffer);
    b.set([0x4f, 0x70, 0x75, 0x73, 0x54, 0x61, 0x67, 0x73], 0);
    dv.setUint32(8, vendor.length, true);
    b.set(vendor, 12);
    dv.setUint32(12 + vendor.length, 0, true);
    return b;
}

export function muxOggOpus(packets: OpusPacket[], channels: number, head: Uint8Array | undefined): Blob {
    const serial = (Math.random() * 0xffffffff) >>> 0;
    const headBytes = head && head.length >= 19 ? head : opusHead(channels, 312);
    const preSkip = new DataView(headBytes.buffer, headBytes.byteOffset, headBytes.byteLength).getUint16(10, true);

    const pages: Uint8Array[] = [];
    let seq = 0;
    pages.push(oggPage([headBytes], 0, serial, seq++, 0x02));
    pages.push(oggPage([opusTags()], 0, serial, seq++, 0x00));

    let samples = 0;
    let group: Uint8Array[] = [];
    let groupSegs = 0;

    const flush = (last: boolean) => {
        if (!group.length) return;
        pages.push(oggPage(group, samples + preSkip, serial, seq++, last ? 0x04 : 0x00));
        group = [];
        groupSegs = 0;
    };

    for (const p of packets) {
        const segs = Math.floor(p.data.length / 255) + 1;
        if (group.length >= 40 || groupSegs + segs > 255) flush(false);
        group.push(p.data);
        groupSegs += segs;
        samples += Math.round(p.duration * 48 / 1000);
    }
    flush(true);

    return new Blob(pages as BlobPart[], { type: "audio/ogg" });
}

function writeText(dv: DataView, offset: number, text: string) {
    for (let i = 0; i < text.length; i++) dv.setUint8(offset + i, text.charCodeAt(i));
}

export function makeWav(audio: AudioBuffer): Blob {
    const channels = audio.numberOfChannels;
    const frames = audio.length;
    const bytes = frames * channels * 2;
    const buffer = new ArrayBuffer(44 + bytes);
    const dv = new DataView(buffer);

    writeText(dv, 0, "RIFF");
    dv.setUint32(4, 36 + bytes, true);
    writeText(dv, 8, "WAVE");
    writeText(dv, 12, "fmt ");
    dv.setUint32(16, 16, true);
    dv.setUint16(20, 1, true);
    dv.setUint16(22, channels, true);
    dv.setUint32(24, audio.sampleRate, true);
    dv.setUint32(28, audio.sampleRate * channels * 2, true);
    dv.setUint16(32, channels * 2, true);
    dv.setUint16(34, 16, true);
    writeText(dv, 36, "data");
    dv.setUint32(40, bytes, true);

    const data: Float32Array[] = [];
    for (let c = 0; c < channels; c++) data.push(audio.getChannelData(c));

    let offset = 44;
    for (let i = 0; i < frames; i++) {
        for (let c = 0; c < channels; c++) {
            const s = Math.max(-1, Math.min(1, data[c][i]));
            dv.setInt16(offset, s < 0 ? s * 32768 : s * 32767, true);
            offset += 2;
        }
    }

    return new Blob([buffer], { type: "audio/wav" });
}
