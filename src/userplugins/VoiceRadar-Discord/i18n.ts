/*
 * TrashCord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { PlainSettings } from "@api/Settings";
import { LocaleStore } from "@webpack/common";

import { en, type Messages } from "./locales/en";
import { ru } from "./locales/ru";

/** Must match the plugin name, since the settings are stored under it. */
export const PLUGIN_NAME = "VoiceRadar-Discord";

export const AUTO_LANGUAGE = "auto";
const FALLBACK_LOCALE = "en-US";

const dictionaries: Record<string, Messages> = {
    "en-US": en,
    ru
};

export const LANGUAGE_LABELS: Record<string, string> = {
    "en-US": "English",
    ru: "Русский"
};

export const LANGUAGE_CODES = Object.keys(dictionaries);

export const UNKNOWN_USER_LABELS: readonly string[] =
    Object.values(dictionaries).map(dictionary => dictionary.unknownUser);

function preferredLanguage(): string {
    try {
        return (PlainSettings as any).plugins?.[PLUGIN_NAME]?.language || AUTO_LANGUAGE;
    } catch {
        return AUTO_LANGUAGE;
    }
}

/** LocaleStore can still be undefined while the plugin's modules load. */
function discordLocale(): string {
    try {
        const fromStore = (LocaleStore as any)?.locale;
        if (fromStore) return fromStore;
    } catch {
    }

    try {
        const stored = window.localStorage?.getItem("locale");
        if (stored) return JSON.parse(stored);
    } catch {
    }

    return FALLBACK_LOCALE;
}

function resolveLocale(): string {
    const preferred = preferredLanguage();
    const wanted = preferred === AUTO_LANGUAGE ? discordLocale() : preferred;

    if (dictionaries[wanted]) return wanted;

    const base = String(wanted).split("-")[0];
    return LANGUAGE_CODES.find(code => code.split("-")[0] === base) ?? FALLBACK_LOCALE;
}

const LOCALE_CACHE_MS = 1000;
let cachedLocale = "";
let cachedAt = 0;

function activeDictionary(): Messages {
    const now = Date.now();

    if (now - cachedAt > LOCALE_CACHE_MS) {
        cachedLocale = resolveLocale();
        cachedAt = now;
    }

    return dictionaries[cachedLocale] ?? en;
}

/** Resolved on every access, because the language can change while Discord runs. */
export const T: Messages = new Proxy({} as Messages, {
    get(_target, key: string | symbol) {
        const active = activeDictionary();
        return (active as any)[key] ?? (en as any)[key];
    }
});
