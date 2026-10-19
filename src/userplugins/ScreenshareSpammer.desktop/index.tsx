/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { HeaderBarButton } from "@api/HeaderBar";
import { definePluginSettings } from "@api/Settings";
import definePlugin, { OptionType } from "@utils/types";
import { findByCodeLazy } from "@webpack";
import { ChannelStore, FluxDispatcher, Menu, SelectedChannelStore, showToast, useEffect, UserStore, useState } from "@webpack/common";
import type { SVGProps } from "react";

const settings = definePluginSettings({
    intervalMs: {
        type: OptionType.NUMBER,
        description: "Tick interval (ms) [Default: 429 & Recommended: 429+]",
        default: 429
    },
    showStartButton: {
        type: OptionType.BOOLEAN,
        description: "Show a start button in the header bar while not spamming",
        default: false
    }
});

const streamStart = findByCodeLazy('dispatch({type:"STREAM_START"');

let interval:    ReturnType<typeof setInterval> | null = null;
let keyListener: ((e: KeyboardEvent) => void)  | null = null;
let styleEl:     HTMLStyleElement              | null = null;
let on = false;
let uid = "";

let startArgs: Readonly<object> | null = null;
let stopEvt:   Readonly<object> | null = null;
let deleteEvt: Readonly<object> | null = null;
let cachedGuildId:   string | null = null;
let cachedChannelId: string | null = null;

const listeners = new Set<() => void>();
const notify = () => listeners.forEach(fn => fn());

function useSpamActive() {
    const [, tick] = useState(0);
    useEffect(() => {
        const fn = () => tick(n => n + 1);
        listeners.add(fn);
        return () => { listeners.delete(fn); };
    }, []);
    return interval !== null;
}

const WAVES = "M5 9a3.5 3.5 0 0 0 0 6M19 9a3.5 3.5 0 0 1 0 6M2.5 6.5a7.5 7.5 0 0 0 0 11M21.5 6.5a7.5 7.5 0 0 1 0 11";

function ScreenshareStartIcon({ className, width = 24, height = 24 }: SVGProps<SVGSVGElement>) {
    return (
        <svg className={className} width={width} height={height} viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" d={WAVES} />
            <path fill="currentColor" d="M13.2 3 6.5 13h4.3l-.9 8 6.6-10h-4.3z" />
        </svg>
    );
}

function ScreenshareStopIcon({ className, width = 24, height = 24 }: SVGProps<SVGSVGElement>) {
    return (
        <svg className={className} width={width} height={height} viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" d={WAVES} />
            <rect x="8.5" y="8.5" width="7" height="7" rx="1.5" fill="var(--status-danger, #f23f43)" />
        </svg>
    );
}

function SpamHeaderButton() {
    const active = useSpamActive();
    const { showStartButton } = settings.use(["showStartButton"]);

    if (active) {
        return (
            <HeaderBarButton
                icon={ScreenshareStopIcon}
                tooltip="ScreenshareSpammer Started (click to stop)"
                onClick={stopSpam}
            />
        );
    }

    if (!showStartButton) return null;

    return (
        <HeaderBarButton
            icon={ScreenshareStartIcon}
            tooltip="Start ScreenshareSpammer"
            onClick={startSpam}
        />
    );
}

function injectStyle() {
    if (styleEl) return;
    styleEl = document.createElement("style");
    styleEl.textContent = '[class*="activityPanel"],.vc-whos-watching-screenshare-panel{display:none!important}';
    document.head.appendChild(styleEl);
}

function removeStyle() {
    styleEl?.remove();
    styleEl = null;
}

function streamKey(guildId: string | null | undefined, channelId: string): string {
    return guildId ? `guild:${guildId}:${channelId}:${uid}` : `call:${channelId}:${uid}`;
}

function onVoiceSelect(payload: any) {
    if (!payload?.channelId) stopSpam();
}

function forceClose() {
    if (stopEvt)   FluxDispatcher.dispatch(stopEvt as any);
    if (deleteEvt) FluxDispatcher.dispatch(deleteEvt as any);
}

function tick() {
    if (!on) {
        streamStart(cachedGuildId, cachedChannelId, startArgs);
        on = true;
    } else {
        forceClose();
        on = false;
    }
}

function stopSpam() {
    if (!interval) return;
    clearInterval(interval);
    interval = null;
    FluxDispatcher.unsubscribe("VOICE_CHANNEL_SELECT", onVoiceSelect);
    if (keyListener) { document.removeEventListener("keydown", keyListener); keyListener = null; }
    if (on) { forceClose(); on = false; }
    startArgs = stopEvt = deleteEvt = null;
    cachedGuildId = cachedChannelId = null;
    uid = "";
    removeStyle();
    notify();
    showToast({ text: "⏹ ScreenshareSpammer - Stopped", variant: "success", duration: 1500 });
}

async function getSource(): Promise<any> {
    const dn = (window as any).DiscordNative?.desktopCapture;
    if (!dn?.getDesktopCaptureSources) throw new Error("DiscordNative.desktopCapture unavailable");

    const sources: any[] = await dn.getDesktopCaptureSources({
        types: ["screen"],
        thumbnailSize: { width: 1, height: 1 }
    });
    return sources?.[0] ?? null;
}

async function startSpam() {
    if (interval) return;

    cachedChannelId = SelectedChannelStore.getVoiceChannelId();
    if (!cachedChannelId) {
        showToast({ text: "❌ Not in a voice channel", variant: "critical", duration: 2000 });
        return;
    }

    uid = UserStore.getCurrentUser().id;

    let src: any;
    try {
        src = await getSource();
    } catch (e) {
        /* console.error("[ScreenshareSpammer] getSource error:", e); */
        showToast({ text: "❌ Failed to get screen source", variant: "critical", duration: 2500 });
        return;
    }
    if (!src) {
        showToast({ text: "❌ No screen source found", variant: "critical", duration: 2500 });
        return;
    }

    const channel = ChannelStore.getChannel(cachedChannelId);
    cachedGuildId  = channel.guild_id;
    const key      = streamKey(cachedGuildId, cachedChannelId);

    startArgs  = Object.freeze({ pid: null, sourceId: src.id, sourceName: src.name, audioSourceId: null, sound: true, previewDisabled: true });
    stopEvt    = Object.freeze({ type: "STREAM_STOP",   streamKey: key });
    deleteEvt  = Object.freeze({ type: "STREAM_DELETE", streamKey: key });

    keyListener = (e: KeyboardEvent) => {
        if (e.ctrlKey && e.shiftKey && e.key.toUpperCase() === "S") { e.preventDefault(); stopSpam(); }
    };
    document.addEventListener("keydown", keyListener);
    FluxDispatcher.subscribe("VOICE_CHANNEL_SELECT", onVoiceSelect);
    injectStyle();
    showToast({ text: "📡 Spamming Started - Ctrl+Shift+S to Stop", duration: 2500 });
    interval = setInterval(tick, settings.store.intervalMs);
    notify();
}

export default definePlugin({
    name: "ScreenshareSpammer",
    description: "Spam Screenshare Start/Stop in VC",
    authors: [{ name: "zfrancesck1", id: 456195985404592149n }],
    tags: ["Voice", "Fun", "Spam", "Shortcuts"],
    enabledByDefault: false,
    settings,
    get isSpamming() { return interval !== null; },
    subscribe(fn: () => void) {
        listeners.add(fn);
        return () => { listeners.delete(fn); };
    },
    stop() { stopSpam(); },

    headerBarButton: {
        icon: ScreenshareStopIcon,
        render: SpamHeaderButton,
        priority: 6,
    },

    contextMenus: {
        "rtc-channel"(children) {
            children.push(
                <Menu.MenuSeparator />,
                interval
                    ? <Menu.MenuItem id="ss-spam-stop" label="Stop ScreenShareSpam" action={stopSpam} />
                    : <Menu.MenuItem id="ss-spam-start" label="Start ScreenShareSpam" action={startSpam} />
            );
        }
    }
});