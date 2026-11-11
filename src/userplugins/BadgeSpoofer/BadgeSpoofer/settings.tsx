/*
 * TrashCord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { addHeaderBarButton, removeHeaderBarButton } from "@api/HeaderBar";
import { isPluginEnabled } from "@api/PluginManager";
import { definePluginSettings } from "@api/Settings";
import { OptionType } from "@utils/types";
import { Button } from "@components/Button";
import { React } from "@webpack/common";

import { openBadgeSpooferModal } from "./components/BadgeSpooferModal";
import { BadgeSpooferHeaderButton } from "./components/HeaderButton";
import { HypeSquadPicker } from "./hypesquad";

export const settings = definePluginSettings({
    dashboardButton: {
        type: OptionType.COMPONENT,
        description: "Open the Badge Spoofer control center to configure and start inflating your Discord badges",
        component: () => (
            <Button
                variant="primary"
                onClick={openBadgeSpooferModal}
            >
                Open Badge Spoofer Dashboard
            </Button>
        )
    },
    defaultHours: {
        type: OptionType.NUMBER,
        description: "Default hours of playtime to spoof per game",
        default: 1,
    },
    defaultStreamHours: {
        type: OptionType.NUMBER,
        description: "Default hours of streaming to spoof per game",
        default: 1,
    },
    defaultGames: {
        type: OptionType.NUMBER,
        description: "Default number of games to spoof (0 = all available)",
        default: 0,
    },
    headerButton: {
        type: OptionType.BOOLEAN,
        description: "Show the Badge Spoofer button in the header bar",
        default: true,
        onChange: (value: boolean) => {
            if (!isPluginEnabled("BadgeSpoofer")) return;
            if (value) addHeaderBarButton("BadgeSpoofer", BadgeSpooferHeaderButton, 5);
            else removeHeaderBarButton("BadgeSpoofer");
        }
    },
    batchSize: {
        type: OptionType.NUMBER,
        description: "Number of game events to bundle per /science request batch",
        default: 50,
    },
    batchDelay: {
        type: OptionType.NUMBER,
        description: "Delay between /science request batches in milliseconds",
        default: 300,
    },
    customFingerprint: {
        type: OptionType.STRING,
        description: "Optional custom executable_fingerprint for the Games-Played badge counter",
        default: "",
    },
    housePicker: {
        type: OptionType.COMPONENT,
        description: "Pick your HypeSquad house visually",
        component: () => <HypeSquadPicker />
    }
});
