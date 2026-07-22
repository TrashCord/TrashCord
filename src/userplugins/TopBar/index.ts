/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import definePlugin from "@utils/types";

export default definePlugin({
    name: "TopBar",
    description: "Add customizable, Linux-inspired widgets on your Discord top bar.",
    authors: [{ name: "f3tch", id: 1016388460929626174n }],
    tags: ["Appearance", "Fun"],
    enabledByDefault: false,
    patches: [
        {
            find: "title:(0,F.jsx)(si,{}),trailing:(0,F.jsxs)(F.Fragment,{",
            replacement: {
                match: /e=nl\.intl\.string\(nl\.t\.TdEu5X\)/,
                replace: 'e="this is a long fucking injection that you are reading for no fucking reason i mean i was able to create a vencord plugin to inject this instead of just \\"Friends\\" which is pretty cool in my opinoin yk"'
            }
        }
    ]
});
