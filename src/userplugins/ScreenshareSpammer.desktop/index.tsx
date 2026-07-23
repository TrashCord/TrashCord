/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import definePlugin, { OptionType } from "@utils/types";
import { definePluginSettings } from "@api/Settings";
import { findByCodeLazy } from "@webpack";
import { ChannelStore, FluxDispatcher, Menu, SelectedChannelStore, Toasts, UserStore } from "@webpack/common";

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
    Toasts.show({ message: "⏹ ScreenshareSpammer - Stopped", type: Toasts.Type.SUCCESS, id: Toasts.genId(), options: { duration: 1500 } });
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
        Toasts.show({ message: "❌ Not in a voice channel", type: Toasts.Type.FAILURE, id: Toasts.genId(), options: { duration: 2000 } });
        return;
    }

    uid = UserStore.getCurrentUser().id;

    let src: any;
    try {
        src = await getSource();
    } catch (e) {
        console.error("[ScreenshareSpammer] getSource error:", e);
        Toasts.show({ message: "❌ Failed to get screen source", type: Toasts.Type.FAILURE, id: Toasts.genId(), options: { duration: 2500 } });
        return;
    }
    if (!src) {
        Toasts.show({ message: "❌ No screen source found", type: Toasts.Type.FAILURE, id: Toasts.genId(), options: { duration: 2500 } });
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
    Toasts.show({ message: "📡 Spamming Started — Ctrl+Shift+S to Stop", type: Toasts.Type.MESSAGE, id: "ss-spam", options: { duration: 2500 } });
    interval = setInterval(tick, settings.store.intervalMs);
}

export default definePlugin({
    name: "ScreenshareSpammer",
    description: "Spam Screenshare Start/Stop in VC",
    authors: [{ name: "zfrancesck1", id: 456195985404592149n }],
    tags: ["Voice", "Fun", "Spam", "Shortcuts"],
    enabledByDefault: false,
    settings,
    stop() { stopSpam(); },
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