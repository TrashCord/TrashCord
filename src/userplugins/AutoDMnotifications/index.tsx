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
    muteAllDms: {
        type: OptionType.BOOLEAN,
        description: "Mute DMs instead of unmuting them when applying",
        default: false,
    },
    includeGroupDms: {
        type: OptionType.BOOLEAN,
        description: "Include group DMs in the action",
        default: true,
    },
    duration: {
        type: OptionType.SELECT,
        description: "Mute duration",
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

function getUpdateChannelOverrideSettings(): ((channelId: string, settings: Record<string, unknown>) => Promise<void>) | undefined {
    return findByProps("updateChannelOverrideSettings")?.updateChannelOverrideSettings;
}

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

function buildOverride(): Record<string, unknown> {
    const s = settings.store;
    return {
        muted: s.muteAllDms,
        mute_config: s.muteAllDms ? { selected_time_window: s.duration, end_time: null } : null,
    };
}

function getTargetChannelIds(): string[] {
    const s = settings.store;
    return ChannelStore.getSortedPrivateChannels()
        .filter(c => c.type === CHANNEL_TYPE_DM || (s.includeGroupDms && c.type === CHANNEL_TYPE_GROUP_DM))
        .map(c => c.id);
}

async function applyToAllDMs(): Promise<void> {
    if (isRunning) return;
    setRunning(true);

    const update = getUpdateChannelOverrideSettings();
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
    const field = buildOverride();
    let ok = 0, fail = 0;

    for (const id of ids) {
        try {
            await update(id, field);
            ok++;
        } catch {
            fail++;
        }
        await sleep(300);
    }

    setRunning(false);
    const scope = settings.store.includeGroupDms ? "DMs + group DMs" : "DMs only (group DMs excluded)";
    Toasts.show({
        message: fail === 0
            ? `Applied to ${ok} DMs. Scope: ${scope}.`
            : `Applied to ${ok} DMs, ${fail} failed. Scope: ${scope}.`,
        type: fail === 0 ? Toasts.Type.SUCCESS : Toasts.Type.FAILURE,
        id: Toasts.genId(),
    });
}

export default definePlugin({
    name: "AutoDMnotifications",
    description: "Mute or unmute notifications for all DMs (not servers), with the option to include or exclude group DMs.",
    authors: [{ name: "zfrancesck1", id: 456195985404592149n }],
    tags: ["DM", "Notifications", "Mute", "Private", "Auto"],
    enabledByDefault: false,
    settings,

    settingsAboutComponent() {
        const running = useIsRunning();
        return (
            <Forms.FormSection>
                <Forms.FormText style={{ marginBottom: 8 }}>
                    {running
                        ? "Applying, please wait…"
                        : "Apply the mute state selected above to all your DMs."
                    }
                </Forms.FormText>
                <Button
                    color={Button.Colors.BRAND}
                    size={Button.Sizes.SMALL}
                    disabled={running}
                    onClick={applyToAllDMs}
                >
                    {running ? "Applying…" : "Apply to all DMs"}
                </Button>
            </Forms.FormSection>
        );
    },
});