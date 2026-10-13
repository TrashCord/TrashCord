/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import definePlugin, { OptionType } from "@utils/types";
import { RestAPI } from "@webpack/common";

let obsCheckInterval: ReturnType<typeof setInterval> | null = null;
let obsWasRunning = false;

const settings = definePluginSettings({
    statusMessage: {
        type: OptionType.STRING,
        // Change this to whatever you want your status to say when you go live.
        description: "Status message to show when OBS is running (change it to whatever you want)",
        default: "🔴 Live on twitch.tv/tomperyeeter",
        restartNeeded: false,
    },
    emojiName: {
        type: OptionType.STRING,
        // Normal emoji: use its unicode name, e.g. red_circle -> 🔴
        // Custom emote (like :alert:): put the name WITHOUT colons, e.g. alert, and fill Emoji ID below.
        description: "Emoji name. Normal emoji: unicode name like red_circle. Custom emote: its name without colons (e.g. alert).",
        default: "red_circle",
        restartNeeded: false,
    },
    emojiId: {
        type: OptionType.STRING,
        // LEAVE BLANK for a normal/unicode emoji.
        // For a custom emote, put its ID here. Find it by typing \:emotename: in chat and sending it
        // -> you'll get <a:alert:750810249853796434>; the long number is the ID.
        // Custom emotes require Discord Nitro, and you must have access to the emote yourself.
        description: "Custom emote ID (leave BLANK for normal emojis). Requires Nitro + you must have that emote.",
        default: "",
        restartNeeded: false,
    },
    emojiAnimated: {
        type: OptionType.BOOLEAN,
        // ON if your custom emote is animated (the a: in <a:name:id>). Animated only animates for Nitro users.
        description: "Is your custom emote animated? (the a: in <a:name:id> means yes). Only used with a custom emote ID.",
        default: false,
        restartNeeded: false,
    },
    checkInterval: {
        type: OptionType.NUMBER,
        description: "How often to check if OBS is running (seconds)",
        default: 5,
        restartNeeded: true,
    },
    clearOnStop: {
        type: OptionType.BOOLEAN,
        description: "Clear your custom status when OBS stops",
        default: true,
        restartNeeded: false,
    },
    obsWebSocketPort: {
        type: OptionType.NUMBER,
        description: "OBS WebSocket port (OBS Studio 28+ default: 4455)",
        default: 4455,
        restartNeeded: false,
    },
});

async function setCustomStatus(active: boolean) {
    let customStatus = null;

    if (active) {
        const text = settings.store.statusMessage;
        const emojiName = settings.store.emojiName?.trim();
        const emojiId = settings.store.emojiId?.trim();

        customStatus = { text, expires_at: null } as any;

        if (emojiName) {
            customStatus.emoji_name = emojiName;
            // If an ID is provided, it's a custom server/Nitro emote -> send id + animated flag
            if (emojiId) {
                customStatus.emoji_id = emojiId;
                customStatus.emoji_animated = !!settings.store.emojiAnimated;
            }
        }
    }

    try {
        await RestAPI.patch({
            url: "/users/@me/settings",
            body: { custom_status: customStatus },
        });
        console.log("[OBSStatus] Status updated:", active ? settings.store.statusMessage : "(cleared)");
    } catch (e) {
        console.error("[OBSStatus] Failed to set status:", e);
    }
}

async function isOBSRunning(port: number): Promise<boolean> {
    return new Promise(resolve => {
        try {
            const ws = new WebSocket(`ws://127.0.0.1:${port}`);
            const timeout = setTimeout(() => {
                ws.close();
                resolve(false);
            }, 1500);

            ws.onopen = () => {
                clearTimeout(timeout);
                ws.close();
                resolve(true);
            };

            ws.onerror = () => {
                clearTimeout(timeout);
                resolve(false);
            };
        } catch {
            resolve(false);
        }
    });
}

async function checkOBS() {
    const port = settings.store.obsWebSocketPort;
    const running = await isOBSRunning(port);

    if (running && !obsWasRunning) {
        obsWasRunning = true;
        console.log("[OBSStatus] OBS detected! Setting status.");
        await setCustomStatus(true);
    } else if (!running && obsWasRunning) {
        obsWasRunning = false;
        console.log("[OBSStatus] OBS stopped.");
        if (settings.store.clearOnStop) {
            await setCustomStatus(false);
        }
    }
}

export default definePlugin({
    name: "OBSStatus",
    description: "Automatically updates your Discord custom status (with custom emote support) when OBS Studio is running",
    authors: [{ name: "tomper", id: 0n }],
    tags: ["Utility", "Chat"],
    enabledByDefault: false,
    settings,
    start() {
        const intervalMs = (settings.store.checkInterval ?? 5) * 1000;
        obsWasRunning = false;
        checkOBS();
        obsCheckInterval = setInterval(checkOBS, intervalMs);
        console.log(`[OBSStatus] Started. Checking every ${settings.store.checkInterval}s on port ${settings.store.obsWebSocketPort}`);
    },

    stop() {
        if (obsCheckInterval !== null) {
            clearInterval(obsCheckInterval);
            obsCheckInterval = null;
        }
        obsWasRunning = false;
        console.log("[OBSStatus] Stopped.");
    },
});
