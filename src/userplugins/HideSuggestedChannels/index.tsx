/*
 * TrashCord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { FluxDispatcher } from "@webpack/common";
import definePlugin from "@utils/types";

const HEADER_RE = /^(Suggested|Vorgeschlagen|Suggéré|Suggérés|Sugerido|Sugeridos|Suggeriti|Consigliati|Foreslået|Foreslått|Föreslagna|Ehdotetut|Voorgesteld|Sugerowane|Sugerate|Navrhované|Javasolt|Predloženo|Siūlomi|Disarankan|Önerilen|Προτεινόμενα|Предложени|Рекомендуемые|Предлагаемые|Рекомендовані|Được đề xuất|แนะนำ|おすすめ|추천|推荐|建议|推薦|建議|सुझाए गए)$/i;
const EVENTS = ["CHANNEL_SELECT", "GUILD_SELECT", "CONNECTION_OPEN"];
const dismissed = new WeakSet<Element>();
let raf = 0;

function dismissSuggested() {
    raf = 0;
    const scope = document.querySelector('ul[aria-label="Channels"]') ?? document.querySelector("nav");
    if (!scope) return;

    for (const h of scope.querySelectorAll("h3")) {
        if (!HEADER_RE.test(h.textContent?.trim() ?? "")) continue;

        const item = h.closest("li");
        if (!item || dismissed.has(item)) continue;

        const btn = item.querySelector<HTMLElement>('[role="button"]');
        if (btn) {
            dismissed.add(item);
            btn.click();
        }
    }
}

function schedule() {
    if (!raf) raf = requestAnimationFrame(() => requestAnimationFrame(dismissSuggested));
}

export default definePlugin({
    name: "HideSuggestedChannels",
    description: "Automatically dismisses the \"Suggested\" channels section",
    authors: [{ name: "Aviv", id: 0n }, { name: "zfrancesck1", id: 456195985404592149n }],
    tags: ["Servers", "Utility", "Appearance"],
    enabledByDefault: false,

    start() {
        for (const e of EVENTS) FluxDispatcher.subscribe(e, schedule);
        schedule();
    },

    stop() {
        for (const e of EVENTS) FluxDispatcher.unsubscribe(e, schedule);
        if (raf) cancelAnimationFrame(raf);
        raf = 0;
    },
});