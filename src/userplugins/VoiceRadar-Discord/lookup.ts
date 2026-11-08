/*
 * TrashCord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { type ApiHealth, HealthReport, isFn } from "./apiHealth";
import { T } from "./i18n";
import { Native, needsFullRestart } from "./mainProcess";
import { DEFAULT_LOOKUP_URL, settings } from "./settings";
import { toast, ToastVariant } from "./toast";

/** The first default, which the site read as a username and so showed somebody else. */
const BROKEN_DEFAULT_URL = "https://discord-sensor.com/users/{id}";

export function migrateLookupUrl() {
    if (settings.store.lookupUrl === BROKEN_DEFAULT_URL) settings.store.lookupUrl = DEFAULT_LOOKUP_URL;
}

/** The window lives in Vencord's main process helper, and a helper still waiting for a full restart is not a break. */
export function lookupProblems(): ApiHealth {
    return new HealthReport().nice(() => needsFullRestart() || isFn(Native?.openLookupWindow), T.apiLookupWindow);
}

export interface LookupLink {
    url: string;
    host: string;
}

/** The page for this person on the site from the settings, or null when there is no usable address. */
export function lookupLink(userId: string, template = String(settings.store.lookupUrl ?? "")): LookupLink | null {
    const trimmed = template.trim();
    if (!trimmed.includes("{id}") || !/^\d+$/.test(userId)) return null;

    let url: URL;
    try {
        url = new URL(trimmed.replaceAll("{id}", userId));
    } catch {
        return null;
    }

    if (url.protocol !== "https:") return null;
    return { url: url.href, host: url.hostname.replace(/^www\./, "") };
}

function openInBrowser(url: string) {
    try {
        VencordNative.native.openExternal(url);
    } catch (error) {
        console.warn("[VoiceRadar-Discord] could not open the lookup page:", error);
        toast(T.lookupFailed, ToastVariant.FAILURE);
    }
}

/** Opens the page in the plugin's own window inside Discord, or in the browser until Discord has been fully restarted. */
export function openLookup(userId: string) {
    const link = lookupLink(userId);
    if (!link) return;

    const inApp = Native?.openLookupWindow;
    if (typeof inApp !== "function") {
        toast(T.lookupNeedsRestart, ToastVariant.MESSAGE);
        openInBrowser(link.url);
        return;
    }

    void inApp(link.url, link.host)
        .then(opened => {
            if (!opened) openInBrowser(link.url);
        })
        .catch(() => openInBrowser(link.url));
}
