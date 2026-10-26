/*
 * TrashCord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { Devs } from "@utils/constants";
import definePlugin, { OptionType } from "@utils/types";

const settings = definePluginSettings({
    Max: {
        description: "Max reactions",
        type: OptionType.NUMBER,
        default: 5,
    },
});

export default definePlugin({
    name: "MoreReact",
    description: "This plugin allows you to modify the max number of reactions for the frencency reaction experiment",
    authors: [Devs.x2b],
    tags: ["Reactions", "Fun"],
    enabledByDefault: false,
    patches: [
        {
            find: ".MESSAGE_HOVER_BAR_REACTION_SUGGESTION_ADD_ALLY",
            replacement: {
                match: /(\.length>=3?.{0,40}\.slice\(0),3\)/,
                replace: "$1,$self.settings.store.Max)"
            }
        }
    ],
    settings,
});