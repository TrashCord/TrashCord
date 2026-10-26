/*
 * TrashCord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { Devs } from "@utils/constants";
import definePlugin, { OptionType } from "@utils/types";
import { findComponentByCodeLazy } from "@webpack";

import { PluginInfo } from "../betterMicrophone.desktop/constants";
import { openMicrophoneSettingsModal } from "../betterMicrophone.desktop/modals";
import { MicrophonePatcher } from "../betterMicrophone.desktop/patchers";
import { initMicrophoneStore } from "../betterMicrophone.desktop/stores";
import { Emitter, MicrophoneSettingsIcon } from "../philsPluginLibrary";

const Button = findComponentByCodeLazy(".NONE,disabled:", ".PANEL_BUTTON");

function micSettingsButton() {
    const { hideSettingsIcon } = settings.use(["hideSettingsIcon"]);
    if (hideSettingsIcon) return null;
    return (
        <Button
            tooltipText="Change microphone settings"
            icon={MicrophoneSettingsIcon}
            role="button"
            onClick={openMicrophoneSettingsModal}
        />
    );
}

const settings = definePluginSettings({
    hideSettingsIcon: {
        type: OptionType.BOOLEAN,
        description: "Hide the settings icon.",
        default: true,
    }
});

export default definePlugin({
    name: "BetterMicrophone",
    description: "This plugin allows you to further customize your microphone.",
    authors: [Devs.phil],
    tags: ["Voice", "Customisation"],
    enabledByDefault: false,
    dependencies: ["PhilsPluginLibrary"],
    patches: [
        {
            find: "#{intl::ACCOUNT_SPEAKING_WHILE_MUTED}",
            replacement: {
                match: /className:\i\.buttons,.{0,50}children:\[/,
                replace: "$&$self.micSettingsButton(),"
            }
        }
    ],
    settings: settings,
    start(): void {
        initMicrophoneStore();

        this.microphonePatcher = new MicrophonePatcher().patch();
    },
    stop(): void {
        this.microphonePatcher?.unpatch();

        Emitter.removeAllListeners(PluginInfo.PLUGIN_NAME);
    },
    toolboxActions: {
        "Open Microphone Settings": openMicrophoneSettingsModal
    },
    micSettingsButton
});
