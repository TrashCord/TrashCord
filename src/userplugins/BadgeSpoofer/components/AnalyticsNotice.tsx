/*
 * TrashCord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Settings, useSettings } from "@api/Settings";
import { Notice } from "@components/Notice";
import { React, showToast } from "@webpack/common";

const PATH = ["plugins.NoTrack.disableAnalytics"] as any;

export function isAnalyticsBlocked(): boolean {
    return !!(Settings.plugins as any).NoTrack?.disableAnalytics;
}

export function warnIfBlocked(): boolean {
    if (!isAnalyticsBlocked()) return false;
    showToast({ text: "Block Discord Analytics is ON, badges will not progress. Turn it off and relaunch Discord.", variant: "critical" });
    return true;
}

export function AnalyticsNotice() {
    const blocked = !!(useSettings(PATH) as any).plugins?.NoTrack?.disableAnalytics;
    if (!blocked) return null;
    return (
        <Notice.Warning style={{ width: "100%" }}>
            "Block Discord Analytics" is ON in your TrashCord/Equicord/Illegalcord settings. Badge events are blocked and your badges will NOT progress. Turn it off, then relaunch Discord.
        </Notice.Warning>
    );
}
