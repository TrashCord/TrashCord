/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vencord contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { classNameFactory } from "@utils/css";
import { findByPropsLazy, findCssClassesLazy } from "@webpack";
import { DraftStore, DraftType } from "@webpack/common";

export const cl = classNameFactory("vc-fix-grammar-");

const DraftManager = findByPropsLazy("saveDraft", "clearDraft");
const ChannelTextAreaClasses = findCssClassesLazy("buttonContainer", "channelTextArea", "button");

export function getDraft(channelId: string) {
    return DraftStore.getDraft(channelId, DraftType.ChannelMessage) ?? "";
}

function getEditor(): HTMLElement | null {
    const root = ChannelTextAreaClasses?.channelTextArea
        ? document.querySelector(`.${ChannelTextAreaClasses.channelTextArea}`)
        : null;
    return (root?.querySelector("[contenteditable=\"true\"]") as HTMLElement | null) ?? null;
}

function getEditorPlainText() {
    window.getSelection()?.removeAllRanges();
    const editor = getEditor();
    return editor?.innerText?.trim() ?? "";
}

/** Prefer draft store; fall back to the live editor when the store lags behind typing. */
export function getChatInputText(channelId: string) {
    const draft = getDraft(channelId).trim();
    if (draft) return draft;
    return getEditorPlainText();
}

export function replaceChatInputBox(channelId: string, text: string) {
    // Clear the existing draft entirely, wait a frame for Discord to process
    // the clear and blank out the editor, then save the corrected text so
    // Discord re-populates the editor from the store with the new content.
    DraftManager.clearDraft(channelId, DraftType.ChannelMessage);

    requestAnimationFrame(() => {
        DraftManager.saveDraft(channelId, text, DraftType.ChannelMessage);
    });
}