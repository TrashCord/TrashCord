/*
 * Vencord SpotifySearch plugin
 * Copyright (c) 2026 raizefastohand
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
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