/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import definePlugin from "@utils/types";
import { Toasts } from "@webpack/common";
import { Patch } from "@webpack/patcher";

let unpatch: (() => void) | null = null;

export default definePlugin({
    name: "ToastBackwardCompat",
    description: "Fixes toasts for older plugins",
    authors: [{ name: "zfrancesck1", id: 456195985404592149n }],
    tags: ["Utility", "Developers"],
    enabledByDefault: true,
    required: true,
    hidden: true,

    start() {
        try {
            unpatch = Patch.instead("ToastBackwardCompat", Toasts, "show", (_self, args, orig) => {
                const data = args[0];

                if (typeof data === "string") {
                    args[0] = {
                        text: data,
                        variant: args[1] === "success" ? "success" : (args[1] === "failure" || args[1] === "critical") ? "critical" : "default"
                    };
                } else if (data && typeof data === "object") {
                    if (data.message && !data.text) data.text = data.message;
                    if (data.type && !data.variant) {
                        data.variant = data.type === "success" ? "success" : (data.type === "failure" || data.type === "critical") ? "critical" : "default";
                    }
                }

                return orig(...args);
            });
        } catch { }
    },

    stop() {
        try {
            if (unpatch) {
                unpatch();
                unpatch = null;
            }
        } catch { }
    }
});
