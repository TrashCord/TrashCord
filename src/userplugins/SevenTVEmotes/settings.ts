/*
* Vencord, a Discord client mod
* Copyright (c) 2026 Vendicated and contributors*
* SPDX-License-Identifier: GPL-3.0-or-later
*/

import { definePluginSettings } from "@api/Settings";
import { OptionType } from "@utils/types";



export const settings = definePluginSettings({
    globalEmoteSet: {
        type: OptionType.BOOLEAN,
        description: "Load the global emote set by default.",
        default: true,
    },
    emoteSetIds: {
        type: OptionType.STRING,
        description: "Comma separated list of 7TV emote set IDs to display."
    },
    animatedPickerEmotes: {
        type: OptionType.BOOLEAN,
        description: "Animate emotes in the emote picker. Possibly reduce CPU and GPU usage.",
        default: true,
    },
    animatedInspectorEmotes: {
        type: OptionType.BOOLEAN,
        description: "Animate emotes in the emote picker inspector.",
        default: true,
    },
    sendAnimatedEmotes: {
        type: OptionType.BOOLEAN,
        description: "Send animated emotes.",
        default: true,
    },
    sendAttachments: {
        type: OptionType.BOOLEAN,
        description: "Upload emotes as attachments instead of sending them as links.",
        defualt: false,
    },
    loadEmoteScale: {
        type: OptionType.SLIDER,
        description: "Emote scale used when loading emotes. Higher scales will use more data and might take longer to load.",
        markers: [1, 2, 3, 4],
        default: 3,
    },
    sendEmoteScale: {
        type: OptionType.SLIDER,
        description: "Emote scale used when sending emotes.",
        markers: [1, 2, 3, 4],
        default: 3,
    },
    avatarScale: {
        type: OptionType.SLIDER,
        description: "Avatar scale used for emote set icons. Higher scales will use more data and might take longer to load.",
        markers: [1, 2, 3, 4],
        default: 3,
    },
    staticImageFormat: {
        type: OptionType.SELECT,
        description: "Image format used for static emotes and avatars.",
        options: [
            { label: "WebP", value: "webp", default: true, },
            { label: "AVIF", value: "avif", },
            { label: "PNG", value: "png", },
        ],
    },
    animatedImageFormat: {
        type: OptionType.SELECT,
        description: "Image format used for animated emotes and avatars.",
        options: [
            { label: "WebP", value: "webp", default: true, },
            { label: "AVIF", value: "avif", },
            { label: "GIF", value: "gif", },
        ],
        restartNeeded: true,
    },
});
