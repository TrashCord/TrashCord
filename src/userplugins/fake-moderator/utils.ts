/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { showNotification } from "@api/Notifications";
import { saveFile } from "@utils/web";
import { Toasts } from "@webpack/common";

import { ACTIONS, DEFAULT_COLOR } from "./constants";
import { settings } from "./settings";
import { exportHistoryJson } from "./store";
import { FakeActionRecord } from "./types";

/** Normalise a stored/typed hex colour into `#rrggbb`, falling back to default. */
export function normaliseColor(input: string | undefined): string {
    const raw = (input ?? "").trim();
    if (!/^#?[0-9a-fA-F]{6}$/.test(raw)) return DEFAULT_COLOR;
    return raw.startsWith("#") ? raw : `#${raw}`;
}

/** Human-readable duration, e.g. 3600 -> "1 hour". */
export function formatDuration(seconds: number): string {
    if (seconds <= 0) return "permanent";

    const units: [number, string][] = [
        [7 * 24 * 60 * 60, "week"],
        [24 * 60 * 60, "day"],
        [60 * 60, "hour"],
        [60, "minute"],
        [1, "second"]
    ];

    for (const [size, name] of units) {
        if (seconds % size === 0 || seconds >= size) {
            const value = Math.round(seconds / size);
            return `${value} ${name}${value === 1 ? "" : "s"}`;
        }
    }
    return `${seconds} seconds`;
}

/** Build the one-line description shown in toasts/notifications/history. */
export function describeAction(record: FakeActionRecord): string {
    const meta = ACTIONS[record.type];
    const parts = [`${record.targetName} was ${meta.verb}`];
    if (record.duration) parts.push(`for ${formatDuration(record.duration)}`);
    if (record.reason) parts.push(`— ${record.reason}`);
    return parts.join(" ");
}

/**
 * Surface a finished fake action to the user via a toast and/or a coloured
 * notification, honouring the relevant settings. Purely presentational.
 */
export function notifyAction(record: FakeActionRecord) {
    const meta = ACTIONS[record.type];
    const text = describeAction(record);

    if (settings.store.showToast) {
        Toasts.show({
            id: Toasts.genId(),
            message: `${meta.emoji} ${text}`,
            type: Toasts.Type.SUCCESS,
            options: { position: Toasts.Position.BOTTOM }
        });
    }

    if (settings.store.showNotification) {
        showNotification({
            title: `${meta.emoji} ${meta.label} (local only)`,
            body: text,
            color: normaliseColor(settings.store.notificationColor),
            // Never persist to the global notification log; this is a fake event.
            noPersist: true
        });
    }
}

/** Lightweight toast for when a fake voice toggle (mute/deafen) is turned off. */
export function notifyVoiceOff(type: "mute" | "deafen", targetName: string) {
    if (!settings.store.showToast) return;
    const meta = ACTIONS[type];
    Toasts.show({
        id: Toasts.genId(),
        message: `${meta.emoji} ${targetName} is no longer ${meta.verb}`,
        type: Toasts.Type.MESSAGE,
        options: { position: Toasts.Position.BOTTOM }
    });
}

/** Trigger a browser download of the history as a timestamped JSON file. */
export function downloadHistory() {
    const json = exportHistoryJson();
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const file = new File([json], `fake-moderator-history-${stamp}.json`, {
        type: "application/json"
    });
    saveFile(file);
}
