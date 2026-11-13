/*
 * TrashCord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import managedStyle from "./styles.css?managed";

import { definePluginSettings } from "@api/Settings";
import ErrorBoundary from "@components/ErrorBoundary";
import { openPluginModal } from "@components/settings";
import definePlugin, { OptionType } from "@utils/types";
import { onceReady } from "@webpack";

import { checkInterrupted, maxAll, stop as stopFarmer } from "./farmer";
import { createHeaderButton, IconIdle } from "./header";
import { LANGUAGES } from "./i18n";
import { BadgeFarmerDashboard, loadCatalogue } from "./ui";

export const settings = definePluginSettings({
    dashboard: {
        type: OptionType.COMPONENT,
        description: "Farming dashboard",
        component: BadgeFarmerDashboard
    },
    language: { type: OptionType.SELECT, description: "Language", options: LANGUAGES, hidden: true },
    headerButton: { type: OptionType.BOOLEAN, description: "Header button", default: true, hidden: true },
    toasts: { type: OptionType.BOOLEAN, description: "Notifications", default: true, hidden: true },
    autoSwitch: { type: OptionType.BOOLEAN, description: "Auto Turbo / Slow", default: true, hidden: true },
    autoStartMaxAll: { type: OptionType.BOOLEAN, description: "Run Max All at startup", default: false, hidden: true },
    showGamePresence: { type: OptionType.BOOLEAN, description: "Show game as activity", default: false, hidden: true }
});

const HeaderButton = ErrorBoundary.wrap(
    createHeaderButton(() => settings.use(["headerButton"]).headerButton),
    { noop: true }
);

const plugin = definePlugin({
    name: "BadgeFarmer",
    description: "Credited Game Time, Game Variety, and Streaming hours straight to Discord's analytics. One click, every tier.",
    authors: [{ name: "rico", id: 1361736124858630274n }, { name: "zfrancesck1", id: 456195985404592149n }],
    tags: ["Activity", "Customisation", "Utility"],
    enabledByDefault: false,
    managedStyle,
    searchTerms: ["badges", "farm", "game time", "game variety", "streaming"],
    settings,

    headerBarButton: {
        icon: IconIdle,
        render: HeaderButton,
        priority: 5
    },

    toolboxActions: {
        "Open Badge Farmer"() {
            openPluginModal(plugin);
        }
    },

    start() {
        void checkInterrupted();
        if (!settings.store.autoStartMaxAll) return;
        onceReady.then(() =>
            loadCatalogue().then(
                apps => void maxAll(apps),
                () => { }
            ));
    },

    stop() {
        stopFarmer();
    }
});

export default plugin;
