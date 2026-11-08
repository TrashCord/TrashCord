/*
 * TrashCord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import definePlugin from "@utils/types";

let styleEl: HTMLStyleElement | null = null;

export default definePlugin({
    name: "HideFormFullscreen",
    description: "Hides the chat input during fullscreen DM calls",
    authors: [{ name: "zfrancesck1", id: 456195985404592149n }],
    tags: ["Appearance", "Utility"],
    enabledByDefault: false,
    start() {
        if (styleEl) return;
        styleEl = document.createElement("style");
        styleEl.id = "hff";
        styleEl.textContent = 'body:has([class*="fullScreen_"])[class*="form_"]{display:none!important;}';
        document.head.appendChild(styleEl);
    },
    stop() {
        styleEl?.remove();
        styleEl = null;
    }
});