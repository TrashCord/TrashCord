/*
 * TrashCord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { openModalLazy } from "@webpack/common";

import { MicrophoneSettingsModal } from "../../betterMicrophone.desktop/components";
import { PluginInfo } from "../../betterMicrophone.desktop/constants";
import Plugin from "../../betterMicrophone.desktop/index";
import { microphoneStore } from "../../betterMicrophone.desktop/stores";

const onMicrophoneModalDone = () => {
    const { microphonePatcher } = Plugin;

    if (microphonePatcher)
        microphonePatcher.forceUpdateTransportationOptions();
};

export const openMicrophoneSettingsModal =
    () => openModalLazy(async () => {
        return props =>
            <MicrophoneSettingsModal
                onDone={onMicrophoneModalDone}
                showInfo
                microphoneStore={microphoneStore}
                author={PluginInfo.AUTHOR}
                contributors={Object.values(PluginInfo.CONTRIBUTORS)}
                {...props} />;
    });
