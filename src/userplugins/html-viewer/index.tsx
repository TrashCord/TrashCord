/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import managedStyle from "./styles.css?managed";

import definePlugin from "@utils/types";
import { ChannelStore } from "@webpack/common";

import { HtmlCard } from "./HtmlCard";
import { isHtmlAttachment } from "./detect";
import { settings } from "./settings";

export default definePlugin({
    name: "HtmlViewer",
    description: "Renders .html attachments inline in a locked sandbox (no network, no Discord access), with Open-in-browser for full fidelity.",
    authors: [{ name: "modda", id: 0n }],
    tags: ["Utility", "Chat"],
    enabledByDefault: false,
    managedStyle,
    dependencies: ["MessageAccessoriesAPI"],
    settings,
    // Suppress Discord's own render of the html attachment (the inline source
    // preview and the file chip) so only our card shows. We filter a COPY of the
    // attachments array at the top of the Message class's renderAttachments,
    // before Discord classifies the file — so it removes whatever native form
    // the html would take while leaving other attachments (images) intact.
    // message.attachments is untouched, so renderMessageAccessory still sees it.
    // Anchor from HideMedia; match from FakeNitro (both target this same module).
    patches: [
        {
            find: "this.renderAttachments(",
            replacement: {
                match: /renderAttachments\(\i\){.+?{attachments:(\i).+?;/,
                replace: (m, attachments) => `${m}${attachments}=$self.filterAttachments(${attachments});`
            }
        }
    ],

    filterAttachments(attachments: any[]) {
        if (!Array.isArray(attachments)) return attachments;
        return attachments.filter(att => !isHtmlAttachment(att));
    },

    renderMessageAccessory({ message }) {
        const artifacts = (message.attachments ?? []).filter(isHtmlAttachment);
        if (!artifacts.length) return null;

        const authorId = message.author?.id;
        const guildId = ChannelStore.getChannel(message.channel_id)?.guild_id;

        return (
            <>
                {artifacts.map((att: any) => (
                    <HtmlCard key={att.id} attachment={att} authorId={authorId} guildId={guildId} />
                ))}
            </>
        );
    }
});
