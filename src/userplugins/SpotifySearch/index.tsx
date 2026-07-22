/*
 * Vencord SpotifySearch plugin
 * Copyright (c) 2026 raizefastohand
 * Licensed under GPL-3.0-or-later
 */

import definePlugin from "@utils/types";
import { ApplicationCommandInputType, ApplicationCommandOptionType, sendBotMessage } from "@api/Commands";
import { openModal } from "@utils/modal";
import { sendMessage } from "@utils/discord";
import { settings } from "./settings";
import { searchTracks } from "./api";
import { SpotifyModal } from "./SpotifyModal";

export default definePlugin({
    name: "SpotifySearch",
    description: "Search Spotify via /spotify and send a track link. Uses external Spotify Web API; requires user-provided credentials and an active Premium subscription on the app owner account.",
    authors: [{ name: "raizefastohand", id: 1337050138610372659n }],
    tags: ["Media", "Utility", "Commands"],
    enabledByDefault: false,
    dependencies: ["CommandsAPI"],
    settings,

    commands: [
        {
            name: "spotify",
            description: "Search Spotify and pick a track to send",
            inputType: ApplicationCommandInputType.BUILT_IN,
            options: [
                {
                    name: "query",
                    description: "Track name / artist / keywords",
                    type: ApplicationCommandOptionType.STRING,
                    required: true,
                },
            ],
            execute: async (args, ctx) => {
                const rawQuery = args.find(a => a.name === "query")?.value as string | undefined;
                const query = rawQuery?.trim().slice(0, 200);

                if (!query || query.length < 2) {
                    sendBotMessage(ctx.channel.id, { content: "Please provide a search query (at least 2 characters)." });
                    return;
                }

                sendBotMessage(ctx.channel.id, { content: `🔎 Searching Spotify for **${query}**...` });

                try {
                    const tracks = await searchTracks(query, 5);
                    if (tracks.length === 0) {
                        sendBotMessage(ctx.channel.id, { content: `No tracks found for **${query}**.` });
                        return;
                    }

                    openModal(rootProps => (
                        <SpotifyModal
                            rootProps={rootProps}
                            tracks={tracks}
                            onPick={track => {
                                sendMessage(ctx.channel.id, { content: track.url });
                            }}
                        />
                    ));
                } catch (e: any) {
                    sendBotMessage(ctx.channel.id, {
                        content: `Spotify error: ${e?.message ?? String(e)}`,
                    });
                }
            },
        },
    ],
});
