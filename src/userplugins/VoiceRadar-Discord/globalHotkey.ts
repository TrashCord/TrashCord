/*
 * TrashCord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { formatHotkey, parseHotkey } from "./hotkey";
import { T } from "./i18n";
import { Native } from "./mainProcess";
import { DEFAULT_HOTKEY, settings } from "./settings";
import { toast, ToastVariant } from "./toast";

/** The main process calls the window through this. */
const BRIDGE = "$VoiceRadarHotkey";

/** True brings Discord up, false lets it drop back, and nothing leaves its window alone. */
let onTrigger: (() => boolean | undefined) | null = null;

type Claim = "idle" | "asking" | "held" | "taken";
let claim: Claim = "idle";

let claimRequest = 0;

export type HotkeyReach = "global" | "window" | "needs-restart" | "taken" | "asking";

export function isHotkeyReachSettled(reach: HotkeyReach): boolean {
    return reach === "global" || reach === "window";
}

export function getHotkeyReach(): HotkeyReach {
    if (!settings.store.globalHotkey) return "window";
    if (!Native) return "needs-restart";

    switch (claim) {
        case "held": return "global";
        case "taken": return "taken";
        default: return "asking";
    }
}

type TimerClaim = "idle" | "asking" | "landed" | "refused";
let timerClaim: TimerClaim = "idle";

export type TimersState = "awake" | "off" | "needs-restart" | "refused" | "asking";

export function getTimersState(): TimersState {
    if (!settings.store.keepTimersAwake) return "off";
    if (!Native) return "needs-restart";

    switch (timerClaim) {
        case "landed": return "awake";
        case "refused": return "refused";
        default: return "asking";
    }
}

let throttlingRequest = 0;

export function keepTimersAwake(awake: boolean): void {
    if (!Native) {
        timerClaim = "idle";
        return;
    }

    const request = ++throttlingRequest;
    timerClaim = "asking";

    void Native.setBackgroundThrottling(!awake).then(worked => {
        if (request !== throttlingRequest) return;
        timerClaim = worked ? "landed" : "refused";
    }).catch(() => {
        if (request !== throttlingRequest) return;
        timerClaim = "refused";
    });
}

export function syncBackgroundTimers(): void {
    if (!onTrigger) return;
    keepTimersAwake(!!settings.store.keepTimersAwake);
}

export function revealDiscord(): void {
    if (Native) {
        void Native.revealWindow();
        return;
    }

    const view = (window as any).DiscordNative?.window;
    view?.restore?.();
    view?.focus?.();
}

export function syncGlobalHotkey(trigger?: () => boolean | undefined): void {
    if (trigger) onTrigger = trigger;

    if (!onTrigger) return;

    if (!Native) {
        // After a reload the page only knows the main process methods from the last full start.
        if (settings.store.globalHotkey && typeof IS_DISCORD_DESKTOP !== "undefined" && IS_DISCORD_DESKTOP) {
            toast(T.globalHotkeyNeedsRestart, ToastVariant.FAILURE);
        }
        return;
    }

    (window as any)[BRIDGE] = () => onTrigger?.();

    if (!settings.store.globalHotkey) {
        claimRequest++;
        claim = "idle";
        void Native.unregisterGlobalHotkey();
        return;
    }

    const combo = formatHotkey(parseHotkey(settings.store.hotkey || DEFAULT_HOTKEY));
    const request = ++claimRequest;

    claim = "asking";

    void Native.registerGlobalHotkey(combo).then(claimed => {
        if (request !== claimRequest) return;

        claim = claimed ? "held" : "taken";

        if (!claimed) toast(T.globalHotkeyTaken(combo), ToastVariant.FAILURE);
        else console.log("[VoiceRadar-Discord] the hotkey is now claimed system wide.", combo);
    });
}

const SETTLE_MS = 600;
let settleTimer: ReturnType<typeof setTimeout> | null = null;

export function scheduleGlobalHotkeySync(): void {
    if (settleTimer) clearTimeout(settleTimer);

    settleTimer = setTimeout(() => {
        settleTimer = null;
        syncGlobalHotkey();
    }, SETTLE_MS);
}

export function releaseGlobalHotkey(): void {
    onTrigger = null;
    claimRequest++;
    claim = "idle";
    delete (window as any)[BRIDGE];

    if (settleTimer) {
        clearTimeout(settleTimer);
        settleTimer = null;
    }

    if (Native) void Native.unregisterGlobalHotkey();
}
