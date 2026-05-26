/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vencord contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { PluginNative } from "@utils/types";

const Native = VencordNative.pluginHelpers.FixGrammar as PluginNative<typeof import("./native")>;

interface LanguageToolReplacement {
    value: string;
}

interface LanguageToolMatch {
    offset: number;
    length: number;
    message: string;
    replacements: LanguageToolReplacement[];
}

interface LanguageToolResponse {
    matches: LanguageToolMatch[];
}

function applyLanguageToolMatches(text: string, matches: LanguageToolMatch[]): string {
    const applicable = matches
        .filter(m => m.replacements.length > 0)
        .sort((a, b) => b.offset - a.offset);

    let result = text;
    for (const match of applicable) {
        result = result.slice(0, match.offset)
            + match.replacements[0].value
            + result.slice(match.offset + match.length);
    }
    return result;
}

export async function checkGrammarWithLanguageTool(text: string, language: string): Promise<string> {
    const { status, data } = await Native.checkGrammarLanguageTool(text, language);

    if (status === -1) {
        throw new Error(data || "Failed to reach LanguageTool");
    }

    if (status !== 200) {
        throw new Error(`LanguageTool API error (${status}): ${data.slice(0, 200)}`);
    }

    const parsed = JSON.parse(data) as LanguageToolResponse;
    return applyLanguageToolMatches(text, parsed.matches ?? []);
}

export async function checkGrammarWithGemini(text: string, apiKey: string): Promise<string> {
    const { status, data } = await Native.checkGrammarGemini(text, apiKey);

    if (status === -1) {
        throw new Error(data || "Failed to reach Gemini API");
    }

    if (status !== 200) {
        throw new Error(`Gemini API error (${status}): ${data.slice(0, 200)}`);
    }

    const parsed = JSON.parse(data);
    const corrected = parsed?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();

    if (!corrected) {
        throw new Error("No response from Gemini");
    }

    return corrected;
}