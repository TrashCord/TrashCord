/*
 * TrashCord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { defineConfig } from "vitest/config";
import * as path from "path";

export default defineConfig({
    test: {
        environment: "jsdom",
        globals: true,
        include: ["tests/**/*.test.ts"],
    },
    resolve: {
        alias: {
            "@plugin": path.resolve(__dirname, "."),
        },
    },
});
