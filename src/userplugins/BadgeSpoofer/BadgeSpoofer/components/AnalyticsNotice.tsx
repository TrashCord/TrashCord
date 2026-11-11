/*
 * TrashCord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Settings, useSettings } from "@api/Settings";
import { Notice } from "@components/Notice";
import { React, SelectedChannelStore, showToast } from "@webpack/common";

const PATH = ["plugins.NoTrack.disableAnalytics"] as any;

export function preflight(streamHours: number): boolean {
    if (streamHours > 0 && !(SelectedChannelStore as any).getVoiceChannelId?.()) {
        showToast({ text: "You are not in a voice channel. Join one or set stream hours to 0.", variant: "critical" });
        return false;
    }
    if ((Settings.plugins as any).NoTrack?.disableAnalytics)
        showToast({ text: "Block Discord Analytics is ON. If your badges do not move, turn it off and relaunch Discord." });
    return true;
}

export function AnalyticsNotice() {
    const blocked = !!(useSettings(PATH) as any).plugins?.NoTrack?.disableAnalytics;
    if (!blocked) return null;
    return (
        <Notice.Warning style={{ width: "100%" }}>
            "Block Discord Analytics" is ON in your TrashCord/Equicord/Illegalcord settings. Your badges may not progress. If they do not move, turn it off, then relaunch Discord.
        </Notice.Warning>
    );
}
