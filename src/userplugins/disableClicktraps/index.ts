/*
 * TrashCord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { managedStyleRootNode } from "@api/Styles";
import { Devs } from "@utils/constants";
import { createAndAppendStyle } from "@utils/css";
import definePlugin from "@utils/types";
import { findCssClassesLazy } from "@webpack";

let style: HTMLStyleElement;

const TitleBarClasses = findCssClassesLazy("show", "systemBar");

function clickTrapCss() {
    style.textContent = `
        .${TitleBarClasses.show} {
            display: none;
            flex: unset;
        }
        `;
}

export default definePlugin({
    name: "DisableClicktraps",
    description: "Disables the clicktraps that block clicks (modals, menus etc..)",
    authors: [Devs.RoScripter999],
    tags: ["Shortcuts", "Accessibility"],
    enabledByDefault: false,
    start() {
        style = createAndAppendStyle("VcDisableClicktraps", managedStyleRootNode);

        clickTrapCss();
    },

    stop() {
        style?.remove();
    },

    patches: [
        // for some reason it doesnt use the clicktrap module in the other patch.
        {
            find: 'left,"Missing left"',
            replacement: {
                // TODO: make this a stable compat, although it wasn't been changed for months now.
                match: /clickTrap:(\w+)=!1([\s\S]*?\[\w+\.\w+\]:)\1/,
                replace: "clickTrap:$1=!1$2!1"
            }
        },
        {
            find: '"scrim":"empty"',
            replacement: {
                match: /let\s*\{\s*variant[^}]*onClick[^}]*\}\s*=\s*\w+/,
                replace: "return null;"
            }
        },
        // We prevent focus trapping by defaulting the target to null.
        // making modules not capture the focus, which makes this module completely unusable
        {
            find: ".current?.ownerDocument??document,[",
            replacement: {
                match: /=(\w+)\.disable\?(\w+):\w+/,
                replace: "=$2"
            }
        }
    ]
});