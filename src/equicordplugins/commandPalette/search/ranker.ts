/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

<<<<<<< HEAD
import type { PaletteCommand } from "../api/types";
import { getAlias } from "../state/aliases";
import { frecencyScore } from "../state/frecency";
import { isPinned } from "../state/pins";

export function fuzzyScore(query: string, text: string): number {
    const q = query.toLowerCase().trim();
    const t = text.toLowerCase();
    if (!q || !t) return 0;

    if (t === q) return 1000;
    if (t.startsWith(q)) return 800 + Math.max(0, 60 - t.length);

    const wordIndex = t.indexOf(" " + q);
    if (wordIndex !== -1) return 650 - Math.min(wordIndex, 100);

    const subIndex = t.indexOf(q);
    if (subIndex !== -1) return 450 - Math.min(subIndex, 200);

    let ti = 0;
    let first = -1;
    for (const char of q) {
        ti = t.indexOf(char, ti);
        if (ti === -1) return 0;
        if (first === -1) first = ti;
        ti += 1;
    }
    const span = ti - first;
    const density = q.length / span;
    return 100 + Math.round(density * 100);
}

export interface RankedCommand {
    command: PaletteCommand;
    score: number;
}

export function rankCommands(query: string, commands: PaletteCommand[]): RankedCommand[] {
    const ranked: RankedCommand[] = [];

    for (const command of commands) {
        let score = fuzzyScore(query, command.title);

        const alias = getAlias(command.id);
        if (alias) score = Math.max(score, fuzzyScore(query, alias) * 1.3);

        for (const keyword of command.keywords ?? []) {
            score = Math.max(score, fuzzyScore(query, keyword) * 0.7);
        }
        if (command.subtitle) score = Math.max(score, fuzzyScore(query, command.subtitle) * 0.4);
        score = Math.max(score, fuzzyScore(query, command.section) * 0.3);

        if (score <= 0) continue;

        score += frecencyScore(command.id) * 8;
        if (isPinned(command.id)) score += 40;
        ranked.push({ command, score });
    }

    return ranked.sort((a, b) => b.score - a.score);
}

export function filterOptions(query: string, options: { label: string; value: string; }[], limit = 6) {
    const trimmed = query.trim();
    if (!trimmed) return options.slice(0, limit);

    return options
        .map(option => ({ option, score: fuzzyScore(trimmed, option.label) }))
        .filter(entry => entry.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, limit)
        .map(entry => entry.option);
=======
import { INTENT_HINTS, SEMANTIC_SYNONYMS } from "./semanticLexicon";

export interface RankItem {
    id: string;
    label: string;
    description?: string;
    keywords?: string[];
    recentRank?: number;
    pinned?: boolean;
    categoryWeight?: number;
}

export interface RankedItem {
    item: RankItem;
    score: number;
}

function tokenize(text: string): string[] {
    return text
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter(Boolean);
}

function acronym(text: string): string {
    return tokenize(text).map(token => token[0]).join("");
}

function semanticOverlap(tokens: string[], queryTokens: string[]): number {
    let score = 0;

    for (const token of queryTokens) {
        const synonyms = SEMANTIC_SYNONYMS[token] ?? [];
        if (synonyms.some(s => tokens.includes(s))) score += 18;
    }

    for (const hints of Object.values(INTENT_HINTS)) {
        const matches = hints.filter(h => queryTokens.includes(h) || tokens.includes(h)).length;
        if (matches >= 2) score += matches * 5;
    }

    return score;
}

export function rankItems(query: string, items: RankItem[], options?: { semantic?: boolean; }): RankedItem[] {
    const trimmed = query.trim().toLowerCase();
    if (!trimmed) {
        return items.map(item => ({ item, score: 0 }));
    }

    const queryTokens = tokenize(trimmed);

    const semanticEnabled = options?.semantic ?? true;

    const ranked = items.map(item => {
        const label = item.label.toLowerCase();
        const id = item.id.toLowerCase();
        const description = item.description?.toLowerCase() ?? "";
        const keywords = (item.keywords ?? []).map(k => k.toLowerCase());
        const allTokens = tokenize(`${label} ${description} ${keywords.join(" ")}`);

        let score = 0;

        if (label === trimmed) score += 250;
        else if (id === trimmed) score += 220;

        if (label.startsWith(trimmed)) score += 170;
        if (id.startsWith(trimmed)) score += 140;
        if (label.includes(trimmed)) score += 110;
        if (id.includes(trimmed)) score += 85;

        if (keywords.includes(trimmed)) score += 140;
        if (keywords.some(k => k.startsWith(trimmed))) score += 100;

        if (description.includes(trimmed)) score += 60;

        const labelAcronym = acronym(label);
        if (labelAcronym.length > 1 && labelAcronym.startsWith(trimmed)) score += 95;

        const exactTokenMatches = queryTokens.filter(token => allTokens.includes(token)).length;
        score += exactTokenMatches * 22;

        if (semanticEnabled) {
            score += semanticOverlap(allTokens, queryTokens);
        }

        if (item.pinned) score += 36;
        if (typeof item.recentRank === "number" && item.recentRank >= 0) {
            score += Math.max(0, 30 - item.recentRank * 4);
        }
        if (typeof item.categoryWeight === "number") score += item.categoryWeight;

        return { item, score };
    });

    return ranked.sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return a.item.label.localeCompare(b.item.label);
    });
>>>>>>> 89b0fd2a5 (Update index.tsx)
}
