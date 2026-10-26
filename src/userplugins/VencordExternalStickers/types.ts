/*
 * TrashCord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export type StickerRef = {
    type: "dccon";
    packageIdx: string;
};

export type StickerPack = {
    name: string;
    icon: Uint8Array;
    stickers: Sticker[];
};

export type Sticker = {
    name: string;
    key: string;
    data: Uint8Array;
    ext: string;
};
