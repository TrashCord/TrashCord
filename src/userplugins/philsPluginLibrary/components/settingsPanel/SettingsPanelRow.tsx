/*
 * TrashCord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { classes } from "@utils/misc";
import React from "react";

import { panelClasses } from "../../../philsPluginLibrary/discordModules";

export interface SettingsPanelRowProps {
    children: React.ComponentProps<"div">["children"];
}

export const SettingsPanelRow = ({ children }: SettingsPanelRowProps) => {
    return (
        <div
            className={classes(panelClasses.actionButtons)}
            style={{ padding: 0 }}
        >
            {children}
        </div>
    );
};
