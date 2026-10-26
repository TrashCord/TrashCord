/*
 * TrashCord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { OptionType } from "@utils/types";
import { React } from "@webpack/common";

function RedirectNote() {
    return (
        <div style={{
            padding: 12,
            background: "var(--background-secondary)",
            borderRadius: 6,
            color: "var(--text-normal)",
            fontSize: 14,
            lineHeight: 1.4,
        }}>
            Configure your gradient in <strong>User Settings → Appearance</strong>.
        </div>
    );
}

const settings = definePluginSettings({
    redirect: {
        type: OptionType.COMPONENT,
        description: "",
        component: RedirectNote,
    },
});

export default settings;
