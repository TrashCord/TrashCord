/*
 * TrashCord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { React } from "@webpack/common";

import { panelClasses } from "../../../philsPluginLibrary/discordModules";

export interface SettingsPanelProps {
    children: React.ComponentProps<"div">["children"];
}

export const SettingsPanel = ({ children }: SettingsPanelProps) => {
    return (
        <div
            className={panelClasses.container}>
            {children}
        </div>
    );
};
