/*
 * TrashCord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { Devs } from "@utils/constants";
import { openModal } from "@utils/modal";
import definePlugin, { OptionType } from "@utils/types";
import { Menu } from "@webpack/common";

import { QuoteModal } from "./components/QuoteModal";
import managedStyle from "./styles.css?managed";
import { QuoteAlignment, QuoteAuthorFormat, QuoteAvatarSize, QuoteFont, QuoteFontWeight, QuoteTextColor } from "./types";

export const settings = definePluginSettings({
    quoteFont: {
        type: OptionType.SELECT,
        description: "Font for the quote text (author name always uses M PLUS Rounded 1c).",
        options: [
            { label: "M PLUS Rounded 1c", value: QuoteFont.MPlusRounded, default: true },
            { label: "Open Sans", value: QuoteFont.OpenSans },
            { label: "Momo Signature", value: QuoteFont.MomoSignature },
            { label: "Lora", value: QuoteFont.Lora },
            { label: "Merriweather", value: QuoteFont.Merriweather }
        ]
    },
    fontWeight: {
        type: OptionType.SELECT,
        description: "Weight of the quote text.",
        options: [
            { label: "Light", value: QuoteFontWeight.Light, default: true },
            { label: "Regular", value: QuoteFontWeight.Regular },
            { label: "Semibold", value: QuoteFontWeight.Semibold },
            { label: "Bold", value: QuoteFontWeight.Bold }
        ]
    },
    alignment: {
        type: OptionType.SELECT,
        description: "Text alignment for the quote.",
        options: [
            { label: "Left", value: QuoteAlignment.Left },
            { label: "Center", value: QuoteAlignment.Center, default: true },
            { label: "Right", value: QuoteAlignment.Right }
        ]
    },
    textColor: {
        type: OptionType.SELECT,
        description: "Color of the quote text.",
        options: [
            { label: "White", value: QuoteTextColor.White, default: true },
            { label: "Off White", value: QuoteTextColor.OffWhite },
            { label: "Black", value: QuoteTextColor.Black }
        ]
    },
    authorFormat: {
        type: OptionType.SELECT,
        description: "Format used to display the author's name.",
        options: [
            { label: "Display name + username", value: QuoteAuthorFormat.Both, default: true },
            { label: "Display name only", value: QuoteAuthorFormat.NameOnly },
            { label: "Username only", value: QuoteAuthorFormat.UsernameOnly }
        ]
    },
    watermark: {
        type: OptionType.STRING,
        description: "Custom watermark text (max 32 characters).",
        default: "Made with Velocity"
    },
    grayscale: {
        type: OptionType.BOOLEAN,
        description: "Enable grayscale by default.",
        default: true,
        hidden: true
    },
    showAvatar: {
        type: OptionType.BOOLEAN,
        description: "Show the author's avatar.",
        default: true,
        hidden: true
    },
    avatarOnRight: {
        type: OptionType.BOOLEAN,
        description: "Place the avatar on the right side.",
        default: false,
        hidden: true
    },
    avatarSize: {
        type: OptionType.SELECT,
        description: "How much of the canvas the avatar occupies.",
        hidden: true,
        options: [
            { label: "Full", value: QuoteAvatarSize.Full, default: true },
            { label: "Large", value: QuoteAvatarSize.Large }
        ]
    },
    showQuotationMarks: {
        type: OptionType.BOOLEAN,
        description: "Add decorative quotation marks around the quote text.",
        default: false,
        hidden: true
    },
    showWatermark: {
        type: OptionType.BOOLEAN,
        description: "Show watermark by default.",
        default: false,
        hidden: true
    },
    saveAsGif: {
        type: OptionType.BOOLEAN,
        description: "Save as GIF by default.",
        default: false,
        hidden: true
    }
});

const QuoteIcon = ({ width = 24, height = 24, className }: { width?: number; height?: number; className?: string; }) => (
    <svg className={className} role="img" width={width} height={height} viewBox="0 0 24 24">
        <path fill="currentColor" d="M6 17h3l2-4V7H5v6h3l-2 4Zm8 0h3l2-4V7h-6v6h3l-2 4Z" />
    </svg>
);

export default definePlugin({
    name: "Quoter",
    description: "Adds the ability to create an inspirational quote image from a message.",
    authors: [Devs.RoScripter999],
    tags: ["Chat", "Fun", "Media", "Customisation"],
    enabledByDefault: false,
    managedStyle,
    settings,
    contextMenus: {
        "message": (children, { message }) => {
            if (!message.content) return;
            children.push(
                <Menu.MenuItem
                    id="vc-quote"
                    label="Quote"
                    icon={QuoteIcon}
                    action={() => openModal(props => <QuoteModal message={message} {...props} />)}
                />
            );
        }
    }
});
