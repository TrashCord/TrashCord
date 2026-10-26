/*
 * TrashCord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { OptionType } from "@utils/types";

export const settings = definePluginSettings({
    backendUrl: {
        type: OptionType.STRING,
        description: "AI VTuber backend WebSocket URL",
        default: "ws://127.0.0.1:8000/api/ws/discord",
    },
    autoConnect: {
        type: OptionType.BOOLEAN,
        description: "Auto-connect to backend on plugin start",
        default: true,
    },
    showStatusIndicator: {
        type: OptionType.BOOLEAN,
        description: "Show connection status in chat input area",
        default: true,
    },
    forwardMessages: {
        type: OptionType.BOOLEAN,
        description: "Forward incoming Discord messages to AI",
        default: true,
    },
    forwardVoiceState: {
        type: OptionType.BOOLEAN,
        description: "Forward voice state changes to AI",
        default: true,
    },
    forwardTyping: {
        type: OptionType.BOOLEAN,
        description: "Forward typing indicators to AI",
        default: false,
    },
    commandPrefix: {
        type: OptionType.STRING,
        description: "Prefix for direct AI commands (e.g. !ai join <channel_id>)",
        default: "!ai",
    },
    autoReply: {
        type: OptionType.BOOLEAN,
        description: "AI automatically replies to messages in watched channels",
        default: true,
    },
    watchedChannels: {
        type: OptionType.STRING,
        description: "Comma-separated channel IDs to watch (empty = all)",
        default: "",
    },
    ignoredUsers: {
        type: OptionType.STRING,
        description: "Comma-separated user IDs to ignore",
        default: "",
    },
});
