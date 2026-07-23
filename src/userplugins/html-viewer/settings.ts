/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { OptionType } from "@utils/types";

export const settings = definePluginSettings({
    maxSizeKb: {
        type: OptionType.NUMBER,
        description: "Largest artifact (KB) allowed to render inline. Bigger files still offer Full view.",
        default: 512
    },
    autoRenderAll: {
        type: OptionType.BOOLEAN,
        description: "Auto-render every HTML artifact inline (skip the Render button).",
        default: false
    },
    autoRenderUsers: {
        type: OptionType.STRING,
        description: "User IDs whose HTML auto-renders (comma-separated). Toggle per-user from the artifact card.",
        default: ""
    },
    autoRenderServers: {
        type: OptionType.STRING,
        description: "Server IDs whose HTML auto-renders (comma-separated). Toggle per-server from the artifact card.",
        default: ""
    }
});
