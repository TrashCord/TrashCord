/*
 * TrashCord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { collapsibleChannelListSettings } from "./ChannelList/CollapsibleChannelListSettings";

import { SettingsManager } from "../utils/SettingsManager";

export function initSettings() {
    const settingsManager = new SettingsManager("BetterUI");

    settingsManager.initialize(collapsibleChannelListSettings)
}