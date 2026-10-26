/*
 * TrashCord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Song } from "../YtmStore";
import { EnhancedLyric } from "./types";

async function searchLyrics(trackName: string, artistName: string, albumName?: string | null): Promise<EnhancedLyric[]> {
    const params = new URLSearchParams({
        track_name: trackName,
        artist_name: artistName,
    });
    if (albumName) params.append("album_name", albumName);

    const res = await fetch(`https://lrclib.net/api/get?${params}`);
    if (!res.ok) throw new Error("Lyrics not found");

    const data = await res.json();
    const synced = data?.syncedLyrics;
    if (!synced) throw new Error("No synced lyrics available");

    const parsed: EnhancedLyric[] = synced
        .split("\n")
        .map(line => {
            const match = line.match(/^\[(\d+):(\d+\.\d+)\]\s*(.*)/);
            if (!match) return null;
            const [, min, sec, text] = match;
            return {
                time: parseInt(min) * 60 + parseFloat(sec),
                text: text
            } as EnhancedLyric;
        })
        .filter(Boolean) as EnhancedLyric[];

    if (!parsed.length) throw new Error("Failed to parse lyrics");

    return parsed;
}

export async function getLyrics(track: Song | null): Promise<EnhancedLyric[] | null> {
    if (!track?.title || !track?.artist) return null;

    const cleanArtist = track.artist.split(/[,&]| and /i)[0].trim();

    // Try all search strategies in parallel, return first successful result
    const searchPromises = [
        searchLyrics(track.title, track.artist, track.album),
        searchLyrics(track.title, track.artist),
        cleanArtist !== track.artist ? searchLyrics(track.title, cleanArtist) : null
    ].filter(Boolean);

    try {
        return await Promise.any(searchPromises);
    } catch {
        return null;
    }
}
