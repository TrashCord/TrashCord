/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vencord contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ChatBarButton, ChatBarButtonFactory } from "@api/ChatButtons";
import { classes } from "@utils/misc";
import { IconComponent } from "@utils/types";
import { showToast, Toasts, useRef, useState } from "@webpack/common";

import { checkGrammarWithGemini, checkGrammarWithLanguageTool } from "./api";
import { settings } from "./settings";
import { cl, getChatInputText, replaceChatInputBox } from "./utils";

export const FixGrammarIcon: IconComponent = ({ height = 26, width = 26, className }) => (
    <svg
        viewBox="0 0 24 24"
        height={height}
        width={width}
        className={className}
        fill="currentColor"
    >
        {/* Large "A" on the left */}
        <path d="M3 17L7.5 5h1.5L13 17h-1.6l-1.1-3.2H5.7L4.6 17H3zm3.2-4.6h3.6L8 7.4 6.2 12.4z" />
        {/* Small "a" on the right */}
        <path d="M19.1 17c-.1-.2-.2-.6-.2-1-.6.7-1.3 1.1-2.2 1.1-1.6 0-2.5-.9-2.5-2.1 0-1.5 1.2-2.3 3.4-2.3h1.2v-.6c0-.7-.4-1.2-1.3-1.2-.8 0-1.2.4-1.3.9h-1.4c.1-1.2 1.1-2 2.8-2 1.6 0 2.6.8 2.6 2.2V15.7c0 .5.1 1 .3 1.3H19.1zm-.4-3.3h-1.1c-1.3 0-2 .4-2 1.2 0 .6.5 1 1.2 1 1.1 0 1.9-.7 1.9-1.8v-.4z" />
    </svg>
);

export const FixGrammarChatBarIcon: ChatBarButtonFactory = ({ isMainChat, channel: { id: channelId } }) => {
    const [loading, setLoading] = useState(false);
    const loadingRef = useRef(false);

    if (!isMainChat) return null;

    return (
        <ChatBarButton
            tooltip={loading ? "Fixing grammar..." : "Fix Grammar"}
            onClick={async () => {
                if (loadingRef.current) return;

                const { backend, language, apiKey } = settings.store;

                if (backend === "gemini" && !apiKey) {
                    showToast("Please set your Gemini API key in the FixGrammar plugin settings", Toasts.Type.FAILURE);
                    return;
                }

                const text = getChatInputText(channelId);
                if (!text) {
                    showToast("Nothing to fix", Toasts.Type.MESSAGE);
                    return;
                }

                loadingRef.current = true;
                setLoading(true);
                try {
                    const corrected = backend === "gemini"
                        ? await checkGrammarWithGemini(text, apiKey)
                        : await checkGrammarWithLanguageTool(text, language);

                    if (corrected === text) {
                        showToast("No issues found!", Toasts.Type.MESSAGE);
                        return;
                    }

                    replaceChatInputBox(channelId, corrected);
                    showToast("Grammar fixed!", Toasts.Type.SUCCESS);
                } catch (e) {
                    showToast(
                        e instanceof Error ? e.message : "Failed to check grammar",
                        Toasts.Type.FAILURE
                    );
                } finally {
                    loadingRef.current = false;
                    setLoading(false);
                }
            }}
        >
            <FixGrammarIcon className={classes(cl("chat-button"), loading && cl("chat-button-loading"))} />
        </ChatBarButton>
    );
};