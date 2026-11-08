/*
 * TrashCord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { getPluginScale, settings } from "./settings";

const STYLE_ID = "vr-size";

const popouts = new Set<Document>();

const drawnIn = () => [document, ...popouts];

function writeSize(own: Document) {
    let style = own.getElementById(STYLE_ID);
    if (!style) {
        style = own.createElement("style");
        style.id = STYLE_ID;
        own.head.appendChild(style);
    }

    style.textContent = `:root { --vr-scale: ${getPluginScale()}; }`;
}

/** A style tag of its own, because Discord rewrites the style attribute of the root element. */
export function applyPluginSize() {
    drawnIn().forEach(writeSize);
}

export function setPluginSize(percent: number) {
    try {
        settings.store.sizePercent = percent;
    } finally {
        // The store takes the value before it saves, so a failed save still shows.
        applyPluginSize();
    }
}

export function clearPluginSize() {
    for (const own of drawnIn()) own.getElementById(STYLE_ID)?.remove();
}

/** The popped out radar is a document of its own, and the slider reaches it until it closes. */
export function sizePopout(own: Document): () => void {
    popouts.add(own);
    writeSize(own);
    return () => void popouts.delete(own);
}
