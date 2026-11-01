/*
 * TrashCord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { IpcMainInvokeEvent } from "electron";

const LINK_REGEX = /^https:\/\/verify\.doublecounter\.gg\/v\/[0-9a-z]{8,16}$/;

export async function verify(_: IpcMainInvokeEvent, url: string): Promise<boolean> {
    if (typeof url !== "string" || !LINK_REGEX.test(url)) return false;
    try {
        const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
        return res.ok;
    } catch {
        return false;
    }
}