/*
 * TrashCord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import definePlugin from "@utils/types";

function Note() {
    return (
        <div style={{ color: "var(--text-muted)", fontSize: 13, marginBottom: 8 }}>
            This removes the client-side permission check only. Discord can still refuse the camera or the stream on its side, and if it does,
            your own preview turns on but nobody else sees it.
        </div>
    );
}

export default definePlugin({
    name: "CameraUnlock",
    description: "Unlocks the camera and Go Live buttons in voice channels where you do not have the Stream permission.",
    authors: [{ name: "Kurtzon", id: 0n }],
    tags: ["Voice", "Utility"],
    enabledByDefault: false,
    searchTerms: ["camera", "video", "stream", "permission", "bypass"],
    settingsAboutComponent: Note,

    patches: [
        {
            find: "afkChannelId!==",
            replacement: {
                match: /!!\i\.can\(\i\.\i\.STREAM,\i\)(?=&&null!=\i&&\i\.afkChannelId!==\i\.id)/,
                replace: "!0"
            }
        }
    ]
});
