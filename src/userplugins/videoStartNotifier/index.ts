/*
 * TrashCord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { Devs } from "@utils/constants";
import definePlugin, { OptionType } from "@utils/types";
import { findStoreLazy } from "@webpack";
import { ChannelStore, SelectedChannelStore, UserStore } from "@webpack/common";

import startBase64 from "file://./start.mp3?base64";
import stopBase64 from "file://./stop.mp3?base64";

interface VoiceState {
    userId: string;
    channelId: string;
    selfVideo: boolean;
    deaf: boolean;
    mute: boolean;
    selfDeaf: boolean;
    selfMute: boolean;
    selfStream: boolean;
    sessionId: string;
    suppress: boolean;
    requestToSpeakTimestamp: number | null;
}

interface VoiceStateUpdate {
    voiceStates: Array<{
        userId: string;
        channelId?: string | null;
        selfVideo?: boolean;
    }>;
}

const startSound = "https://cdn.jsdelivr.net/gh/redbaron2k7/videoStartNotifier@117738bff76699a89531a067e321b6406bffbc88/start.mp3";
const stopSound = "https://cdn.jsdelivr.net/gh/redbaron2k7/videoStartNotifier@117738bff76699a89531a067e321b6406bffbc88/stop.mp3";
const startLocalSound = `data:audio/mpeg;base64,${startBase64}`;
const stopLocalSound = `data:audio/mpeg;base64,${stopBase64}`;

const VoiceStateStore = findStoreLazy("VoiceStateStore");
const MediaEngineStore = findStoreLazy("MediaEngineStore");

const lastKnownStates = new Map<string, boolean>();
let trackedChannelId: string | null = null;
let trackedPrivate = false;
let startAudio: HTMLAudioElement | null = null;
let stopAudio: HTMLAudioElement | null = null;
let selfId: string | null = null;

function createAudio(localSrc: string, remoteSrc: string): HTMLAudioElement {
    const audio = new Audio(localSrc);
    audio.preload = "auto";
    audio.addEventListener("error", () => {
        audio.src = remoteSrc;
    }, { once: true });
    return audio;
}

type SinkAudio = HTMLAudioElement & { setSinkId?: (id: string) => Promise<void>; sinkId?: string; };

function playNotification(isVideoOn: boolean): void {
    const audio = (isVideoOn ? startAudio : stopAudio) as SinkAudio | null;
    if (!audio) return;
    const integrated = settings.store.discordAudio;
    audio.volume = integrated ? Math.min(1, Math.max(0, (MediaEngineStore.getOutputVolume?.() ?? 100) / 100)) : 1;
    if (audio.volume === 0) return;
    audio.currentTime = 0;
    const start = () => audio.play().catch(() => { });
    const sinkId: string | undefined = integrated ? MediaEngineStore.getOutputDeviceId?.() : undefined;
    if (sinkId && audio.setSinkId && audio.sinkId !== sinkId) audio.setSinkId(sinkId).catch(() => { }).then(start);
    else start();
}

function syncChannel(channelId: string | null): void {
    trackedChannelId = channelId;
    lastKnownStates.clear();
    if (!channelId) {
        trackedPrivate = false;
        return;
    }

    trackedPrivate = ChannelStore.getChannel(channelId)?.isPrivate() ?? false;
    const states = VoiceStateStore.getVoiceStatesForChannel(channelId) as Record<string, VoiceState> | undefined;
    if (!states) return;
    for (const userId in states) lastKnownStates.set(userId, Boolean(states[userId].selfVideo));
}

const settings = definePluginSettings({
    playInPrivate: {
        type: OptionType.BOOLEAN,
        description: "Play notification sound in private voice calls (DMs)",
        default: true
    },
    playInServer: {
        type: OptionType.BOOLEAN,
        description: "Play notification sound in server voice channels",
        default: true
    },
    discordAudio: {
        type: OptionType.BOOLEAN,
        description: "Integrate with Discord audio - sounds use Discord's output device and follow Discord's output volume (output volume 0 = silent)",
        default: true
    },
    ignoreSelf: {
        type: OptionType.BOOLEAN,
        description: "Ignore my own camera - no detection and no sound when I turn on/off my real camera or a fake camera (FakeVoiceState)",
        default: true
    }
});

export default definePlugin({
    name: "VideoStartNotifier",
    description: "Plays a sound when someone starts/stops their webcam in a voice channel",
    authors: [Devs.redbaron2k7, { name: "zfrancesck1", id: 456195985404592149n }],
    tags: ["Voice", "Notifications"],
    enabledByDefault: true,
    settings,

    start() {
        startAudio = createAudio(startLocalSound, startSound);
        stopAudio = createAudio(stopLocalSound, stopSound);
        syncChannel(SelectedChannelStore.getVoiceChannelId() ?? null);
    },

    stop() {
        startAudio = null;
        stopAudio = null;
        selfId = null;
        syncChannel(null);
    },

    flux: {
        VOICE_STATE_UPDATES({ voiceStates }: VoiceStateUpdate): void {
            const currentChannelId = SelectedChannelStore.getVoiceChannelId() ?? null;
            if (currentChannelId !== trackedChannelId) syncChannel(currentChannelId);
            if (!currentChannelId) return;

            const allowed = trackedPrivate ? settings.store.playInPrivate : settings.store.playInServer;
            const ignoreSelf = settings.store.ignoreSelf;
            if (ignoreSelf) selfId ??= UserStore.getCurrentUser()?.id ?? null;

            for (let i = 0; i < voiceStates.length; i++) {
                const { userId, channelId, selfVideo } = voiceStates[i];
                if (channelId !== currentChannelId) {
                    lastKnownStates.delete(userId);
                    continue;
                }

                const currentState = Boolean(selfVideo);
                const lastKnownState = lastKnownStates.get(userId);
                lastKnownStates.set(userId, currentState);
                if (ignoreSelf && userId === selfId) continue;

                if (allowed && lastKnownState !== undefined && lastKnownState !== currentState) {
                    playNotification(currentState);
                }
            }
        }
    },
});