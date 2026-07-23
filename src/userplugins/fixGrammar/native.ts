/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vencord contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { IpcMainInvokeEvent } from "electron";

const LANGUAGETOOL_API = "https://api.languagetool.org/v2/check";
const GEMINI_API_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent";

export async function checkGrammarLanguageTool(_: IpcMainInvokeEvent, text: string, language: string) {
    try {
        const res = await fetch(LANGUAGETOOL_API, {
            method: "POST",
            headers: {
                "Content-Type": "application/x-www-form-urlencoded",
            },
            body: new URLSearchParams({ text, language }),
        });

        return { status: res.status, data: await res.text() };
    } catch (e) {
        return { status: -1, data: String(e) };
    }
}

export async function checkGrammarGemini(_: IpcMainInvokeEvent, text: string, apiKey: string) {
    try {
        const res = await fetch(`${GEMINI_API_URL}?key=${apiKey}`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                contents: [{
                    parts: [{
                        text: `Fix the grammar and punctuation of the following Discord message. Preserve the casual tone and style. Do not add unnecessary formality. Return only the corrected message with absolutely nothing else, no explanations, no quotes:\n\n${text}`
                    }]
                }]
            }),
        });

        return { status: res.status, data: await res.text() };
    } catch (e) {
        return { status: -1, data: String(e) };
    }
}