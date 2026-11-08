/*
 * TrashCord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { plugins } from "@api/PluginManager";
import { openPluginModal } from "@components/settings";

import { PLUGIN_NAME, T } from "../i18n";
import { settings } from "../settings";
import { toast, ToastVariant } from "../toast";

export type SettingKey = keyof typeof settings.def;

const FIND_FOR_MS = 2000;
const FIND_STEP_MS = 50;
const FLASH_MS = 1800;

/** Opens the plugin's settings, scrolled to one of them when asked, and says so when Vencord cannot. */
export function openPluginSettings(focus?: SettingKey) {
    const plugin = plugins[PLUGIN_NAME];
    try {
        if (!plugin) throw new Error(`no plugin named ${PLUGIN_NAME}`);
        openPluginModal(plugin);
    } catch (error) {
        console.warn("[VoiceRadar-Discord] could not open the plugin settings:", error);
        toast(T.settingsUnavailable, ToastVariant.FAILURE);
        return;
    }

    const description = focus ? String((settings.def[focus] as { description?: string; }).description ?? "").trim() : "";
    if (description) showSetting(description, Date.now() + FIND_FOR_MS);
}

/** Vencord draws the settings a moment after the window opens, and names each one only by its description. */
function showSetting(description: string, until: number) {
    const section = findSection(description);
    if (!section) {
        if (Date.now() < until) setTimeout(() => showSetting(description, until), FIND_STEP_MS);
        return;
    }

    section.scrollIntoView({ block: "center", behavior: "smooth" });
    section.classList.add("vr-setting-flash");
    setTimeout(() => section.classList.remove("vr-setting-flash"), FLASH_MS);
}

function findSection(description: string): HTMLElement | null {
    for (const text of document.querySelectorAll(".vc-plugins-setting-description")) {
        if (text.textContent?.trim() === description) return text.closest<HTMLElement>(".vc-plugins-setting-section");
    }
    return null;
}
