/*
 * TrashCord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { PluginNative } from "@utils/types";

import { PLUGIN_NAME } from "./i18n";

/** Everything native.ts exports, so a helper left over from an older version counts as missing too. */
export const MAIN_PROCESS_METHODS = [
    "revealWindow",
    "hideRadarWindow",
    "showRadarWindow",
    "registerGlobalHotkey",
    "setBackgroundThrottling",
    "unregisterGlobalHotkey",
    "openLookupWindow"
];

function readHelper() {
    return (typeof VencordNative !== "undefined"
        ? (VencordNative.pluginHelpers as any)?.[PLUGIN_NAME]
        : undefined) as PluginNative<typeof import("./native")> | undefined;
}

export const Native = readHelper();

/** The desktop app hands this half over only on a full start, so after an install or an update a reload of the page still runs without it. */
export function needsFullRestart(): boolean {
    if (typeof IS_DISCORD_DESKTOP === "undefined" || !IS_DISCORD_DESKTOP) return false;

    const helper = readHelper() as any;
    return MAIN_PROCESS_METHODS.some(name => typeof helper?.[name] !== "function");
}
