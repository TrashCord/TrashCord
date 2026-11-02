/*
 * TrashCord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { EquicordDevs } from "@utils/constants";
import definePlugin from "@utils/types";
import { findAll } from "@webpack";

type SpringGlobals = { assign: (o: { skipAnimation: boolean }) => void };

const BLOCKED = ["/store", "/shop"];

let globals: SpringGlobals[] = [];
let current = false;
let origPush: History["pushState"] | null = null;
let origReplace: History["replaceState"] | null = null;

function setSkip(value: boolean) {
    if (current === value) return;
    current = value;
    for (const g of globals) g.assign({ skipAnimation: value });
}

function isBlocked(path: string) {
    for (const p of BLOCKED) if (path === p || path.startsWith(p + "/")) return true;
    return false;
}

function pathOf(url?: string | URL | null) {
    if (url == null) return location.pathname;
    try {
        return new URL(String(url), location.href).pathname;
    } catch {
        return location.pathname;
    }
}

function sync(path: string) {
    setSkip(!isBlocked(path));
}

function onPop() {
    sync(location.pathname);
}

export default definePlugin({
    name: "DisableAnimations",
    description: "Disables most of Discord's animations.",
    authors: [EquicordDevs.seth, { name: "zfrancesck1", id: 456195985404592149n }],
    tags: ["Appearance", "Accessibility", "Performance"],
    enabledByDefault: true,
    start() {
        globals = [...new Set(findAll(m => typeof m?.Globals?.assign === "function").map(m => m.Globals))];
        origPush = history.pushState;
        origReplace = history.replaceState;
        history.pushState = function (this: History, data: any, unused: string, url?: string | URL | null) {
            sync(pathOf(url));
            return origPush!.call(this, data, unused, url);
        };
        history.replaceState = function (this: History, data: any, unused: string, url?: string | URL | null) {
            sync(pathOf(url));
            return origReplace!.call(this, data, unused, url);
        };
        window.addEventListener("popstate", onPop);
        sync(location.pathname);
    },
    stop() {
        window.removeEventListener("popstate", onPop);
        if (origPush) history.pushState = origPush;
        if (origReplace) history.replaceState = origReplace;
        origPush = null;
        origReplace = null;
        setSkip(false);
        current = false;
        globals = [];
    }
});