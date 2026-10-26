/*
 * TrashCord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import definePlugin from "@utils/types";

import { ConvertChatBarButton } from "./components/ChatBarButton";
import { channelAttachMenuPatch, messageContextMenuPatch } from "./components/contextMenus";
import { ConvertIcon } from "./components/icons";
import { settings } from "./settings";
import managedStyle from "./styles.css?managed";
import { ffmpeg } from "./utils/converter";

export default definePlugin({
    name: "FileConverter",
    description: "Convert and compress videos, audio and GIFs right in Discord",
    authors: [{ name: "emily7305", id: 0n }, { name: "zfrancesck1", id: 456195985404592149n }],
    tags: ["Media", "Utility"],
    enabledByDefault: false,
    managedStyle,
    settings,
    chatBarButton: {
        icon: ConvertIcon,
        render: ConvertChatBarButton,
    },

    contextMenus: {
        "message": messageContextMenuPatch,
        "channel-attach": channelAttachMenuPatch,
    },

    stop() {
        // kill the worker so the wasm memory gets freed
        ffmpeg.dispose();
    },
});