/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

<<<<<<< HEAD
import type { MessageSendListener } from "@api/MessageEvents";
import { definePluginSettings } from "@api/Settings";
import { EquicordDevs } from "@utils/constants";
import { copyWithToast, getCurrentChannel, insertTextIntoChatInputBox, sendMessage } from "@utils/discord";
import { Logger } from "@utils/Logger";
import { sleep } from "@utils/misc";
import definePlugin, { makeRange, OptionType } from "@utils/types";
import type { Channel } from "@vencord/discord-types";
import { ChannelStore, ComponentDispatch, PermissionsBits, PermissionStore, Toasts, UserStore } from "@webpack/common";

import { splitMessage, type SplitMode } from "./splitMessage";

const MESSAGE_LIMIT = 2000;
const NITRO_MESSAGE_LIMIT = 4000;
const SLOWMODE_BUFFER_MS = 250;
const logger = new Logger("SplitLargeMessages");
const splitModes = new Set<SplitMode>(["characters", "spaces", "newlines"]);

const settings = definePluginSettings({
    sendDelay: {
        type: OptionType.SLIDER,
        description: "Minimum delay between each chunk in seconds.",
        markers: makeRange(0.5, 10, 0.5),
        default: 1,
        stickToMarkers: true,
    },
    splitMode: {
        type: OptionType.SELECT,
        description: "Prefer this boundary when splitting a message.",
        options: [
            { value: "newlines", label: "Newlines", default: true },
            { value: "spaces", label: "Spaces" },
            { value: "characters", label: "Strict character limit" },
        ],
    },
    splitInSlowmode: {
        type: OptionType.BOOLEAN,
        description: "Allow splitting in slowmode when its delay is within the configured maximum.",
        default: false,
    },
    slowmodeMax: {
        type: OptionType.SLIDER,
        description: "Maximum slowmode duration allowed when splitting messages.",
        markers: makeRange(1, 30, 1),
        default: 5,
        stickToMarkers: true,
    },
});

function getMessageLimit() {
    return UserStore.getCurrentUser()?.premiumType === 2 ? NITRO_MESSAGE_LIMIT : MESSAGE_LIMIT;
}

function getSplitMode(value: unknown): SplitMode {
    return typeof value === "string" && splitModes.has(value as SplitMode)
        ? value as SplitMode
        : "newlines";
}

function canBypassSlowmode(channel: Channel) {
    return PermissionStore.can(PermissionsBits.MANAGE_MESSAGES, channel)
        || PermissionStore.can(PermissionsBits.MANAGE_CHANNELS, channel);
}

function getSendDelay(channel: Channel) {
    const configuredDelay = settings.store.sendDelay * 1000;
    const slowmodeDelay = channel.rateLimitPerUser * 1000;

    return canBypassSlowmode(channel)
        ? configuredDelay
        : Math.max(configuredDelay, slowmodeDelay + SLOWMODE_BUFFER_MS);
}

function canSplitInChannel(channel: Channel | undefined) {
    if (!channel) return false;
    if (!channel.rateLimitPerUser || canBypassSlowmode(channel)) return true;

    return settings.store.splitInSlowmode
        && channel.rateLimitPerUser <= settings.store.slowmodeMax;
}

async function sendChunks(channelId: string, chunks: string[], delay: number) {
    let sent = 0;

    try {
        for (const [index, chunk] of chunks.entries()) {
            await sendMessage(channelId, { content: chunk }, true);
            sent++;

            if (index < chunks.length - 1) await sleep(delay);
        }
    } catch (error) {
        logger.error(`Failed after sending ${sent}/${chunks.length} message parts.`, error);
        return sent;
    }

    return sent;
}

function restoreUnsentContent(channelId: string, chunks: string[], sent: number) {
    const unsentContent = chunks.slice(sent).join("");
    if (!unsentContent) return;

    if (getCurrentChannel()?.id === channelId) {
        insertTextIntoChatInputBox(unsentContent);
    } else {
        copyWithToast(unsentContent, "Unsent message parts copied to clipboard.");
    }
}

const listener: MessageSendListener = async (channelId, message) => {
    const limit = getMessageLimit();
    if (message.content.length <= limit) return;

    const channel = ChannelStore.getChannel(channelId);
    if (!canSplitInChannel(channel)) {
        Toasts.show({
            message: "Cannot split this message because of the channel's slowmode.",
            id: "vc-splitLargeMessages-blocked",
            type: Toasts.Type.FAILURE,
        });
        return { cancel: true };
    }

    const chunks = splitMessage(message.content, limit, getSplitMode(settings.store.splitMode));
    ComponentDispatch.dispatchToLastSubscribed("CLEAR_TEXT");

    const sent = await sendChunks(channelId, chunks, getSendDelay(channel));
    if (sent !== chunks.length) {
        restoreUnsentContent(channelId, chunks, sent);
        Toasts.show({
            message: `Only ${sent}/${chunks.length} message parts were sent.`,
            id: "vc-splitLargeMessages-failure",
            type: Toasts.Type.FAILURE,
        });
    }

    return { cancel: true };
};

export default definePlugin({
    name: "SplitLargeMessages",
    description: "Splits oversized messages into Discord-sized chunks before sending.",
    dependencies: ["MessageEventsAPI"],
    tags: ["Chat", "Utility"],
    authors: [EquicordDevs.Reycko, EquicordDevs.justjxke],
    settings,
    onBeforeMessageSend: listener,

=======
import { MessageSendListener } from "@api/MessageEvents";
import { definePluginSettings } from "@api/Settings";
import { EquicordDevs } from "@utils/constants";
import { getCurrentChannel, sendMessage } from "@utils/discord";
import definePlugin, { OptionType } from "@utils/types";
import { ChannelStore, ComponentDispatch, PermissionsBits, UserStore } from "@webpack/common";

let maxLength: number = 0;

const canSplit: () => boolean = () => {
    const slowmode = getCurrentChannel()?.rateLimitPerUser ?? 0;
    return (settings.store.splitInSlowmode ? slowmode < settings.store.slowmodeMax : slowmode <= 0) && settings.store.disableFileConversion;
};

const autoMaxLength = () => {
    const hasNitro = UserStore.getCurrentUser()?.premiumType === 2;
    return hasNitro ? 4000 : 2000;
};

const split = async (channelId: string, chunks: string[], delayInMs: number) => {
    const sendChunk = async (chunk: string) => {
        await sendMessage(channelId, { content: chunk }, true);
    };

    // Send the chunks
    for (let i = 0; i < chunks.length; i++) {
        await sendChunk(chunks[i]);
        if (i < chunks.length - 1) // Not the last chunk
            await new Promise(resolve => setTimeout(resolve, delayInMs)); // Wait for `delayInMs`
    }
};

const listener: MessageSendListener = async (channelId, msg) => {
    if (msg.content.trim().length < maxLength || !canSplit()) return; // Nothing to split

    const channel = ChannelStore.getChannel(channelId);

    // Check for slowmode
    let isSlowmode = channel.rateLimitPerUser > 0;
    if ((channel.accessPermissions & PermissionsBits.MANAGE_MESSAGES) === PermissionsBits.MANAGE_MESSAGES
        || (channel.accessPermissions & PermissionsBits.MANAGE_CHANNELS) === PermissionsBits.MANAGE_CHANNELS)
        isSlowmode = false;

    // Not slowmode or splitInSlowmode is on and less than slowmodeMax
    if (!isSlowmode || (settings.store.splitInSlowmode && channel.rateLimitPerUser < settings.store.slowmodeMax)) {
        const chunks: string[] = [];
        const { hardSplit } = settings.store;
        while (msg.content.length > maxLength) {
            msg.content = msg.content.trim();

            // Get last space or newline
            const splitIndex = Math.max(msg.content.lastIndexOf(" ", maxLength), msg.content.lastIndexOf("\n", maxLength));

            // If hard split is on or neither newline or space found, split at maxLength
            if (hardSplit || splitIndex === -1) {
                chunks.push(msg.content.slice(0, maxLength));
                msg.content = msg.content.slice(maxLength);
            } else {
                chunks.push(msg.content.slice(0, splitIndex));
                msg.content = msg.content.slice(splitIndex);
            }
        }

        ComponentDispatch.dispatchToLastSubscribed("CLEAR_TEXT");
        await split(channelId, [...chunks, msg.content], settings.store.sendDelay * 1000);
    }
    return { cancel: true };
};

const settings = definePluginSettings({
    maxLength: {
        type: OptionType.NUMBER,
        description: "Maximum length of a message before it is split. Set to 0 to automatically detect.",
        default: 0,
        max: 4000,
        onChange(newValue) {
            if (newValue === 0)
                maxLength = autoMaxLength();
        },
    },
    disableFileConversion: {
        type: OptionType.BOOLEAN,
        description: "If true, disables file conversion for large messages.",
        default: true,
    },
    sendDelay: {
        type: OptionType.SLIDER,
        description: "Delay between each chunk in seconds.",
        default: 1,
        markers: [1, 2, 3, 5, 10],
    },
    hardSplit: {
        type: OptionType.BOOLEAN,
        description: "If true, splits on the last character instead of the last space/newline.",
        default: false,
    },
    splitInSlowmode: {
        type: OptionType.BOOLEAN,
        description: "Should messages be split if the channel has slowmode enabled?",
    },
    slowmodeMax: {
        type: OptionType.NUMBER,
        description: "Maximum slowmode time if splitting in slowmode.",
        default: 5,
        min: 1,
        max: 30,
    }
});

export default definePlugin({
    name: "SplitLargeMessages",
    description: "Splits large messages into multiple to fit Discord's message limit.",
    dependencies: ["MessageEventsAPI"],
    tags: ["Appearance", "Customisation", "Chat"],
    authors: [EquicordDevs.Reycko],
    settings,
    onBeforeMessageSend: listener,

    start() {
        if (settings.store.maxLength === 0) maxLength = autoMaxLength();
    },

>>>>>>> 89b0fd2a5 (Update index.tsx)
    patches: [
        {
            find: 'type:"MESSAGE_LENGTH_UPSELL"', // bypass message length check
            replacement: {
                match: /if\(\i.length>\i/,
                replace: "if(false",
<<<<<<< HEAD
            },
        },
=======
            }
        },

>>>>>>> 89b0fd2a5 (Update index.tsx)
        {
            find: ".onHideAutocomplete?", // disable file conversion
            replacement: {
                match: /(?<=getData\(\i\.type\);)if\(\i.length>\i\)/,
                replace: "if(false)",
            },
<<<<<<< HEAD
        },
    ],
=======
        }
    ]
>>>>>>> 89b0fd2a5 (Update index.tsx)
});
