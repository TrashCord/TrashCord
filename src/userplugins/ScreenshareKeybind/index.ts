/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Devs } from "@utils/constants";
import definePlugin from "@utils/types";
import { ChannelStore, SelectedChannelStore } from "@webpack/common";
import { findByCodeLazy, findByPropsLazy } from "@webpack";

const getMediaEngine = findByPropsLazy("getMediaEngine");
const getDesktopSources = findByCodeLazy("desktop sources");
const startStream = findByCodeLazy('dispatch({type:"STREAM_START"');

export default definePlugin({
    name: "ScreenshareKeybind",
    description: "Adds a keybind to instantly screenshare",
    authors: [Devs.x2b],
    tags: ["Voice", "Shortcuts"],
    enabledByDefault: false,
    patches: [
        {
            find: "DISCONNECT_FROM_VOICE_CHANNEL]",
            replacement: {
                match: /\[\i\.\i\.DISCONNECT_FROM_VOICE_CHANNEL/,
                replace: "SHARE_ENTIRE_SCREEN:{onTrigger:$self.trigger,keyEvents:{keyUp:!1,keyDown:!0}},$&"
            },
        },
        {
            find: "keybindActionTypes()",
            replacement: {
                match: /=\[(\{value:\i\.\i\.UNASSIGNED)/,
                replace: "=[{value:'SHARE_ENTIRE_SCREEN',label:'Share Entire Screen'},$1"
            }
        }
    ],
    async trigger() {
        var selected = SelectedChannelStore.getVoiceChannelId();
        if (!selected) return;
        var channel = ChannelStore.getChannel(selected);
        var source = await getDesktopSources(getMediaEngine.getMediaEngine(), ["screen"], null);
        startStream(channel.guild_id, selected, {
            "pid": null,
            "sourceId": source.id,
            "sourceName": source.name,
            "audioSourceId": null,
            "sound": true,
            "previewDisabled": false
        });
    }
});





