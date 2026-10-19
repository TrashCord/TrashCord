/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import definePlugin from "@utils/types";
import { Toasts } from "@webpack/common";

let origShow: any = null;

const compat = (a: any, b?: any, c?: any) => {
    if (typeof a === "string") {
        return {
            text: a,
            variant: b === "success" ? "success" : (b === "failure" || b === "critical") ? "critical" : "default",
            ...(c || {}),
        };
    }
    if (a && typeof a === "object" && "message" in a) {
        return {
            text: a.message,
            variant: a.type === "success" ? "success" : (a.type === "failure" || a.type === "critical") ? "critical" : "default",
            ...(a.options || {}),
        };
    }
    return a;
};

export default definePlugin({
    name: "ToastBackwardCompat",
    description: "Fixes toasts for older plugins",
    authors: [{ name: "zfrancesck1", id: 456195985404592149n }],
    enabledByDefault: true,
    required: true,
    hidden: true,

    start() {
        try {
            if (Toasts && Toasts.show && !origShow) {
                origShow = Toasts.show;
                Toasts.show = function (a: any, b?: any, c?: any) {
                    return origShow.call(this, compat(a, b, c));
                };
            }
        } catch {}
    },

    stop() {
        try {
            if (Toasts && origShow) {
                Toasts.show = origShow;
                origShow = null;
            }
        } catch {}
    }
});
