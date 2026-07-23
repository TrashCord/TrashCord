/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import definePlugin, { OptionType } from "@utils/types";
import { findByPropsLazy } from "@webpack";
import { Menu, Toasts } from "@webpack/common";

// ─── Settings ─────────────────────────────────────────────────────────────────
const settings = definePluginSettings({
    protectedUsers: {
        type: OptionType.STRING,
        description: "User IDs to NEVER mute — comma separated. Example: 123456789012345678,987654321098765432",
        default: "",
        restartNeeded: false,
    },
    muteVolume: {
        type: OptionType.SLIDER,
        description: 'Volume to set when pressing "Mute All" (0 = silent, 20 = 20%, etc.)',
        default: 0,
        markers: [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100],
        stickToMarkers: false,
        restartNeeded: false,
    },
});

function getProtectedIds(): string[] {
    return settings.store.protectedUsers
        .split(",")
        .map((s: string) => s.trim())
        .filter(Boolean);
}

// ─── Volume-based local mute ──────────────────────────────────────────────────
// Using setLocalVolume(userId, n) to mute and setLocalVolume(userId, 100) to restore.
// This is the same mechanism Discord uses internally for user volume sliders.
const AudioConvert = findByPropsLazy("setLocalVolume", "setLocalPan");

// Store original volumes so we can restore them on unmute
const savedVolumes: Record<string, number> = {};

function localMute(userId: string) {
    try {
        const MediaEngineStore = findByPropsLazy("getLocalVolume");
        const current = MediaEngineStore.getLocalVolume(userId) ?? 100;
        const targetVolume = settings.store.muteVolume ?? 0;

        // Always remember the volume from BEFORE we touched it, even if it's
        // already at/below target. Only set it if we don't already have one
        // saved, so clicking "Mute All" twice in a row doesn't overwrite the
        // real original volume with the already-muted one.
        if (!(userId in savedVolumes)) {
            savedVolumes[userId] = current;
        }

        AudioConvert.setLocalVolume(userId, targetVolume);
        console.log(`[MuteMod] Muted ${userId} to ${targetVolume}% (was ${current}, remembering ${savedVolumes[userId]})`);
    } catch (e) {
        console.error("[MuteMod] localMute error:", e);
    }
}

function localUnmute(userId: string) {
    try {
        // Only restore users we actually have a memory of muting.
        // If we never touched this user (e.g. protected, or joined after
        // Mute All), leave their volume exactly as it is.
        if (!(userId in savedVolumes)) {
            console.log(`[MuteMod] Skipped ${userId} (no saved volume, never muted by us)`);
            return;
        }

        const restored = savedVolumes[userId];
        AudioConvert.setLocalVolume(userId, restored);
        delete savedVolumes[userId];
        console.log(`[MuteMod] Unmuted ${userId} (restored to ${restored})`);
    } catch (e) {
        console.error("[MuteMod] localUnmute error:", e);
    }
}

// ─── Voice state ──────────────────────────────────────────────────────────────
const VoiceStateStore = findByPropsLazy("getVoiceStatesForChannel", "getVoiceStateForUser");

function getVoiceUserIds(channelId: string): string[] {
    try {
        const raw = VoiceStateStore.getVoiceStatesForChannel(channelId);
        if (!raw) return [];
        if (Array.isArray(raw)) return raw.map((s: any) => s.userId).filter(Boolean);
        if (typeof (raw as any).values === "function")
            return [...(raw as any).values()].map((s: any) => s.userId).filter(Boolean);
        return Object.values(raw).map((s: any) => s.userId).filter(Boolean);
    } catch (e) {
        console.error("[MuteMod] getVoiceUserIds error:", e);
        return [];
    }
}

function toast(message: string, type: "success" | "failure" = "success") {
    Toasts.show({
        message,
        type: type === "success" ? Toasts.Type.SUCCESS : Toasts.Type.FAILURE,
        id: Toasts.genId(),
    });
}

// ─── Plugin ───────────────────────────────────────────────────────────────────
export default definePlugin({
    name: "MuteMod",
    description: "Right-click a voice channel to locally mute/unmute everyone. Protected users in settings are never muted.",
    authors: [{ name: "you", id: 0n }],
    tags: ["Voice", "Servers"],
    enabledByDefault: false,
    settings,
    contextMenus: {
        "channel-context"(children: any[], props: any) {
            const { channel, guild } = props ?? {};
            if (!guild) return;

            children.push(
                <Menu.MenuSeparator key="mutemod-sep" />,

                <Menu.MenuItem
                    key="mutemod-muteall"
                    id="mutemod-muteall"
                    label="🔇 Mute All"
                    action={() => {
                        const protected_ = getProtectedIds();
                        const ids = getVoiceUserIds(channel?.id)
                            .filter((uid: string) => !protected_.includes(uid));

                        if (ids.length === 0) {
                            toast("No users to mute in this channel.", "failure");
                            return;
                        }

                        ids.forEach(localMute);
                        const vol = settings.store.muteVolume ?? 0;
                        toast(`🔇 Muted ${ids.length} user${ids.length !== 1 ? "s" : ""} to ${vol}%`);
                    }}
                />,

                <Menu.MenuItem
                    key="mutemod-unmuteall"
                    id="mutemod-unmuteall"
                    label="🔊 Unmute All"
                    action={() => {
                        // Only restore users we actually have a memory of muting.
                        const ids = getVoiceUserIds(channel?.id)
                            .filter((uid: string) => uid in savedVolumes);

                        if (ids.length === 0) {
                            toast("No muted users to restore in this channel.", "failure");
                            return;
                        }

                        ids.forEach(localUnmute);
                        toast(`🔊 Restored ${ids.length} user${ids.length !== 1 ? "s" : ""} to their original volume`);
                    }}
                />,
            );
        },
    },
});
