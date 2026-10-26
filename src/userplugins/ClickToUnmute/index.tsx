/*
 * TrashCord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { findByPropsLazy } from "@webpack";
import definePlugin from "@utils/types";
import { MediaEngineStore, React } from "@webpack/common";

const VoiceActions = findByPropsLazy("toggleLocalMute");

const STYLE: React.CSSProperties = { cursor: "pointer" };

function unmute(id: string) {
    try {
        if (MediaEngineStore.isLocalMute(id)) VoiceActions.toggleLocalMute(id);
    } catch { }
}

export default definePlugin({
    name: "ClickToUnmute",
    description: "Click the mute icon next to a locally muted voice member to unmute them instantly.",
    authors: [{ name: "DavidHiFi", id: 0n }, { name: "Kurtzon Audio", id: 1552878708732469258n }, { name: "zfrancesck1", id: 456195985404592149n }],
    enabledByDefault: false,
    patches: [
        {
            find: ".VOICE_PANEL}}",
            replacement: {
                match: /(?<=user:(\i),disconnected:.{0,900}?localMute:(\i).{0,500}?)children:(\i)(?=\},"mute"[)}\]])/,
                replace: "children:$2?$self.renderClickable($1,$3):$3"
            }
        }
    ],
    renderClickable(user: { id: string; }, icon: React.ReactNode) {
        return (
            <span style={STYLE} onClick={e => { e.stopPropagation(); unmute(user.id); }}>
                {icon}
            </span>
        );
    }
});