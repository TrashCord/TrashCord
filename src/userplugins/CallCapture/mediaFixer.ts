/*
 * TrashCord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export interface HeadPatch {
    start: number;
    end: number;
    bytes: Uint8Array;
}

export type ContainerKind = "mp4" | "webm" | null;

export const FIX_HEAD_BYTES = 131072;

const EBML_HEADER_ID = 0x1A45DFA3;
const SEGMENT_ID = 0x18538067;
const INFO_ID = 0x1549A966;
const TIMECODE_SCALE_ID = 0x2AD7B1;
const DURATION_ID = 0x4489;

export function detectContainer(head: Uint8Array): ContainerKind {
    if (head.length < 8) return null;
    if (head[0] === 0x1A && head[1] === 0x45 && head[2] === 0xDF && head[3] === 0xA3) return "webm";
    if (head[4] === 0x66 && head[5] === 0x74 && head[6] === 0x79 && head[7] === 0x70) return "mp4";
    return null;
}

export function patchMp4Head(head: Uint8Array, durationMs: number): boolean {
    const view = new DataView(head.buffer, head.byteOffset, head.byteLength);
    let movieTimescale = 1000;
    let changed = false;

    const put = (at: number, version: number, units: number) => {
        if (version === 1) {
            view.setUint32(at, Math.floor(units / 4294967296), false);
            view.setUint32(at + 4, units >>> 0, false);
        } else {
            view.setUint32(at, units >>> 0, false);
        }
        changed = true;
    };

    const scan = (start: number, end: number, parent: string): boolean => {
        let pos = start;
        while (pos + 8 <= end) {
            const size = view.getUint32(pos, false);
            const type = String.fromCharCode(head[pos + 4], head[pos + 5], head[pos + 6], head[pos + 7]);
            let headerSize = 8;
            let boxEnd = pos + size;
            if (size === 1) {
                headerSize = 16;
                boxEnd = pos + view.getUint32(pos + 8, false) * 4294967296 + view.getUint32(pos + 12, false);
            } else if (size === 0) {
                boxEnd = end;
            }
            if (boxEnd <= pos) return true;

            const c = pos + headerSize;
            const version = c < end ? head[c] : 0;

            if (type === "mvhd" && parent === "moov") {
                if (version === 1) {
                    movieTimescale = view.getUint32(c + 20, false) || 1000;
                    put(c + 24, 1, Math.round((durationMs / 1000) * movieTimescale));
                } else {
                    movieTimescale = view.getUint32(c + 12, false) || 1000;
                    put(c + 16, 0, Math.round((durationMs / 1000) * movieTimescale));
                }
            } else if (type === "tkhd" && parent === "trak") {
                put(version === 1 ? c + 28 : c + 20, version, Math.round((durationMs / 1000) * movieTimescale));
            } else if (type === "mdhd" && parent === "mdia") {
                const timescale = view.getUint32(version === 1 ? c + 20 : c + 12, false) || movieTimescale;
                put(version === 1 ? c + 24 : c + 16, version, Math.round((durationMs / 1000) * timescale));
            } else if (type === "mehd" && parent === "mvex") {
                put(c + 4, version, Math.round((durationMs / 1000) * movieTimescale));
            } else if (type === "moov" || type === "trak" || type === "mdia" || type === "mvex") {
                scan(c, Math.min(boxEnd, end), type);
                if (type === "moov" && parent === "") return true;
            }

            pos = boxEnd;
        }
        return false;
    };

    try {
        scan(0, head.length, "");
    } catch { }

    return changed;
}

function readEbmlId(a: Uint8Array, p: number): { id: number; len: number; } | null {
    const b = a[p];
    let len = 1;
    let mask = 0x80;
    while (len <= 4 && !(b & mask)) {
        len++;
        mask >>= 1;
    }
    if (len > 4 || p + len > a.length) return null;
    let id = 0;
    for (let i = 0; i < len; i++) id = id * 256 + a[p + i];
    return { id, len };
}

function readEbmlSize(a: Uint8Array, p: number): { len: number; value: number; unknown: boolean; } | null {
    const b = a[p];
    let len = 1;
    let mask = 0x80;
    while (len <= 8 && !(b & mask)) {
        len++;
        mask >>= 1;
    }
    if (len > 8 || p + len > a.length) return null;
    let value = b & (mask - 1);
    let allOnes = value === mask - 1;
    for (let i = 1; i < len; i++) {
        value = value * 256 + a[p + i];
        if (a[p + i] !== 0xff) allOnes = false;
    }
    return { len, value, unknown: allOnes };
}

function writeEbmlSize(a: Uint8Array, p: number, len: number, value: number) {
    let v = value;
    for (let i = len - 1; i >= 0; i--) {
        a[p + i] = v % 256;
        v = Math.floor(v / 256);
    }
    a[p] |= 0x80 >> (len - 1);
}

function computeWebmPatch(src: Uint8Array, durationMs: number): HeadPatch | null {
    const ebml = readEbmlId(src, 0);
    if (!ebml || ebml.id !== EBML_HEADER_ID) return null;
    const ebmlSize = readEbmlSize(src, ebml.len);
    if (!ebmlSize || ebmlSize.unknown) return null;

    const segIdPos = ebml.len + ebmlSize.len + ebmlSize.value;
    const segId = readEbmlId(src, segIdPos);
    if (!segId || segId.id !== SEGMENT_ID) return null;
    const segSizePos = segIdPos + segId.len;
    const segSize = readEbmlSize(src, segSizePos);
    if (!segSize) return null;

    let pos = segSizePos + segSize.len;
    while (pos < src.length) {
        const id = readEbmlId(src, pos);
        if (!id) return null;
        const size = readEbmlSize(src, pos + id.len);
        if (!size || size.unknown) return null;
        const dataStart = pos + id.len + size.len;
        const dataEnd = dataStart + size.value;
        if (dataEnd > src.length) return null;

        if (id.id !== INFO_ID) {
            pos = dataEnd;
            continue;
        }

        let timecodeScale = 1000000;
        let durationStart = -1;
        let durationLength = 0;
        let p = dataStart;

        while (p < dataEnd) {
            const cid = readEbmlId(src, p);
            if (!cid) return null;
            const csize = readEbmlSize(src, p + cid.len);
            if (!csize || csize.unknown) return null;
            const cStart = p + cid.len + csize.len;
            if (cStart + csize.value > dataEnd) return null;

            if (cid.id === TIMECODE_SCALE_ID) {
                let v = 0;
                for (let i = 0; i < csize.value; i++) v = v * 256 + src[cStart + i];
                if (v > 0) timecodeScale = v;
            } else if (cid.id === DURATION_ID) {
                durationStart = cStart;
                durationLength = csize.value;
            }
            p = cStart + csize.value;
        }

        const units = (durationMs * 1000000) / timecodeScale;

        if (durationStart >= 0) {
            if (durationLength !== 4 && durationLength !== 8) return null;
            const bytes = new Uint8Array(durationLength);
            const dv = new DataView(bytes.buffer);
            if (durationLength === 4) dv.setFloat32(0, units, false);
            else dv.setFloat64(0, units, false);
            return { start: durationStart, end: durationStart + durationLength, bytes };
        }

        const element = new Uint8Array(11);
        element[0] = 0x44;
        element[1] = 0x89;
        element[2] = 0x88;
        new DataView(element.buffer).setFloat64(3, units, false);

        const growth = element.length + (8 - size.len);
        const out = new Uint8Array(dataEnd + growth);

        out.set(src.subarray(0, pos + id.len), 0);
        let w = pos + id.len;
        writeEbmlSize(out, w, 8, size.value + element.length);
        w += 8;
        out.set(src.subarray(dataStart, dataEnd), w);
        w += size.value;
        out.set(element, w);

        if (!segSize.unknown) writeEbmlSize(out, segSizePos, segSize.len, segSize.value + growth);

        return { start: 0, end: dataEnd, bytes: out };
    }

    return null;
}

export function patchWebmHead(head: Uint8Array, durationMs: number): HeadPatch | null {
    try {
        return computeWebmPatch(head, durationMs);
    } catch {
        return null;
    }
}

export function fixBufferDuration(buffer: Uint8Array, durationMs: number): Uint8Array {
    if (durationMs <= 0) return buffer;

    const head = buffer.subarray(0, Math.min(buffer.length, FIX_HEAD_BYTES));
    const kind = detectContainer(head);

    if (kind === "mp4") {
        patchMp4Head(head, durationMs);
        return buffer;
    }

    if (kind === "webm") {
        const patch = patchWebmHead(head, durationMs);
        if (!patch) return buffer;

        if (patch.bytes.length === patch.end - patch.start) {
            buffer.set(patch.bytes, patch.start);
            return buffer;
        }

        const out = new Uint8Array(patch.start + patch.bytes.length + (buffer.length - patch.end));
        out.set(buffer.subarray(0, patch.start), 0);
        out.set(patch.bytes, patch.start);
        out.set(buffer.subarray(patch.end), patch.start + patch.bytes.length);
        return out;
    }

    return buffer;
}