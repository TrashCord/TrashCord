/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 nin0dev
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Devs } from "@utils/constants";
import definePlugin from "@utils/types";
import { findByPropsLazy } from "@webpack";
import { showToast } from "@webpack/common";

const SpotifySocket = findByPropsLazy("getActiveSocketAndDevice");
const SpotifyAPI = findByPropsLazy("vcSpotifyMarker");

function queueSong(id: string) {
    const { socket } = SpotifySocket.getActiveSocketAndDevice();
    if (!socket) return showToast("Make sure that Spotify is running before queuing a song", "failure");

    try {
        SpotifyAPI.post(socket.accountId, socket.accessToken, {
            url: "https://api.spotify.com/v1/me/player/queue",
            query: {
                uri: `spotify:track:${id}`
            }
        });
        showToast("Song queued", "success");
    }
    catch (e) {
        console.error(e);
        showToast("An error occurred, check console", "failure");
    }
}

export default definePlugin({
    name: "SpotifyAddToQueue",
    description: "Adds a button in Spotify embeds to add the song to the queue",
    authors: [Devs.nin0dev],
    tags: ["Media", "Utility"],
    enabledByDefault: false,
    iframeMessageListener: e => {
        try {
            const songIDMatch = (e.data as string).match(/vc-spotifyaddtoqueue__([a-zA-Z0-9]{0,200})/);
            if (!songIDMatch) return;

            const songID = songIDMatch[1];
            queueSong(songID);
        }
        catch {
            return;
        }
    },
    start() {
        window.addEventListener("message", this.iframeMessageListener);
    },
    stop() {
        window.removeEventListener("message", this.iframeMessageListener);
    }
});
