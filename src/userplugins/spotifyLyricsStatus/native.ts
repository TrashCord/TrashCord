/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 mally
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { IpcMainInvokeEvent } from "electron";
import { appendFile } from "fs/promises";
import { join } from "path";

const debugLogPath = join(process.env.USERPROFILE ?? process.cwd(), "Desktop", "DiscordLyrics", "spotify-lyrics-debug.log");

export async function fetchJson(_: IpcMainInvokeEvent, url: string) {
    try {
        const parsed = new URL(url);
        if (parsed.origin !== "https://lrclib.net") {
            return { status: 400, data: { error: "Only LRCLIB requests are allowed" } };
        }

        const response = await fetch(parsed, {
            headers: {
                Accept: "application/json",
                "User-Agent": "Vencord SpotifyLyricsStatus"
            }
        });

        if (response.status === 404) return { status: 404, data: null };

        const text = await response.text();
        return {
            status: response.status,
            data: text ? JSON.parse(text) : null
        };
    } catch (error) {
        return {
            status: -1,
            data: { error: String(error) }
        };
    }
}

export async function logDebug(_: IpcMainInvokeEvent, message: string) {
    await appendFile(debugLogPath, `${new Date().toISOString()} ${message}\n`, "utf8");
}