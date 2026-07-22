/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Devs } from "@utils/constants";
import definePlugin from "@utils/types";

export default definePlugin({
    name: "BypassPinPrompt",
    description: "Bypass the pin prompt when using the pin functions",
    tags: ["Shortcuts"],
    authors: [Devs.thororen],
    patches: [
        ...[
            'source:"message-actions"',
            'id:"pin",action',
            '"Channel Pins"',
        ].map(find => ({
            find,
            replacement: [
                {
<<<<<<< HEAD
                    match: /(\i\.\i\.(?:unpin|pin)Message\(\i,\i\.id\)):\i\.\i\.confirm(?:Unpin|Pin)\(\i,\i\)/g,
=======
                    match: /(\i\.\i\.(unpin|pin)Message\(\i,\i\.id\)):\i\.\i\.confirm(Unpin|Pin)\(\i,\i\)/g,
>>>>>>> 89b0fd2a5 (Update index.tsx)
                    replace: "$1:$1"
                }
            ]
        }))
    ],
});
