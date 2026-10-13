/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import managedStyle from "./styles.css?managed";

import { definePluginSettings } from "@api/Settings";
import { UserAreaButton, UserAreaRenderProps } from "@api/UserArea";
import { Button } from "@components/Button";
import { Devs } from "@utils/constants";
import definePlugin, { OptionType } from "@utils/types";
import { RenderModalProps } from "@vencord/discord-types";
import { Modal, openModal, React, showToast, Slider, TextInput, Toasts, useState } from "@webpack/common";

type GetUserMedia = typeof navigator.mediaDevices.getUserMedia;

interface MixedInputResources {
    context: AudioContext;
    destination: MediaStreamAudioDestinationNode;
    elementSource: MediaElementAudioSourceNode;
    micSource: MediaStreamAudioSourceNode;
    musicGain: GainNode;
    micGain: GainNode;
    mixedStream: MediaStream;
}

let originalGetUserMedia: GetUserMedia | null = null;
let audioElement: HTMLAudioElement | null = null;
let activeResources: MixedInputResources[] = [];
let isPlaying = false;
let forceButtonUpdate: (() => void) | null = null;

const PIPED_API_INSTANCES = [
    "https://pipedapi.kavin.rocks",
    "https://pipedapi.adminforge.de",
    "https://pipedapi.reallyaweso.me"
];

function getYouTubeVideoId(url: string): string | null {
    try {
        const parsed = new URL(url);

        if (parsed.hostname === "youtu.be") return parsed.pathname.slice(1).split("/")[0] || null;
        if (!/(^|\.)youtube\.com$/.test(parsed.hostname)) return null;
        if (parsed.pathname.startsWith("/shorts/") || parsed.pathname.startsWith("/embed/")) {
            return parsed.pathname.split("/")[2] || null;
        }

        return parsed.searchParams.get("v");
    } catch {
        return null;
    }
}

async function resolveAudioUrl(inputUrl: string): Promise<string> {
    const videoId = getYouTubeVideoId(inputUrl);
    if (!videoId) return inputUrl;

    for (const instance of PIPED_API_INSTANCES) {
        try {
            const response = await fetch(`${instance}/streams/${encodeURIComponent(videoId)}`);
            if (!response.ok) continue;

            const data = await response.json() as {
                audioStreams?: Array<{ url?: string; bitrate?: number; }>; };
            const stream = data.audioStreams
                ?.filter(item => item.url)
                .sort((a, b) => (b.bitrate ?? 0) - (a.bitrate ?? 0))[0];

            if (stream?.url) return stream.url;
        } catch (error) {
            console.warn(`[MusicMic] YouTube resolver failed on ${instance}`, error);
        }
    }

    throw new Error("No YouTube audio resolver is currently available.");
}

const settings = definePluginSettings({
    audioUrl: {
        type: OptionType.STRING,
        description: "Direct audio link to play through your microphone. Use direct mp3, ogg, wav, or stream URLs.",
        placeholder: "https://example.com/song.mp3",
        default: ""
    },
    musicVolume: {
        type: OptionType.SLIDER,
        description: "Music volume sent into the microphone.",
        markers: [0, 10, 25, 50, 75, 100, 150, 200],
        stickToMarkers: false,
        default: 70,
        onChange: applyLiveVolumes
    },
    micVolume: {
        type: OptionType.SLIDER,
        description: "Your real microphone volume while Music Mic is active.",
        markers: [0, 10, 25, 50, 75, 100, 150, 200],
        stickToMarkers: false,
        default: 100,
        onChange: applyLiveVolumes
    },
    loop: {
        type: OptionType.BOOLEAN,
        description: "Loop the audio when it reaches the end.",
        default: true,
        onChange: () => {
            if (audioElement) audioElement.loop = settings.store.loop;
        }
    },
    monitorLocally: {
        type: OptionType.BOOLEAN,
        description: "Also hear the music locally while it is playing.",
        default: false,
        onChange: () => {
            if (audioElement) audioElement.muted = !settings.store.monitorLocally;
        }
    }
});

function clampVolume(volume: number): number {
    return Math.max(0, Math.min(2, Number.isFinite(volume) ? volume / 100 : 1));
}

function applyLiveVolumes(): void {
    for (const resource of activeResources) {
        resource.musicGain.gain.value = clampVolume(settings.store.musicVolume);
        resource.micGain.gain.value = clampVolume(settings.store.micVolume);
    }
}

function getAudioElement(): HTMLAudioElement {
    if (audioElement) return audioElement;

    audioElement = new Audio();
    audioElement.crossOrigin = "anonymous";
    audioElement.preload = "auto";
    audioElement.loop = settings.store.loop;
    audioElement.muted = !settings.store.monitorLocally;
    audioElement.addEventListener("ended", () => {
        if (!settings.store.loop) {
            isPlaying = false;
            forceButtonUpdate?.();
        }
    });
    audioElement.addEventListener("error", () => {
        isPlaying = false;
        forceButtonUpdate?.();
        showToast("Music Mic could not play this link. Use a direct audio URL.", Toasts.Type.FAILURE);
    });

    return audioElement;
}

function isAudioRequest(constraints?: MediaStreamConstraints): boolean {
    if (!constraints?.audio) return false;
    return Boolean(isPlaying && settings.store.audioUrl.trim());
}

async function createMixedStream(originalStream: MediaStream): Promise<MediaStream> {
    const audioTrack = originalStream.getAudioTracks()[0];

    if (!audioTrack) return originalStream;

    const mediaElement = getAudioElement();
    const context = new AudioContext();
    const destination = context.createMediaStreamDestination();
    const micSource = context.createMediaStreamSource(new MediaStream([audioTrack]));
    const elementSource = context.createMediaElementSource(mediaElement);
    const micGain = context.createGain();
    const musicGain = context.createGain();

    micGain.gain.value = clampVolume(settings.store.micVolume);
    musicGain.gain.value = clampVolume(settings.store.musicVolume);

    micSource.connect(micGain);
    elementSource.connect(musicGain);
    micGain.connect(destination);
    musicGain.connect(destination);

    const mixedStream = new MediaStream([
        ...destination.stream.getAudioTracks(),
        ...originalStream.getVideoTracks()
    ]);

    const resources: MixedInputResources = {
        context,
        destination,
        elementSource,
        micSource,
        musicGain,
        micGain,
        mixedStream
    };

    activeResources.push(resources);

    const cleanup = () => {
        activeResources = activeResources.filter(item => item !== resources);
        for (const track of mixedStream.getTracks()) track.stop();
        context.close().catch(() => null);
    };

    audioTrack.addEventListener("ended", cleanup, { once: true });
    await context.resume().catch(() => null);

    return mixedStream;
}

async function startPlayback(): Promise<void> {
    const url = settings.store.audioUrl.trim();

    if (!url) {
        showToast("Paste a direct audio link first.", Toasts.Type.FAILURE);
        return;
    }

    const mediaElement = getAudioElement();

    try {
        const playableUrl = await resolveAudioUrl(url);

        if (mediaElement.src !== playableUrl) {
            mediaElement.src = playableUrl;
            mediaElement.load();
        }

        await mediaElement.play();
        isPlaying = true;
        forceButtonUpdate?.();
        showToast("Music Mic started. Rejoin the call if Discord already captured your mic.", Toasts.Type.SUCCESS);
    } catch (error) {
        console.error("[MusicMic] Failed to play audio", error);
        isPlaying = false;
        forceButtonUpdate?.();
        showToast("Could not load this audio or YouTube link. Try again shortly.", Toasts.Type.FAILURE);
    }
}

function stopPlayback(): void {
    audioElement?.pause();
    isPlaying = false;
    forceButtonUpdate?.();
    showToast("Music Mic stopped.", Toasts.Type.MESSAGE);
}

function patchGetUserMedia(): void {
    if (originalGetUserMedia || !navigator.mediaDevices?.getUserMedia) return;

    originalGetUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);

    navigator.mediaDevices.getUserMedia = (async constraints => {
        const stream = await originalGetUserMedia!(constraints);

        if (!isAudioRequest(constraints)) {
            return stream;
        }

        try {
            return await createMixedStream(stream);
        } catch (error) {
            console.error("[MusicMic] Failed to mix microphone stream", error);
            showToast("Music Mic failed to mix audio. Using your normal mic.", Toasts.Type.FAILURE);
            return stream;
        }
    }) as GetUserMedia;
}

function unpatchGetUserMedia(): void {
    if (!originalGetUserMedia) return;
    navigator.mediaDevices.getUserMedia = originalGetUserMedia;
    originalGetUserMedia = null;
}

function MusicIcon({ className, active }: { className?: string; active?: boolean; }) {
    return (
        <svg className={className} width="22" height="22" viewBox="0 0 24 24" fill="none">
            <path d="M9 18V6.7c0-.78.45-1.49 1.16-1.82l7-3.25A1.3 1.3 0 0 1 19 2.8v11.7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M9 18.2c0 1.21-1.34 2.2-3 2.2s-3-.99-3-2.2S4.34 16 6 16s3 .99 3 2.2ZM19 14.7c0 1.21-1.34 2.2-3 2.2s-3-.99-3-2.2 1.34-2.2 3-2.2 3 .99 3 2.2Z" fill="currentColor" />
            {active && <circle cx="19" cy="5" r="3" fill="var(--status-positive)" />}
        </svg>
    );
}

function MusicMicModal({ modalProps }: { modalProps: RenderModalProps; }) {
    const [url, setUrl] = useState(settings.store.audioUrl);
    const [musicVolume, setMusicVolume] = useState(settings.store.musicVolume);
    const [micVolume, setMicVolume] = useState(settings.store.micVolume);
    const [, rerender] = useState(0);

    const save = () => {
        settings.store.audioUrl = url.trim();
        settings.store.musicVolume = musicVolume;
        settings.store.micVolume = micVolume;
        applyLiveVolumes();
    };

    return (
        <Modal
            {...modalProps}
            size="small"
            title="Music Mic"
            actions={[
                {
                    text: isPlaying ? "Stop" : "Play",
                    variant: isPlaying ? "danger" : "primary",
                    onClick: async () => {
                        save();
                        if (isPlaying) stopPlayback();
                        else await startPlayback();
                        rerender(n => n + 1);
                    }
                },
                {
                    text: "Save",
                    variant: "secondary",
                    onClick: save
                }
            ]}
        >
            <div className="sc-musicmic-modal">
                <div className="sc-musicmic-row">
                    <div className="sc-musicmic-label">Audio or YouTube link</div>
                    <TextInput
                        value={url}
                        placeholder="Paste a YouTube, MP3, OGG or stream link"
                        onChange={setUrl}
                    />
                </div>

                <div className="sc-musicmic-row">
                    <div className="sc-musicmic-label">Music: {Math.round(musicVolume)}%</div>
                    <Slider
                        minValue={0}
                        maxValue={200}
                        initialValue={musicVolume}
                        markers={[0, 25, 50, 75, 100, 150, 200]}
                        stickToMarkers={false}
                        onValueChange={setMusicVolume}
                        onValueRender={value => `${Math.round(value)}%`}
                    />
                </div>

                <div className="sc-musicmic-row">
                    <div className="sc-musicmic-label">Microphone: {Math.round(micVolume)}%</div>
                    <Slider
                        minValue={0}
                        maxValue={200}
                        initialValue={micVolume}
                        markers={[0, 25, 50, 75, 100, 150, 200]}
                        stickToMarkers={false}
                        onValueChange={setMicVolume}
                        onValueRender={value => `${Math.round(value)}%`}
                    />
                </div>

                <div className="sc-musicmic-actions">
                    <Button
                        variant={settings.store.loop ? "primary" : "secondary"}
                        size="small"
                        onClick={() => {
                            settings.store.loop = !settings.store.loop;
                            if (audioElement) audioElement.loop = settings.store.loop;
                            rerender(n => n + 1);
                        }}
                    >
                        Loop: {settings.store.loop ? "On" : "Off"}
                    </Button>
                    <Button
                        variant={settings.store.monitorLocally ? "primary" : "secondary"}
                        size="small"
                        onClick={() => {
                            settings.store.monitorLocally = !settings.store.monitorLocally;
                            if (audioElement) audioElement.muted = !settings.store.monitorLocally;
                            rerender(n => n + 1);
                        }}
                    >
                        Monitor: {settings.store.monitorLocally ? "On" : "Off"}
                    </Button>
                </div>

                <div className="sc-musicmic-status">
                    <strong>{isPlaying ? "Playing" : "Ready"}</strong>
                    {" - "}YouTube and direct audio links are supported. Rejoin voice after pressing Play if needed.
                </div>
            </div>
        </Modal>
    );
}

function openMusicMicModal(): void {
    openModal(props => <MusicMicModal modalProps={props} />);
}

function MusicMicButton({ iconForeground, hideTooltips, nameplate }: UserAreaRenderProps) {
    const [, rerender] = useState(0);

    React.useEffect(() => {
        forceButtonUpdate = () => rerender(n => n + 1);
        return () => {
            forceButtonUpdate = null;
        };
    }, []);

    return (
        <UserAreaButton
            tooltipText={hideTooltips ? undefined : isPlaying ? "Music Mic playing" : "Music Mic"}
            icon={<MusicIcon className={iconForeground} active={isPlaying} />}
            onClick={openMusicMicModal}
            onContextMenu={event => {
                event.preventDefault();
                if (isPlaying) stopPlayback();
                else void startPlayback();
            }}
            role="button"
            aria-label="Music Mic"
            orangeGlow={isPlaying}
            plated={nameplate != null}
        />
    );
}

export default definePlugin({
    name: "MusicMic",
    description: "Adds a user-area music button that mixes a direct audio link into your microphone input.",
    authors: [Devs.Mowiee],
    tags: ["Voice", "Utility", "Media"],
    enabledByDefault: false,
    managedStyle,
    dependencies: ["UserAreaAPI"],
    settings,
    start() {
        patchGetUserMedia();
    },

    stop() {
        stopPlayback();
        unpatchGetUserMedia();
        for (const resource of activeResources) {
            for (const track of resource.mixedStream.getTracks()) track.stop();
            resource.context.close().catch(() => null);
        }
        activeResources = [];
    },

    userAreaButton: {
        icon: MusicIcon,
        render: MusicMicButton,
        priority: -2
    }
});
