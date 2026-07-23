/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { OptionType } from "@utils/types";

import { SettingsPanel } from "./components/SettingsPanel";
import { DEFAULT_COLOR } from "./constants";
import { FakeActionRecord, FakeVoiceState } from "./types";

/**
 * All persisted configuration for the plugin. The per-action booleans gate the
 * context-menu entries; `history` is the CUSTOM-typed, auto-persisted log that
 * the store module reads/writes; `panel` mounts the management UI.
 */
export const settings = definePluginSettings({
    enableBan: {
        type: OptionType.BOOLEAN,
        description: "Show the Fake Ban action",
        default: true
    },
    enableKick: {
        type: OptionType.BOOLEAN,
        description: "Show the Fake Kick action",
        default: true
    },
    enableTimeout: {
        type: OptionType.BOOLEAN,
        description: "Show the Fake Timeout action",
        default: true
    },
    enableMute: {
        type: OptionType.BOOLEAN,
        description: "Show the Fake Mute checkbox",
        default: true
    },
    enableDeafen: {
        type: OptionType.BOOLEAN,
        description: "Show the Fake Deafen checkbox",
        default: true
    },
    enableWarn: {
        type: OptionType.BOOLEAN,
        description: "Show the Fake Warn action",
        default: true
    },
    showToast: {
        type: OptionType.BOOLEAN,
        description: "Show a confirmation toast after each fake action",
        default: true
    },
    showNotification: {
        type: OptionType.BOOLEAN,
        description: "Show a coloured notification after each fake action",
        default: true
    },
    notificationColor: {
        type: OptionType.STRING,
        description: "Hex colour used for the confirmation notification",
        default: DEFAULT_COLOR,
        isValid: (v: string) => /^#?[0-9a-fA-F]{6}$/.test(v.trim()) || "Must be a 6-digit hex colour, e.g. #5865f2"
    },
    // Auto-persisted, non-UI store for the fake action log. Managed by store.ts.
    history: {
        type: OptionType.CUSTOM,
        description: "Local-only log of fake actions",
        default: [] as FakeActionRecord[]
    },
    // Auto-persisted, non-UI store for the per-user fake mute/deafen checkbox state.
    voiceStates: {
        type: OptionType.CUSTOM,
        description: "Local-only fake mute/deafen state per user",
        default: {} as Record<string, FakeVoiceState>
    },
    // Mounts the management panel (toggles overview, colour, history table).
    panel: {
        type: OptionType.COMPONENT,
        component: SettingsPanel
    }
});
