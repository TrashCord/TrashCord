/*
 * TrashCord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { EquicordDevs } from "@utils/constants";
import definePlugin from "@utils/types";
import { findAll } from "@webpack";

let globals: any[] = [];

function setSkip(value: boolean) {
    for (const g of globals) g.assign({ skipAnimation: value });
}

export default definePlugin({
    name: "DisableAnimations",
    description: "Disables most of Discord's animations.",
    authors: [EquicordDevs.seth, { id: 456195985404592149n, name: "zfrancesck1" }],
    tags: ["Appearance", "Accessibility", "Performance"],
    enabledByDefault: true,
    start() {
        globals = findAll(m => typeof m?.Globals?.assign === "function" && typeof m.Springs === "object").map(m => m.Globals);
        setSkip(true);
    },
    stop() {
        setSkip(false);
        globals = [];
    }
});