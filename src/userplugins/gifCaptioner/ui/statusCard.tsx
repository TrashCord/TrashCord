/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { showToast } from "@webpack/common";

let failTimer: ReturnType<typeof setTimeout> | null = null;

const FAILURE_TIMEOUT_MS = 60000;

function clearFailTimer() {
    if (!failTimer) return;
    clearTimeout(failTimer);
    failTimer = null;
}

function scheduleFailure(ms: number) {
    clearFailTimer();
    failTimer = setTimeout(() => {
        showToast({ text: "GIF processing timed out.", variant: "critical" });
        clearFailTimer();
    }, ms);
}

export function showCreating() {
    showToast({ text: "Creating GIF..." });
    scheduleFailure(FAILURE_TIMEOUT_MS);
}

export function showUploading() {
    showToast({ text: "Uploading GIF..." });
    scheduleFailure(FAILURE_TIMEOUT_MS);
}

export function showSent() {
    clearFailTimer();
    showToast({ text: "GIF sent.", variant: "success" });
}

export function showError(message: string) {
    clearFailTimer();
    showToast({ text: message || "Failed to create GIF.", variant: "critical" });
}

export function clearStatus() {
    clearFailTimer();
}
