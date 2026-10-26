/*
 * TrashCord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Devs } from "@utils/constants";

import * as types from "../../philsPluginLibrary/types/constants";

export const PluginInfo: types.PluginInfo = {
    PLUGIN_NAME: "PhilsPluginLibrary",
    DESCRIPTION: "A library for phil's plugins",
    AUTHOR: {
        ...Devs.phil,
        github: "https://github.com/philhk"
    },
} as const;
