/*
 * Vault, a Discord client mod
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { disableStyle, enableStyle } from "@api/Styles";
import definePlugin from "@utils/types";

import style from "./style.css?managed";

export default definePlugin({
    name: "VaultPerformance",
    description: "Lightens Discord for better performance: disables animations, transitions and expensive blur effects.",
    authors: [{ name: "eqen", id: 1483151471183921346n }],
    tags: ["Appearance", "Utility", "Performance"],
    enabledByDefault: false,
    start() {
        enableStyle(style);
    },
    stop() {
        disableStyle(style);
    }
});