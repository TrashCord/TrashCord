/*
 * TrashCord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { Devs } from "@utils/constants";
import definePlugin, { OptionType, PluginSettingDef } from "@utils/types";

const settingsSharedProps: PluginSettingDef = {
    description: "",
    type: OptionType.BOOLEAN,
    default: true,
    restartNeeded: true,
};
const settings = definePluginSettings({
    autoCorrect: {
        ...settingsSharedProps,
        description: "Enable auto correct",
    },
    autoComplete: {
        ...settingsSharedProps,
        description: "Enable auto complete*",
    },
    autoCapitalize: {
        ...settingsSharedProps,
        description: "Enable auto capitalize*",
    },
});

export default definePlugin({
    name: "AutoCorrect",
    description: "Configure auto text correction, completion, and capitalization",
    settings,
    authors: [Devs.x2b],
    tags: ["Chat", "Utility"],
    enabledByDefault: false,
    patches: [
        {
            find: /autocorrect:"?(off|false|none)"?/i,
            replacement: {
                match: /autocorrect:"?(off|false|none)"?/i,
                replace: "autoCorrect:'on'",
            },
            all: true,
            predicate: () => settings.store.autoCorrect!,
        },
        {
            find: /autocomplete:"?(off|false|none|list)"?/i,
            replacement: {
                match: /autocomplete:"?(off|false|none|list)"?/i,
                replace: "autoComplete:'on'",
            },
            all: true,
            predicate: () => settings.store.autoComplete!,
        },
        {
            find: /autocapitalize:"?(off|false|none)"?/i,
            replacement: {
                match: /autocapitalize:"?(off|false|none)"?/i,
                replace: "autoCapitalize:'on'",
            },
            all: true,
            predicate: () => settings.store.autoCapitalize!,
        },
    ],
});





