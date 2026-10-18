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

function ScreenshareStopIcon({ className, width = 24, height = 24 }: SVGProps<SVGSVGElement>) {
    return (
        <svg className={className} width={width} height={height} viewBox="0 0 24 24" aria-hidden="true">
            <path fill="currentColor" d="M4 4h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-6v2h3v2H7v-2h3v-2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zm0 2v9h16V6H4z" />
            <rect x="9" y="8" width="6" height="5" rx="1" fill="currentColor" />
        </svg>
    );
}

function SpamHeaderButton() {
    const active = useSpamActive();
    if (!active) return null;

    return (
        <HeaderBarButton
            icon={ScreenshareStopIcon}
            tooltip="ScreenshareSpammer Started (click to stop)"
            onClick={stopSpam}
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
    showToast("⏹ ScreenshareSpammer - Stopped", "success", { duration: 1500 });
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
        showToast("❌ Not in a voice channel", "failure", { duration: 2000 });
        return;
    }

    uid = UserStore.getCurrentUser().id;

    let src: any;
    try {
        src = await getSource();
    } catch (e) {
        console.error("[ScreenshareSpammer] getSource error:", e);
        showToast("❌ Failed to get screen source", "failure", { duration: 2500 });
        return;
    }
    if (!src) {
        showToast("❌ No screen source found", "failure", { duration: 2500 });
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
    showToast( "📡 Spamming Started - Ctrl+Shift+S to Stop", "message", { id: "ss-spam", duration: 2500 });
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