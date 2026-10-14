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
        showToast("GIF processing timed out.", "failure");
        clearFailTimer();
    }, ms);
}

export function showCreating() {
    showToast("Creating GIF...", "message");
    scheduleFailure(FAILURE_TIMEOUT_MS);
}

export function showUploading() {
    showToast("Uploading GIF...", "message");
    scheduleFailure(FAILURE_TIMEOUT_MS);
}

export function showSent() {
    clearFailTimer();
    showToast("GIF sent.", "success");
}

export function showError(message: string) {
    clearFailTimer();
    showToast(message || "Failed to create GIF.", "failure");
}

export function clearStatus() {
    clearFailTimer();
}
