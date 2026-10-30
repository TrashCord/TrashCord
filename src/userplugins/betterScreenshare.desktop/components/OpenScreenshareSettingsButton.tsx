/*
 * TrashCord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Button } from "@components/Button";
import React from "react";

import { openScreenshareModal } from "../../betterScreenshare.desktop/modals";

export interface OpenScreenshareSettingsButtonProps {
    title?: string;
}

export const OpenScreenshareSettingsButton = (props: OpenScreenshareSettingsButtonProps) => {
    return (
        <Button
            size="small"
            variant="secondary"
            onClick={openScreenshareModal}
        >
            {props.title ? props.title : "Screenshare Settings"}
        </Button>
    );
};
