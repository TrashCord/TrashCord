/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import definePlugin from "@utils/types";
import { lodash } from "@webpack/common";

const mergedStyles = new Set<HTMLStyleElement>();
const absorbed = new Set<HTMLLinkElement>();

function linkCss(el: Element) {
    if (!(el instanceof HTMLLinkElement) || el.rel !== "stylesheet" || absorbed.has(el) || el.onload != null || el.sheet == null || el.media) return null;
    try {
        let css = "";
        for (const rule of el.sheet.cssRules) {
            if (rule instanceof CSSImportRule) return null;
            css += rule.cssText + "\n";
        }
        return css;
    } catch {
        return null;
    }
}

function merge(run: [Element, string][]) {
    const style = document.createElement("style");
    style.textContent = run.map(([, text]) => text).join("");
    run[0][0].before(style);
    mergedStyles.add(style);

    for (const [el] of run) {
        if (el instanceof HTMLStyleElement) {
            mergedStyles.delete(el);
            el.remove();
        } else if (el instanceof HTMLLinkElement && el.sheet) {
            el.sheet.disabled = true;
            absorbed.add(el);
        }
    }
}

function compact() {
    let run: [Element, string][] = [];
    const flush = () => {
        if (run.length > 1) merge(run);
        run = [];
    };

    for (const el of [...document.head.children]) {
        if (el instanceof HTMLLinkElement && absorbed.has(el)) continue;
        const css = el instanceof HTMLStyleElement ? (mergedStyles.has(el) ? el.textContent : null) : linkCss(el);
        if (css != null) run.push([el, css]);
        else if (el instanceof HTMLStyleElement || el instanceof HTMLLinkElement && el.rel === "stylesheet") flush();
    }
    flush();
}

let idleId: number | undefined;
let scheduleCompact: ReturnType<typeof lodash.debounce<() => void>> | undefined;

function onLoad(e: Event) {
    if (e.target instanceof HTMLLinkElement && e.target.rel === "stylesheet") scheduleCompact?.();
}

export default definePlugin({
    name: "FastRender",
    description: "Tweak some things for a lighter Discord",
    authors: [{ name: "nobody", id: 0n }, { name: "zfrancesck1", id: 456195985404592149n }],
    tags: ["Performance", "Utility"],
    enabledByDefault: true,
    start() {
        scheduleCompact = lodash.debounce(() => {
            if (idleId !== undefined) cancelIdleCallback(idleId);
            idleId = requestIdleCallback(compact, { timeout: 5000 });
        }, 1000);
        document.addEventListener("load", onLoad, true);
        scheduleCompact();
    },

    stop() {
        scheduleCompact?.cancel();
        scheduleCompact = undefined;
        if (idleId !== undefined) cancelIdleCallback(idleId);
        document.removeEventListener("load", onLoad, true);
        for (const link of absorbed) if (link.sheet) link.sheet.disabled = false;
        for (const style of mergedStyles) style.remove();
        absorbed.clear();
        mergedStyles.clear();
    }
});