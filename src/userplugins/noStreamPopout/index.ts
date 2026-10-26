/*
 * TrashCord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { Devs } from "@utils/constants";
import definePlugin, { OptionType } from "@utils/types";

const settings = definePluginSettings({
    hideMode: {
        description: "When to hide the stream popout",
        type: OptionType.SELECT,
        options: [
            { label: "Always (all streams)", value: "all", default: true },
            { label: "Only my own stream", value: "ownStream" }
        ]
    },
    hidePopoutButton: {
        description: "Hide the 'Pop out' button on others' streams",
        type: OptionType.BOOLEAN,
        default: false
    }
});

export default definePlugin({
    name: "NoStreamPopout",
    description: "Removes the streaming popout, either always or only for your own stream",
    authors: [Devs.RoScripter999],
    tags: ["Organisation", "Appearance", "Voice"],
    enabledByDefault: false,
    settings,
    patches: [
        {
            find: "#{intl::OPEN_IN_THEATER}",
            replacement: {
                match: /return\s*\(\s*\d+\s*,\s*\w+\.jsxs\)\(\s*"[^"]+"\s*,\s*\{/,
                replace: "if($self.hideAll)return null;$&"
            }
        },
        {
            find: "Cannot render settings for non stream participant",
            replacement: [
                {
                    match: /render\(\)\{let\{channel:/,
                    replace: "render(){if($self.hideOwnStream&&this?.viewProperties?.isSelf===true)return null;let{channel:"
                },
                {
                    match: /(?<=renderPopoutIcon=\(\)=>)/,
                    replace: "$self.hidePopoutButton?null:"
                }
            ]
        }
    ],

    get hideAll() { return settings.store.hideMode === "all"; },
    get hideOwnStream() { return settings.store.hideMode === "ownStream"; },
    get hidePopoutButton() { return settings.store.hidePopoutButton; }
});