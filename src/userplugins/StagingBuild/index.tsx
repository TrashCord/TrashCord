/*
 * TrashCord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Settings } from "@api/Settings";
import { Devs } from "@utils/constants";
import definePlugin, { OptionType } from "@utils/types";
import { Forms, Text  } from "@webpack/common";

export default definePlugin({
    name: "StagingBuild",
    description: "Allows you to switch to staging build!",
    authors: [Devs.HappyEnderman],
    tags: ["Developers", "Utility"],
    enabledByDefault: false,

    patches: [],

    options: {
        description: {
            type: OptionType.COMPONENT,
            description: "",
            component: () => {
                return (
                    <Forms.FormText>
                        This will enable experiments, disable tracking requests, allows access to more features
                    </Forms.FormText>
                );
            }
        }
    },

    start() {
        window.GLOBAL_ENV.RELEASE_CHANNEL = "staging"
    },

    stop() {

    }
});

