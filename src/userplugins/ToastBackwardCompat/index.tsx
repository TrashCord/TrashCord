/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import definePlugin from "@utils/types";
import { findByProps } from "@webpack";

let originalShowToast: any = null;
let originalToastsShow: any = null;

const compat = (a: any, b?: any, c?: any) => {
    if (typeof a === "string") {
        return {
            text: a,
            variant: b === "success" ? "success" : (b === "failure" || b === "critical") ? "critical" : "default",
            ...c,
        };
    }
    return a;
};

export default definePlugin({
    name: "ToastBackwardCompat",
    description: "Backward compatibility for showToast",
    authors: [{ name: "zfrancesck1", id: 456195985404592149n }],
    tags: ["Utility", "Developers"],
    enabledByDefault: true,
    required: true,
    hidden: true,

    start() {
        try {
            const m = findByProps("showToast", "Toasts");
            if (!m) return;

            if (m.Toasts && !originalToastsShow) {
                originalToastsShow = m.Toasts.show;
                m.Toasts.show = function (a: any, b?: any, c?: any) {
                    return originalToastsShow.call(this, compat(a, b, c));
                };
            }

            if (m.showToast && !originalShowToast) {
                originalShowToast = m.showToast;
                m.showToast = function (a: any, b?: any, c?: any) {
                    return originalShowToast.call(this, compat(a, b, c));
                };
            }
        } catch {}
    },

    stop() {
        try {
            const m = findByProps("showToast", "Toasts");
            if (!m) return;

            if (originalToastsShow) {
                m.Toasts.show = originalToastsShow;
                originalToastsShow = null;
            }

            if (originalShowToast) {
                m.showToast = originalShowToast;
                originalShowToast = null;
            }
        } catch {}
    }
});