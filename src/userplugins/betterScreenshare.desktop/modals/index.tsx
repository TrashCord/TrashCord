/*
 * TrashCord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { openModalLazy } from "@webpack/common";

import { ScreenshareSettingsModal } from "../../betterScreenshare.desktop/components";
import { PluginInfo } from "../../betterScreenshare.desktop/constants";
import Plugin from "../../betterScreenshare.desktop/index";
import { screenshareAudioStore, screenshareStore } from "../../betterScreenshare.desktop/stores";

const onScreenshareModalDone = () => {
    const { screenshareAudioPatcher, screensharePatcher } = Plugin;

    if (screensharePatcher) {
        screensharePatcher.forceUpdateTransportationOptions();
        if (screensharePatcher.hasActiveDesktopSource()) {
            screensharePatcher.forceUpdateDesktopEncodingOptions();
            screensharePatcher.forceUpdateDesktopSourceOptions();
        }
    }
    if (screenshareAudioPatcher)
        screenshareAudioPatcher.forceUpdateTransportationOptions();
};

const onScreenshareAudioModalDone = () => {
    const { screenshareAudioPatcher } = Plugin;

    if (screenshareAudioPatcher)
        screenshareAudioPatcher.forceUpdateTransportationOptions();
};

export const openScreenshareModal =
    () => openModalLazy(async () => {
        return props =>
            <ScreenshareSettingsModal
                onAudioDone={onScreenshareAudioModalDone}
                onDone={onScreenshareModalDone}
                screenshareStore={screenshareStore}
                screenshareAudioStore={screenshareAudioStore}
                author={PluginInfo.AUTHOR}
                contributors={Object.values(PluginInfo.CONTRIBUTORS)}
                {...props} />;
    });