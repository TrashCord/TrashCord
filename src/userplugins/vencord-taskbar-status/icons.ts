/*
 * TaskbarStatus, a Vencord plugin
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { nativeImage, NativeImage } from "electron";

import { Status } from "./merge";

const COLORS: Record<Status, [number, number, number]> = {
    online: [0x23, 0xa5, 0x5a],
    idle: [0xf0, 0xb2, 0x32],
    dnd: [0xf2, 0x3f, 0x43],
    invisible: [0x80, 0x84, 0x8e]
};

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

// Premultiplied BGRA, which is what nativeImage.createFromBitmap expects on Windows.
function drawDot(size: number, [r, g, b]: [number, number, number], ring: boolean) {
    const buf = Buffer.alloc(size * size * 4);
    const c = (size - 1) / 2;
    const dotR = size * 0.34;
    const ringIn = size * 0.40;
    const ringOut = size * 0.48;

    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            const d = Math.hypot(x - c, y - c);
            const dotA = clamp01(dotR + 0.5 - d);
            const ringA = ring ? clamp01(ringOut + 0.5 - d) * clamp01(d - (ringIn - 0.5)) : 0;
            const a = dotA + ringA * (1 - dotA);
            if (a === 0) continue;

            const white = ringA * (1 - dotA);
            const i = (y * size + x) * 4;
            buf[i] = Math.round(b * dotA + 255 * white);
            buf[i + 1] = Math.round(g * dotA + 255 * white);
            buf[i + 2] = Math.round(r * dotA + 255 * white);
            buf[i + 3] = Math.round(a * 255);
        }
    }
    return buf;
}

const thumbCache = new Map<string, NativeImage>();

/** 16 logical px (32 physical, scaleFactor 2) status dot; `active` adds a white ring. */
export function thumbIcon(status: Status, active: boolean) {
    const key = `${status}:${active}`;
    let img = thumbCache.get(key);
    if (!img) {
        img = nativeImage.createFromBitmap(drawDot(32, COLORS[status], active), { width: 32, height: 32, scaleFactor: 2 });
        thumbCache.set(key, img);
    }
    return img;
}

/** PNG-in-ICO (Vista+): 6-byte ICONDIR + 16-byte ICONDIRENTRY + PNG data. */
export function statusIco(status: Status) {
    const size = 32;
    const png = nativeImage.createFromBitmap(drawDot(size, COLORS[status], false), { width: size, height: size }).toPNG();
    const header = Buffer.alloc(22);
    header.writeUInt16LE(1, 2); // type: icon
    header.writeUInt16LE(1, 4); // image count
    header[6] = size;
    header[7] = size;
    header.writeUInt16LE(1, 10); // planes
    header.writeUInt16LE(32, 12); // bit depth
    header.writeUInt32LE(png.length, 14);
    header.writeUInt32LE(22, 18); // data offset
    return Buffer.concat([header, png]);
}
