/*
 * TrashCord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { classes } from "@utils/misc";
import { Button } from "@webpack/common";
import React, { JSX } from "react";

import { panelClasses } from "../../../philsPluginLibrary";

export type IconComponent = <T extends { className: string; }>(props: T) => JSX.Element;
export interface SettingsPanelButtonProps extends Partial<React.ComponentProps<typeof Button>> {
    icon?: IconComponent;
}

export const SettingsPanelButton = (props: SettingsPanelButtonProps) => {
    return (
        <Button
            size={Button.Sizes.SMALL}
            className={classes(panelClasses.button, panelClasses.buttonColor)}
            {...props}
        >
            {props.icon && <props.icon className={classes(panelClasses.buttonIcon)} />}
        </Button>
    );
};
