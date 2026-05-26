/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vencord contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { OptionType } from "@utils/types";

export const settings = definePluginSettings({
    backend: {
        type: OptionType.SELECT,
        description: "Which backend to use for grammar correction",
        options: [
            { label: "LanguageTool (Free, no API key required)", value: "languagetool", default: true },
            { label: "Gemini AI (Better punctuation, requires API key)", value: "gemini" },
        ] as const,
    },
    language: {
        type: OptionType.STRING,
        description: "Language code for LanguageTool (e.g. en-US, de-DE). Use 'auto' to detect automatically (less strict). Only used when backend is LanguageTool.",
        default: "en-US",
    },
    apiKey: {
        type: OptionType.STRING,
        description: "Gemini API key (get one free at aistudio.google.com). Only used when backend is Gemini AI.",
        default: "",
    },
});