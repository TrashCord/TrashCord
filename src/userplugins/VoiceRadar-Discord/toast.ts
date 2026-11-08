/*
 * TrashCord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// The whole module, so exports that Vencord removes do not break the build.
import * as Common from "@webpack/common";

import { proveWorking, reportBroken } from "./apiHealth";
import { T } from "./i18n";

export const ToastVariant = {
    MESSAGE: "message",
    SUCCESS: "success",
    FAILURE: "failure"
} as const;

export type ToastKind = typeof ToastVariant[keyof typeof ToastVariant];

const REPLACE_WINDOW_MS = 3500;

const VARIANTS: Record<ToastKind, string> = {
    message: "default",
    success: "success",
    failure: "critical"
};

let ourToastShownAt = 0;

/** Read through a computed key so the bundler does not chase a named export Vencord may not carry. */
function toastsModule(): any {
    const common = Common as any;
    return common[["Toast", "s"].join("")];
}

function showWithAnyApi(message: string, type: ToastKind) {
    const common = Common as any;
    const toasts = toastsModule();
    const makeToast = common[["create", "Toast"].join("")];

    if (typeof makeToast === "function" && typeof toasts?.show === "function") {
        toasts.show(makeToast({ message, type }));
        return;
    }

    if (typeof toasts?.create === "function" && typeof toasts?.show === "function") {
        toasts.show(toasts.create(message, type));
        return;
    }

    if (typeof common.showToast !== "function") {
        throw new Error("this Vencord has no toast API the plugin knows");
    }

    common.showToast({ text: message, variant: VARIANTS[type] });
}

function dismissOurLastToast() {
    try {
        const pop = toastsModule()?.pop;
        if (typeof pop === "function") pop();
    } catch {
    }
}

/** Shows the message inside the popped out radar when that window is in use, and says whether it did. */
let showInOwnWindow: ((message: string, type: ToastKind) => boolean) | null = null;

export function setOwnWindowToast(show: ((message: string, type: ToastKind) => boolean) | null) {
    showInOwnWindow = show;
}

export function toast(message: string, type: ToastKind = ToastVariant.MESSAGE) {
    // Discord shows its toasts only in its main window, out of sight of the popped out radar.
    try {
        if (showInOwnWindow?.(message, type)) return;
    } catch (error) {
        console.warn("[VoiceRadar-Discord] could not show a toast inside the radar window:", error);
    }

    if (Date.now() - ourToastShownAt < REPLACE_WINDOW_MS) dismissOurLastToast();

    ourToastShownAt = Date.now();

    try {
        showWithAnyApi(message, type);
        proveWorking(T.apiToasts);
    } catch (error) {
        console.warn("[VoiceRadar-Discord] could not show a toast:", message, error);

        reportBroken(T.apiToasts);
    }
}