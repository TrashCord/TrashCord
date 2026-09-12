/*
 * Equicord, a Discord client mod
 * Copyright (c) 2026 Equicord Contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import definePlugin, { OptionType } from "@utils/types";
import { findByProps } from "@webpack";
import { Button, ChannelStore, Forms, Toasts, useEffect, useState } from "@webpack/common";

const CHANNEL_TYPE_DM = 1;
const CHANNEL_TYPE_GROUP_DM = 3;

const TARGET_ALL = "all";
const TARGET_DMS = "dms";
const TARGET_GROUPS = "groups";

let isRunning = false;
const runningListeners = new Set<(v: boolean) => void>();

function setRunning(v: boolean) {
    isRunning = v;
    runningListeners.forEach(fn => fn(v));
}

function useIsRunning() {
    const [val, setVal] = useState(isRunning);
    useEffect(() => {
        runningListeners.add(setVal);
        return () => void runningListeners.delete(setVal);
    }, []);
    return val;
}

const settings = definePluginSettings({
    target: {
        type: OptionType.SELECT,
        description: "Which DMs this plugin should affect",
        options: [
            { label: "All DMs (1:1 + group)", value: TARGET_ALL, default: true },
            { label: "1:1 DMs only", value: TARGET_DMS },
            { label: "Group DMs only", value: TARGET_GROUPS },
        ],
    },
    duration: {
        type: OptionType.SELECT,
        description: "How long the mute lasts when you press Mute All",
        options: [
            { label: "15 minutes", value: 900 },
            { label: "1 hour", value: 3600 },
            { label: "3 hours", value: 10800 },
            { label: "8 hours", value: 28800 },
            { label: "24 hours", value: 86400 },
            { label: "Until I turn it back on", value: -1, default: true },
        ],
    },
});

function getUpdateGuildNotificationSettings(): ((guildId: string, settings: Record<string, unknown>) => Promise<void>) | undefined {
    return findByProps("updateGuildNotificationSettings")?.updateGuildNotificationSettings;
}

function buildOverride(muted: boolean): Record<string, unknown> {
    return {
        muted,
        mute_config: muted ? { selected_time_window: settings.store.duration, end_time: null } : null,
    };
}

function targetLabel(): string {
    const t = settings.store.target;
    if (t === TARGET_DMS) return "1:1 DMs";
    if (t === TARGET_GROUPS) return "group DMs";
    return "DMs";
}

function getTargetChannelIds(): string[] {
    const t = settings.store.target;
    return ChannelStore.getSortedPrivateChannels()
        .filter(c => {
            if (t === TARGET_DMS) return c.type === CHANNEL_TYPE_DM;
            if (t === TARGET_GROUPS) return c.type === CHANNEL_TYPE_GROUP_DM;
            return c.type === CHANNEL_TYPE_DM || c.type === CHANNEL_TYPE_GROUP_DM;
        })
        .map(c => c.id);
}

async function applyMute(muted: boolean): Promise<void> {
    if (isRunning) return;
    setRunning(true);

    const update = getUpdateGuildNotificationSettings();
    if (!update) {
        setRunning(false);
        Toasts.show({
            message: "Could not find the internal update function.",
            type: Toasts.Type.FAILURE,
            id: Toasts.genId(),
        });
        return;
    }

    const ids = getTargetChannelIds();
    const field = buildOverride(muted);
    const channelOverrides: Record<string, unknown> = {};
    for (const id of ids) channelOverrides[id] = field;

    try {
        await update("@me", { channel_overrides: channelOverrides });
        setRunning(false);
        Toasts.show({
            message: `${muted ? "Muted" : "Unmuted"} ${ids.length} ${targetLabel()}.`,
            type: Toasts.Type.SUCCESS,
            id: Toasts.genId(),
        });
    } catch (e) {
        setRunning(false);
        const errMsg = e instanceof Error ? e.message : String(e);
        Toasts.show({
            message: `Failed to apply (${errMsg}).`,
            type: Toasts.Type.FAILURE,
            id: Toasts.genId(),
        });
    }
}

export default definePlugin({
    name: "AutoDMnotifications",
    description: "Mute or unmute notifications for all your DMs (not servers) in one click, targeting 1:1 DMs, group DMs, or both.",
    authors: [{ name: "zfrancesck1", id: 456195985404592149n }],
    tags: ["DM", "Notifications", "Mute", "Private", "Auto"],
    enabledByDefault: false,
    settings,

    settingsAboutComponent() {
        const running = useIsRunning();
        return (
            <Forms.FormSection>
                <Forms.FormText style={{ marginBottom: 8 }}>
                    Choose which DMs to target and, for muting, how long, using the settings below.
                    Then press one of the buttons to apply it instantly to every matching DM.
                </Forms.FormText>
                <Forms.FormText style={{ marginBottom: 8, opacity: 0.8 }}>
                    {running ? "Applying…" : "Ready."}
                </Forms.FormText>
                <div style={{ display: "flex", gap: 8 }}>
                    <Button
                        color={Button.Colors.BRAND}
                        size={Button.Sizes.SMALL}
                        disabled={running}
                        onClick={() => {
                            if (window.confirm(`Are you sure you want to mute all ${targetLabel()}?`)) applyMute(true);
                        }}
                    >
                        Mute All
                    </Button>
                    <Button
                        color={Button.Colors.BRAND}
                        size={Button.Sizes.SMALL}
                        disabled={running}
                        onClick={() => {
                            if (window.confirm(`Are you sure you want to unmute all ${targetLabel()}?`)) applyMute(false);
                        }}
                    >
                        Unmute All
                    </Button>
                </div>
            </Forms.FormSection>
        );
    },
});