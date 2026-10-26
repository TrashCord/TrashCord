/*
 * TrashCord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import definePlugin from "@utils/types";

import managedStyle from "./styles.css?managed";

export default definePlugin({
    name: "ToastFixStyle",
    description: "Wider toasts, max 2 lines",
    authors: [{ name: "zfrancesck1", id: 456195985404592149n }],
    tags: ["Utility", "Developers", "Appearance"],
    enabledByDefault: true,
    required: true,
    hidden: true,
    managedStyle
});