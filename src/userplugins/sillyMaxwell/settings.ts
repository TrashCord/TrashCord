/*
 * TrashCord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { OptionType } from "@utils/types";

export const settings = definePluginSettings({
    gifLink1: {
        type: OptionType.STRING,
        description: "Link for silly gif 1 :3 :3 (moving)",
        default: "https://media.tenor.com/El89itaAWsIAAAAi/maxwell.gif",
    },
    gifLink2: {
        type: OptionType.STRING,
        description: "Link for silly gif 2 :3 :3 (stationary)",
        default: "https://media.tenor.com/qJRMLPlR3_8AAAAj/maxwell-cat.gif",
    },
    gifSize: {
        type: OptionType.NUMBER,
        description: "Size of silliness ;3",
        default: 150,
    },
    concurrentMaxwells: {
        type: OptionType.NUMBER,
        description: "MaxwellMaxxing (warning this can get too silly)",
        default: 1,
    }
});
