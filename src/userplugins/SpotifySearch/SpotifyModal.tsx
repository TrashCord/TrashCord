/*
 * Vencord SpotifySearch plugin
 * Copyright (c) 2026 raizefastohand
 * Licensed under GPL-3.0-or-later
 */

import { ModalContent, ModalFooter, ModalHeader, ModalRoot, ModalCloseButton, ModalSize } from "@utils/modal";
import { Button, Forms, Text, useEffect, useRef, useState } from "@webpack/common";
import { SpotifyTrack } from "./api";
import spotifyLogoBase64 from "file://logo/Spotify_Primary_Logo_RGB_White.png?base64";

const SpotifyLogo = `data:image/png;base64,${spotifyLogoBase64}`;

const focusStylesSuppressed = `
.spotify-search-modal-suppressed button,
.spotify-search-modal-suppressed button:focus,
.spotify-search-modal-suppressed button:focus-visible,
.spotify-search-modal-suppressed button:focus-within {
    outline: none !important;
    box-shadow: none !important;
}
`;

const focusStylesNormal = `
.spotify-search-modal button:focus {
    outline: none !important;
    box-shadow: none !important;
}
.spotify-search-modal button:focus-visible {
    outline: 2px solid var(--brand-experiment, #5865F2) !important;
    outline-offset: 2px !important;
    box-shadow: none !important;
}
`;

interface Props {
    rootProps: any;
    tracks: SpotifyTrack[];
    onPick: (track: SpotifyTrack) => void;
}

export function SpotifyModal({ rootProps, tracks, onPick }: Props) {
    const containerRef = useRef<HTMLDivElement>(null);
    const iframeRefs = useRef<Map<string, HTMLIFrameElement>>(new Map());
    const [suppressFocus, setSuppressFocus] = useState(true);

    useEffect(() => {
        const blurAll = () => {
            const active = document.activeElement as HTMLElement | null;
            if (active && containerRef.current?.contains(active)) {
                active.blur();
            }
        };

        const timers: number[] = [];
        [0, 16, 50, 100, 200, 350].forEach(ms => {
            timers.push(window.setTimeout(blurAll, ms));
        });

        const releaseTimer = window.setTimeout(() => setSuppressFocus(false), 500);
        timers.push(releaseTimer);

        return () => timers.forEach(t => clearTimeout(t));
    }, []);

    useEffect(() => {
        const handleMessage = (event: MessageEvent) => {
            if (typeof event.origin !== "string" || !event.origin.includes("spotify.com")) return;

            const data = event.data;
            if (!data || typeof data !== "object") return;

            const isPlayback = data.type === "playback_update";
            const payload = data.payload;
            if (!isPlayback || !payload) return;

            if (payload.isPaused !== false) return;

            const sourceWindow = event.source as Window | null;
            if (!sourceWindow) return;

            iframeRefs.current.forEach((iframe) => {
                if (iframe.contentWindow && iframe.contentWindow !== sourceWindow) {
                    iframe.contentWindow.postMessage({ command: "pause" }, "https://open.spotify.com");
                }
            });
        };

        window.addEventListener("message", handleMessage);
        return () => window.removeEventListener("message", handleMessage);
    }, []);

    const handleClickCapture = () => {
        if (suppressFocus) setSuppressFocus(false);
    };
    const handleKeyDownCapture = (e: React.KeyboardEvent) => {
        if (suppressFocus && e.key === "Tab") setSuppressFocus(false);
    };

    const className = suppressFocus
        ? "spotify-search-modal spotify-search-modal-suppressed"
        : "spotify-search-modal";

    return (
        <ModalRoot {...rootProps} size={ModalSize.MEDIUM} className={className}>
            <style>{suppressFocus ? focusStylesSuppressed : focusStylesNormal}</style>

            <div
                ref={containerRef}
                onClickCapture={handleClickCapture}
                onKeyDownCapture={handleKeyDownCapture}
            >
                <ModalHeader>
                    <Forms.FormTitle tag="h2" style={{ margin: 0, flex: 1 }}>
                        Spotify — pick a track
                    </Forms.FormTitle>
                    <ModalCloseButton onClick={rootProps.onClose} />
                </ModalHeader>

                <ModalContent>
                    <div style={{ display: "flex", flexDirection: "column", gap: "10px", padding: "12px 0" }}>
                        {tracks.length === 0 && (
                            <Text variant="text-md/normal">No tracks found.</Text>
                        )}
                        {tracks.map((track, i) => (
                            <div
                                key={track.id}
                                style={{
                                    display: "flex",
                                    alignItems: "center",
                                    gap: "12px",
                                    padding: "8px",
                                    borderRadius: "6px",
                                    background: "var(--background-secondary)",
                                }}
                            >
                                <Text
                                    variant="text-sm/semibold"
                                    style={{
                                        color: "var(--text-muted)",
                                        minWidth: "20px",
                                        textAlign: "center",
                                        flexShrink: 0,
                                    }}
                                >
                                    {i + 1}
                                </Text>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                    <iframe
                                        ref={el => {
                                            if (el) {
                                                iframeRefs.current.set(track.id, el);
                                            } else {
                                                iframeRefs.current.delete(track.id);
                                            }
                                        }}
                                        title={`Spotify preview: ${track.name}`}
                                        src={`https://open.spotify.com/embed/track/${track.id}?utm_source=vencord_plugin`}
                                        width="100%"
                                        height="80"
                                        frameBorder={0}
                                        allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
                                        loading="lazy"
                                        style={{
                                            borderRadius: "8px",
                                            display: "block",
                                            border: "none",
                                            colorScheme: "normal",
                                        }}
                                    />
                                </div>
                                <Button
                                    size={Button.Sizes.SMALL}
                                    color={Button.Colors.GREEN}
                                    onClick={() => {
                                        onPick(track);
                                        rootProps.onClose();
                                    }}
                                >
                                    Send
                                </Button>
                            </div>
                        ))}
                    </div>
                </ModalContent>

                <ModalFooter>
                    <div style={{
                        display: "flex",
                        flexDirection: "row",
                        alignItems: "center",
                        width: "100%",
                        gap: "8px",
                    }}>
                        <Button
                            color={Button.Colors.PRIMARY}
                            look={Button.Looks.LINK}
                            onClick={rootProps.onClose}
                        >
                            Cancel
                        </Button>
                        <div style={{
                            marginLeft: "auto",
                            display: "flex",
                            alignItems: "center",
                            gap: "8px",
                        }}>
                            <span style={{ fontSize: "11px", color: "var(--text-muted)" }}>
                                Powered by
                            </span>
                            <img
                                src={SpotifyLogo}
                                alt="Spotify"
                                height={20}
                                style={{ display: "block" }}
                            />
                        </div>
                    </div>
                </ModalFooter>
            </div>
        </ModalRoot>
    );
}
