/*
 * Vencord SpotifySearch plugin
 * Copyright (c) 2026 raizefastohand
 * Licensed under GPL-3.0-or-later
 */

import { settings } from "./settings";

declare const VencordNative: any;

export interface SpotifyTrack {
    id: string;
    name: string;
    url: string;
    artists: string;
    album: string;
    albumImage: string | null;
    durationMs: number;
}

const Native = VencordNative.pluginHelpers.SpotifySearch as {
    getToken(clientId: string, clientSecret: string): Promise<string>;
    search(token: string, query: string, limit: number): Promise<any>;
};

async function getToken(): Promise<string> {
    const { clientId, clientSecret } = settings.store;
    if (!clientId || !clientSecret) {
        throw new Error("Set Client ID and Client Secret in plugin settings.");
    }
    return await Native.getToken(clientId, clientSecret);
}

export async function searchTracks(query: string, limit = 5): Promise<SpotifyTrack[]> {
    const token = await getToken();
    const data = await Native.search(token, query, limit);
    const items = data?.tracks?.items ?? [];

    return items.map((t: any): SpotifyTrack => ({
        id: t.id,
        name: t.name,
        url: t.external_urls?.spotify ?? `https://open.spotify.com/track/${t.id}`,
        artists: (t.artists ?? []).map((a: any) => a.name).join(", "),
        album: t.album?.name ?? "",
        albumImage: t.album?.images?.[0]?.url ?? null,
        durationMs: t.duration_ms ?? 0,
    }));
}
