/*
 * TrashCord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import * as Common from "@webpack/common";

import { reportBroken } from "./apiHealth";
import { T } from "./i18n";
import { toast, ToastVariant } from "./toast";

export interface ConfirmOptions {
    title: string;
    body: string;
    confirmText: string;
    cancelText: string;
    confirmColor?: string;
    onConfirm: () => void;
}

/** Asks inside the popped out radar when that window is in use, and says whether it did. */
let askInOwnWindow: ((options: ConfirmOptions) => boolean) | null = null;

export function setOwnWindowConfirm(ask: ((options: ConfirmOptions) => boolean) | null) {
    askInOwnWindow = ask;
}

export function confirmFirst(options: ConfirmOptions): boolean {
    // Discord draws its dialogs only in its main window, out of sight of the popped out radar.
    try {
        if (askInOwnWindow?.(options)) return true;
    } catch (error) {
        console.warn("[VoiceRadar-Discord] could not ask inside the radar window:", error);
    }

    try {
        const show = (Common as any).Alerts?.show;
        if (typeof show !== "function") throw new Error("Alerts.show is gone");

        show(options);
        return true;
    } catch (error) {
        console.warn("[VoiceRadar-Discord] could not show a confirmation:", error);
        reportBroken(T.apiConfirm);
        toast(T.confirmUnavailable, ToastVariant.FAILURE);
        return false;
    }
}
