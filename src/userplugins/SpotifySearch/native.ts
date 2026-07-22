/*
 * Vencord SpotifySearch plugin
 * Copyright (c) 2026 raizefastohand
 * Licensed under GPL-3.0-or-later
 */

import { IpcMainInvokeEvent } from "electron";

let cachedToken: { value: string; expiresAt: number } | null = null;

export async function getToken(_: IpcMainInvokeEvent, clientId: string, clientSecret: string): Promise<string> {
    if (cachedToken && cachedToken.expiresAt > Date.now() + 5000) {
        return cachedToken.value;
    }

    const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
    const res = await fetch("https://accounts.spotify.com/api/token", {
        method: "POST",
        headers: {
            "Authorization": `Basic ${basic}`,
            "Content-Type": "application/x-www-form-urlencoded",
        },
        body: "grant_type=client_credentials",
    });

    if (!res.ok) {
        const text = await res.text();
        throw new Error(`Spotify auth failed: ${res.status} ${text}`);
    }

    const data = await res.json();
    cachedToken = {
        value: data.access_token,
        expiresAt: Date.now() + data.expires_in * 1000,
    };
    return cachedToken.value;
}

export async function search(_: IpcMainInvokeEvent, token: string, query: string, limit: number): Promise<any> {
    const url = `https://api.spotify.com/v1/search?q=${encodeURIComponent(query)}&type=track&limit=${limit}`;
    const res = await fetch(url, {
        headers: { "Authorization": `Bearer ${token}` },
    });

    if (res.status === 401) {
        cachedToken = null;
        throw new Error("Token expired, please retry the command");
    }

    if (!res.ok) {
        const text = await res.text();
        throw new Error(`Spotify search failed: ${res.status} ${text}`);
    }

    return await res.json();
}
