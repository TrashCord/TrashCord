/*
 * TrashCord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Devs } from "@utils/constants";
import definePlugin from "@utils/types";

const plugin = definePlugin({
    name: "PhilsPluginLibrary",
    description: "A library for phil's plugins",
    tags: ["Utility", "Voice", "Developers"],
    enabledByDefault: true,
    authors: [Devs.phil]
});

export default plugin;

export * from "./components";
export * from "./discordModules";
export * from "./emitter";
export * from "./icons";
export * from "./patchers";
export * from "./patches";
export * from "./store";
export * as types from "./types";
export * from "./utils";
