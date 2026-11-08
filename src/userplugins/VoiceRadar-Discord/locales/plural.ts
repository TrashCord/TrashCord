/*
 * TrashCord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/** Separate from i18n, which imports the dictionaries back. */

export function pluralEn(count: number, one: string, other: string): string {
    return count === 1 ? one : other;
}

/** Russian has three forms, and 21 takes the form of 1 while 11 does not. */
const ruRules = (() => {
    try {
        return new Intl.PluralRules("ru-RU");
    } catch {
        return null;
    }
})();

export function pluralRu(count: number, one: string, few: string, many: string): string {
    const category = ruRules?.select(count) ?? selectRuManually(count);

    switch (category) {
        case "one": return one;
        case "few": return few;
        default: return many;
    }
}

function selectRuManually(count: number): "one" | "few" | "many" {
    const abs = Math.abs(Math.floor(count));
    const lastTwo = abs % 100;
    const last = abs % 10;

    if (lastTwo >= 11 && lastTwo <= 14) return "many";
    if (last === 1) return "one";
    if (last >= 2 && last <= 4) return "few";
    return "many";
}
