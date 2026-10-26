/*
 * TrashCord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { Logger } from "@utils/Logger";
import definePlugin, { OptionType } from "@utils/types";

const logger = new Logger("HasStrip");

const settings = definePluginSettings({
    logging: {
        type: OptionType.BOOLEAN,
        description: "Log removed rules to the console",
        default: false
    }
});

let raf = 0;
let totalRemoved = 0;
let processed = new WeakSet<CSSStyleSheet>();
const removedRules: Array<{ owner: CSSStyleSheet | CSSGroupingRule; index: number; text: string; }> = [];

function stripSheet(sheet: CSSStyleSheet): number {
    let removed = 0;
    try {
        const walk = (owner: CSSStyleSheet | CSSGroupingRule, rules: CSSRuleList) => {
            for (let i = rules.length - 1; i >= 0; i--) {
                const rule = rules[i];
                let selector: string | null = null;
                try { selector = "selectorText" in rule && typeof rule.selectorText === "string" ? rule.selectorText : null; } catch { }
                if (selector && selector.includes(":has(")) {
                    try {
                        const text = rule.cssText;
                        owner.deleteRule(i);
                        removedRules.push({ owner, index: i, text });
                        removed++;
                        continue;
                    } catch { }
                }
                let nested: CSSRuleList | null = null;
                try { nested = "cssRules" in rule ? (rule as CSSGroupingRule).cssRules : null; } catch { }
                if (nested && nested.length) walk(rule as CSSGroupingRule, nested);
            }
        };
        walk(sheet, sheet.cssRules);
    } catch { }
    return removed;
}

function scan() {
    raf = 0;
    let removed = 0;
    for (const sheet of Array.from(document.styleSheets)) {
        if (processed.has(sheet)) continue;
        processed.add(sheet);
        removed += stripSheet(sheet);
    }
    if (removed > 0) {
        totalRemoved += removed;
        if (settings.store.logging) logger.info(`Removed ${removed} :has() rules; total ${totalRemoved}`);
    }
}

function onLoad(e: Event) {
    if (!raf && e.target instanceof HTMLLinkElement) raf = requestAnimationFrame(scan);
}

export default definePlugin({
    name: "HasStrip",
    description: "Removes :has() stylesheet rules to reduce style recalculation cost, with visual tradeoffs.",
    authors: [{ name: "DavidHiFi", id: 0n }, { name: "zfrancesck1", id: 456195985404592149n }],
    tags: ["Performance", "Utility", "Appearance"],
    enabledByDefault: false,
    settings,
    start() {
        scan();
        document.addEventListener("load", onLoad, true);
    },
    stop() {
        document.removeEventListener("load", onLoad, true);
        if (raf) cancelAnimationFrame(raf);
        raf = 0;
        for (const { owner, index, text } of removedRules.reverse()) {
            try {
                owner.insertRule(text, Math.min(index, owner.cssRules.length));
            } catch (e) {
                if (settings.store.logging) logger.debug("Could not restore a stylesheet rule", e);
            }
        }
        removedRules.length = 0;
        processed = new WeakSet();
        totalRemoved = 0;
    }
});