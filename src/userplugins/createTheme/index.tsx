/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import managedStyle from "./components/createTheme.css?managed";

import { Devs } from "@utils/constants";
import definePlugin from "@utils/types";

export default definePlugin({
    name: "CreateTheme",
    description: "Create Theme UI — registered via settings.tsx",
    authors: [Devs.Ven],
    tags: ["Appearance", "Customisation"],
    enabledByDefault: false,
    managedStyle,
    required: false,
});