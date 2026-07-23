// Tap into Discord's Web Audio pipeline on Vesktop / web to capture
// per-participant MediaStreams keyed by userId.
//
// On Discord Desktop, voice audio is handled by the native `discord_voice`
// module and never appears as a MediaStream in JS. This file's webpack
// patch is gated by IS_DISCORD_DESKTOP in the plugin entry, and the tap
// registry simply stays empty on Desktop.
//
// The hook mirrors the location volumeBooster uses (`.volume=this._volume/100;`
// inside Discord's stream source node updater) — we just read the `StreamData`
// argument rather than overriding its volume.

import { logger } from "../utils";

interface DiscordStreamData {
    audioContext: AudioContext;
    audioElement?: HTMLAudioElement;
    stream: MediaStream;
    id: string; // Discord user id (for remote participants)
    [k: string]: any;
}

export interface TappedStream {
    stream: MediaStream;
    audioContext: AudioContext;
}

const activeTaps = new Map<string, TappedStream>();
const listeners = new Set<() => void>();
// Tracks streams we've already subscribed to so we don't attach duplicate
// addtrack/removetrack listeners. WeakSet so Discord can garbage-collect
// streams that are fully torn down.
const streamsWithListeners = new WeakSet<MediaStream>();
let streamsSeen = 0;

// Tracks added/removed after the initial tap (e.g. when a participant starts
// screen-sharing AFTER their audio was already streaming) don't fire the
// audio-path webpack hook. Listening on the MediaStream directly is the
// correct way to catch those events, regardless of which track kind arrives.
function attachStreamTrackListeners(stream: MediaStream): void {
    if (streamsWithListeners.has(stream)) return;
    streamsWithListeners.add(stream);
    stream.addEventListener("addtrack", notifyChange);
    stream.addEventListener("removetrack", notifyChange);
}

export function getTappedStream(userId: string): TappedStream | null {
    return activeTaps.get(userId) ?? null;
}

export function getAllTappedStreams(): ReadonlyMap<string, TappedStream> {
    return activeTaps;
}

export function subscribeToTapChanges(listener: () => void): () => void {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
}

function notifyChange(): void {
    listeners.forEach(l => {
        try { l(); } catch (err) { logger.error("tap listener threw", err); }
    });
}

// Public wake-up for tap subscribers from sibling capture sources (e.g.
// localStreamTap adopting/releasing your own outbound screenshare), so the
// recording session re-runs its audio + screenshare reconcile.
export function notifyTapChange(): void {
    notifyChange();
}

// Called from the webpack-injected hook. Must be defensive — any throw here
// propagates into Discord's rendering code.
let diagnosticCallsLogged = 0;
export function onStreamDataSeen(data: DiscordStreamData): void {
    try {
        // Diagnostic: log the first few invocations in detail so we can see
        // what shape `this` actually has in the patched Discord code. Helps
        // when the patch runs but fields aren't where we expect them.
        if (diagnosticCallsLogged < 3) {
            diagnosticCallsLogged++;
            const keys = data ? Object.keys(data).slice(0, 20) : [];
            const streamInfo = data?.stream
                ? `tracks=${data.stream.getAudioTracks().length} streamId=${data.stream.id}`
                : "no stream field";
            logger.info(`webAudioTap call #${diagnosticCallsLogged}: id=${String(data?.id)} streamKeys=[${keys.join(",")}] ${streamInfo}`);
        }

        if (!data || !data.id || !data.stream) return;
        // Register any stream with at least one track (audio, video, or both).
        // Screenshares may arrive video-first with no audio track yet, and
        // we still want to capture the video for the compositor.
        if (data.stream.getTracks().length === 0) return;

        streamsSeen++;
        if (streamsSeen <= 10) {
            logger.info(`webAudioTap: captured stream for user ${data.id} (total seen=${streamsSeen})`);
        }

        // Discord's RTC layer can fire this hook with the same `data.id` (the
        // user id) for both a user's voice Output and their screenshare /
        // camera Output. Keying both under the same slot lets whichever
        // stream arrives second clobber the first — observed as: when
        // recording starts while someone is already streaming, voice is
        // silent in the recording but their stream's desktop/game audio
        // plays through. Distinguish by track composition so they coexist:
        // audio-only streams (voice) keep `data.id`; video-bearing streams
        // (screenshare / camera) get `${data.id}:video`. Lookups for voice
        // (getParticipantAudioStream) hit the bare id; screenshare scans
        // (reconcileScreenshares, StreamTap fallback) match by substring
        // and still find the :video entry.
        const hasVideo = data.stream.getVideoTracks().length > 0;
        const key = hasVideo ? `${data.id}:video` : data.id;

        const existing = activeTaps.get(key);
        if (existing?.stream === data.stream) return; // idempotent: same call fires repeatedly

        activeTaps.set(key, { stream: data.stream, audioContext: data.audioContext });
        attachStreamTrackListeners(data.stream);

        for (const track of data.stream.getAudioTracks()) {
            track.addEventListener("ended", () => {
                if (activeTaps.get(key)?.stream === data.stream) {
                    activeTaps.delete(key);
                    notifyChange();
                }
            });
        }

        notifyChange();
    } catch (err) {
        logger.error("onStreamDataSeen failed", err);
    }
}

export function clearTaps(): void {
    activeTaps.clear();
    streamsSeen = 0;
}
