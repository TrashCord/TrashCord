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
    muteAllDMs: {
        type: OptionType.BOOLEAN,
        description: "Mute DMs instead of unmuting them when applying",
        default: false,
    },
    includeGroupDMs: {
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

function getToken(): string {
    return findByProps("getToken")?.getToken?.() ?? "";
}

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

async function patchChannelOverrides(overrides: Record<string, unknown>): Promise<void> {
    const token = getToken();
    if (!token) throw new Error("No token");

    while (true) {
        const res = await fetch("https://discord.com/api/v9/users/@me/guilds/settings", {
            method: "PATCH",
            headers: {
                "Authorization": token,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({ guilds: { "@me": { channel_overrides: overrides } } }),
        });

        if (res.ok) return;

        if (res.status === 429) {
            let waitMs = 3000;
            try {
                const body = await res.clone().json();
                if (body.retry_after) waitMs = Math.ceil(body.retry_after * 1000) + 500;
            } catch { }
            await sleep(waitMs);
            continue;
        }

        throw new Error(`HTTP ${res.status}`);
    }
}

function buildOverride(): Record<string, unknown> {
    const s = settings.store;
    return {
        muted: s.muteAllDMs,
        mute_config: s.muteAllDMs ? { selected_time_window: s.duration, end_time: null } : null,
    };
}

function getTargetChannelIds(): string[] {
    const s = settings.store;
    return ChannelStore.getSortedPrivateChannels()
        .filter(c => c.type === CHANNEL_TYPE_DM || (s.includeGroupDMs && c.type === CHANNEL_TYPE_GROUP_DM))
        .map(c => c.id);
}

async function applyToAllDMs(): Promise<void> {
    if (isRunning) return;
    setRunning(true);

    const ids = getTargetChannelIds();
    const field = buildOverride();
    const CHUNK = 200;
    let ok = 0, fail = 0;

    for (let i = 0; i < ids.length; i += CHUNK) {
        const chunk = ids.slice(i, i + CHUNK);
        const overrides: Record<string, unknown> = {};
        for (const id of chunk) overrides[id] = field;

        try {
            await patchChannelOverrides(overrides);
            ok += chunk.length;
        } catch {
            fail += chunk.length;
        }

        if (i + CHUNK < ids.length) await sleep(500);
    }

    setRunning(false);
    const scope = settings.store.includeGroupDMs ? "DMs + group DMs" : "DMs only (group DMs excluded)";
    Toasts.show({
        message: fail === 0
            ? `Applied to ${ok} DMs. Scope: ${scope}.`
            : `Applied to ${ok} DMs, ${fail} failed. Scope: ${scope}.`,
        type: fail === 0 ? Toasts.Type.SUCCESS : Toasts.Type.FAILURE,
        id: Toasts.genId(),
    });
}

export default definePlugin({
    name: "AutoDMNotifications",
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