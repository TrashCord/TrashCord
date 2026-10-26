/*
 * TrashCord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { OptionType } from "@utils/types";

export const settings = definePluginSettings({
    clientId: {
        type: OptionType.STRING,
        description: "Spotify Application Client ID (from developer.spotify.com/dashboard)",
        default: "",
        placeholder: "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
    },
    clientSecret: {
        type: OptionType.STRING,
        description: "Spotify Application Client Secret (keep this private!)",
        default: "",
        placeholder: "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
    },
});