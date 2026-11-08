/*
 * TrashCord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { getMyChannelId } from "./channels";
import { confirmFirst } from "./confirm";
import { T } from "./i18n";
import { shutdownSightings } from "./sightings";
import { shutdownStore } from "./store";
import { toast, ToastVariant } from "./toast";
import { shutdownWatchLog } from "./watchLog";

function relauncher(): (() => void) | null {
    const relaunch = (window as any).DiscordNative?.app?.relaunch;
    return typeof relaunch === "function" ? relaunch : null;
}

/** A relaunch ends the page without the plugin's usual stop, so what still waits on a timer is written first. */
async function restartNow() {
    const relaunch = relauncher();
    if (!relaunch) {
        toast(T.restartByHand, ToastVariant.FAILURE);
        return;
    }

    await Promise.allSettled([shutdownSightings(), shutdownWatchLog(), shutdownStore()]);
    relaunch();
}

export function askToRestartDiscord() {
    if (!getMyChannelId()) {
        void restartNow();
        return;
    }

    confirmFirst({
        title: T.restartConfirmTitle,
        body: T.restartConfirmBody,
        confirmText: T.restartConfirmButton,
        cancelText: T.cancel,
        onConfirm: () => void restartNow()
    });
}
