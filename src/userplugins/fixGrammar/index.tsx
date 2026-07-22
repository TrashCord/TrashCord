/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vencord contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import managedStyle from "./styles.css?managed";

import definePlugin from "@utils/types";

import { FixGrammarChatBarIcon, FixGrammarIcon } from "./FixGrammarIcon";
import { settings } from "./settings";

export default definePlugin({
    name: "FixGrammar",
    description: "Adds a chat bar button to fix grammar in your message using LanguageTool or Gemini AI.",
    authors: [{ name: "tiranyasu", id: 362745133634158592n }],
    tags: ["Chat", "Utility"],
    enabledByDefault: false,
    managedStyle,
    settings,

    chatBarButton: {
        icon: FixGrammarIcon,
        render: FixGrammarChatBarIcon,
    },
});