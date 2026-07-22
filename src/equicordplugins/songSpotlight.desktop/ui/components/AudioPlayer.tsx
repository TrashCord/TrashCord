/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { logger } from "@equicordplugins/songSpotlight.desktop/lib/utils";
<<<<<<< HEAD
import settings from "@equicordplugins/songSpotlight.desktop/settings";
import { RenderInfoEntry, RenderInfoEntryAudio } from "@song-spotlight/api/handlers";
import { showToast, Toasts, useCallback, useEffect, useMemo, useRef } from "@webpack/common";
import { RefObject } from "react";

interface AudioItemProps {
    audio: RenderInfoEntryAudio;
    index: number;
    handleRef(index: number, node: HTMLAudioElement | null): void;
    handleLoaded(index: number, state: boolean): void;
    handleStopped(index: number, ended?: boolean): void;
}

function AudioItem({ audio, index, handleRef, handleLoaded, handleStopped }: AudioItemProps) {
    const refCallback = useCallback((node: HTMLAudioElement | null) => handleRef(index, node), [index, handleRef]);
    const loadedCallback = useCallback(() => handleLoaded(index, true), [index, handleLoaded]);
    const erroredCallback = useCallback(() => handleLoaded(index, false), [index, handleLoaded]);
    const pausedCallback = useCallback(() => handleStopped(index), [index, handleStopped]);
    const endedCallback = useCallback(() => handleStopped(index, true), [index, handleStopped]);

    return <audio
        src={audio.previewUrl}
        preload="metadata"
        ref={refCallback}
        onLoadedData={loadedCallback}
        onError={erroredCallback}
        onPause={pausedCallback}
        onEnded={endedCallback}
    />;
}

interface AudioPlayerProps {
    audioRef: RefObject<HTMLAudioElement | undefined>;
    list: RenderInfoEntry[];
    playing?: number;
    setPlaying(state: number | undefined): void;
    setLoadedAudio(index: number, state: boolean): void;
}

const BASE_VOLUME = 0.35;

// only allows one song to play at a time
let globalPlaying: HTMLAudioElement | undefined = undefined;

export default function AudioPlayer({ audioRef, list, playing, setPlaying, setLoadedAudio }: AudioPlayerProps) {
    const audios = useMemo(() => list.map(x => x.audio), [list]);
    const nodes = useRef(new Map<number, HTMLAudioElement>());
    const loaded = useRef(new Set<number>());

    const nodeEvents = useRef(new Map<number, () => void>());
    const handleRef = useCallback((index: number, node: HTMLAudioElement | null) => {
        if (node) {
            nodes.current.set(index, node);

            const audio = audios[index];
            if (audio?.previewStart === undefined || !audio.previewSlice) return;

            const endTime = (audio.previewStart + audio.previewSlice) / 1000;
            function timeUpdated() {
                if (node && node.currentTime >= endTime) {
                    node.volume = 0;
                    handleStopped(index, true);
                }
            }

            node.addEventListener("timeupdate", timeUpdated);
            nodeEvents.current.set(index, () => node.removeEventListener("timeupdate", timeUpdated));
        } else {
            nodes.current.delete(index);
            nodeEvents.current.get(index)?.();
            nodeEvents.current.delete(index);
        }
    }, [audios]);

    const handleLoaded = useCallback((index: number, state: boolean) => {
        if (state) loaded.current.add(index);
        else loaded.current.delete(index);
        setLoadedAudio(index, state);
    }, [setLoadedAudio]);

    const handleStopped = useCallback((index: number, ended?: boolean) => {
        if (ended) {
            const nextIndex = loaded.current.values().toArray().sort().find(x => x > index);
            setPlaying(nextIndex !== -1 ? nextIndex : undefined);
        } else if (playing === index) {
            setPlaying(undefined);
        }
    }, [playing, setPlaying]);

    useEffect(() => {
        if (playing !== undefined) {
            const audio = audios[playing], node = nodes.current.get(playing);
            if (audio && node && loaded.current.has(playing)) {
                if (globalPlaying) globalPlaying.pause();

                node.currentTime = audio.previewStart ? audio.previewStart / 1000 : 0;
                node.volume = BASE_VOLUME * (settings.store.previewVolume / 100);
                node.play().catch(error => {
                    showToast("Failed to play song preview!", Toasts.Type.FAILURE);
                    logger.error("Failed to play audio", error);
                    setPlaying(undefined);
                });

                globalPlaying = node;
            } else {
                setPlaying(undefined);
            }
        }

        for (const [index, node] of nodes.current) {
            if (playing !== index && !node.paused) {
                node.pause();
            } else if (globalPlaying === node && node.paused) {
                globalPlaying = undefined;
                audioRef.current = undefined;
            } else if (node === globalPlaying) {
                audioRef.current = node;
            }
        }
    }, [playing, audios]);

    return (
        <div style={{ display: "none" }} aria-hidden="true">
            {audios.map((audio, index) =>
                audio && (
                    <AudioItem
                        key={audio.previewUrl}
                        audio={audio}
                        index={index}
                        handleRef={handleRef}
                        handleLoaded={handleLoaded}
                        handleStopped={handleStopped}
=======
import { RenderInfoEntry } from "@song-spotlight/api/handlers";
import { showToast, Toasts, useCallback, useEffect, useMemo, useRef } from "@webpack/common";
import { RefObject } from "react";

interface AudioPlayerProps {
    audioRef: RefObject<HTMLAudioElement | undefined>;
    list: RenderInfoEntry[];
    playing: number | false;
    setPlaying(playing: number | false): void;
    setLoaded(index: number, state: boolean): void;
}

const DEFAULT_VOLUME = 0.35;

// only allow one song to play at a time
let globalPlaying: HTMLAudioElement | undefined = undefined;

export default function AudioPlayer({ audioRef, list, playing, setPlaying, setLoaded }: AudioPlayerProps) {
    const urls = useMemo(() => list.map(x => x.audio?.previewUrl), [list]);
    const audios = useRef(new Map<number, HTMLAudioElement>());
    const loaded = useRef(new Set<number>());

    useEffect(() => {
        if (playing !== false) {
            const audio = audios.current.get(playing);
            if (audio && loaded.current.has(playing)) {
                if (globalPlaying) globalPlaying.pause();

                audio.currentTime = 0;
                audio.volume = DEFAULT_VOLUME;
                audio.play().catch(error => {
                    showToast("Failed to play song preview!", Toasts.Type.FAILURE);
                    logger.error("Failed to play audio", error);
                    setPlaying(false);
                });

                globalPlaying = audio;
            } else {
                setPlaying(false);
            }
        } else {
            for (const audio of audios.current.values()) {
                if (globalPlaying === audio) audio.pause();
            }
        }

        for (const audio of audios.current.values()) {
            if (audio !== globalPlaying && !audio.paused) {
                audio.pause();
            } else if (audio === globalPlaying && audio.paused) {
                globalPlaying = undefined;
                audioRef.current = undefined;
            } else if (audio === globalPlaying) {
                audioRef.current = audio;
            }
        }
    }, [playing]);

    const handleRef = useCallback((index: number, audio: HTMLAudioElement | null) => {
        if (audio) audios.current.set(index, audio);
        else audios.current.delete(index);
    }, []);

    const handleLoaded = useCallback((index: number) => {
        loaded.current.add(index);
        setLoaded(index, true);
    }, [setLoaded]);

    const handleErrored = useCallback((index: number) => {
        loaded.current.delete(index);
        setLoaded(index, false);
    }, [setLoaded]);

    // onPaused runs before onEnded
    const justPaused = useRef<number>(undefined);

    const handleEnded = useCallback((index: number) => {
        if (justPaused.current !== index && playing !== index) return;

        const nextIndex = urls.findIndex((url, j) => url && j > index);
        setPlaying(nextIndex !== -1 ? nextIndex : false);
    }, [playing, setPlaying]);

    const handlePaused = useCallback((index: number) => {
        if (playing === index) {
            justPaused.current = index;
            setPlaying(false);
        }
    }, [playing, setPlaying]);

    return (
        <div style={{ display: "none" }} aria-hidden="true">
            {urls.map((url, i) =>
                url && (
                    <audio
                        key={url}
                        src={url}
                        preload="metadata"
                        ref={audio => handleRef(i, audio)}
                        onLoadedData={() => handleLoaded(i)}
                        onError={() => handleErrored(i)}
                        onEnded={() => handleEnded(i)}
                        onPause={() => handlePaused(i)}
>>>>>>> 89b0fd2a5 (Update index.tsx)
                    />
                )
            )}
        </div>
    );
}
