/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import ErrorBoundary from "@components/ErrorBoundary";
import { Devs } from "@utils/constants";
import definePlugin from "@utils/types";

import { YoutubeMusicLyrics } from "./lyrics/components/lyrics";
import { YtmPlayer } from "./PlayerComponent";
import { settings, toggleHoverControls } from "./settings";

import ytmStyles from "./ytmStyles.css?managed";
import lyricsStyles from "./lyrics/styles.css?managed";
/* import hoverStyles from "./hoverOnly.css?managed"; */

export default definePlugin({
    name: "YoutubeMusicControls",
    description: "YouTube Music Controls and Lyrics",
    authors: [Devs.Ven, Devs.afn, Devs.KraXen72, Devs.Av32000, Devs.nin0dev, Devs.Joona],
    enabledByDefault: false,
    tags: ["Media", "Utility", "Activity", "Youtube", "YoutubeMusic", "YoutubeMusicControls"],
    managedStyle: [ytmStyles, lyricsStyles], 
    settings,
    patches: [
        {
            find: ".DISPLAY_NAME_STYLES_COACHMARK)",
            replacement: {
                // react.jsx)(AccountPanel or $self.PanelWrapper, { ..., showTaglessAccountPanel: blah })
                match: /(?<=\i\.jsxs?\)\()(\i(?:\.\i)?),{(?=[^}]*?userTag:\i,occluded:)/,
                // react.jsx(WrapperComponent, { VencordOriginal: AccountPanel/PanelWrapper, ...
                replace: "$self.PanelWrapper,{VencordOriginal:$1,",
            },
        },
    ],

    PanelWrapper({ VencordOriginal, ...props }) {
        const {
            showYoutubeMusicLyrics,
            LyricsPosition,
        } = settings.use([
            "showYoutubeMusicLyrics",
            "LyricsPosition",
        ]);

        return (
            <>
                <ErrorBoundary
                    fallback={() => (
                        <div className="vc-ytm-fallback">
                            <p>Failed to render YouTube Music player :(</p>
                            <p>Check the console for errors</p>
                        </div>
                    )}
                >
                    {showYoutubeMusicLyrics && LyricsPosition === "above" && (
                        <YoutubeMusicLyrics />
                    )}
                    {<YtmPlayer />}
                    {showYoutubeMusicLyrics && LyricsPosition === "below" && (
                        <YoutubeMusicLyrics />
                    )}
                </ErrorBoundary>

                <VencordOriginal {...props} />
            </>
        );
    },

    async start() {
        toggleHoverControls(settings.store.hoverControls);
    },
});
