// Pure, canvas-free core of the adaptive frame clock. Unit-tested in
// tests/compositor/frameClock.test.ts. The Compositor wires these to real
// <video> decoded-frame counters and MediaRecorder.

export type FpsMode = number | "auto";
export type ChatAnimationMode = "always" | "when-streaming" | "never";

// No-stream pacing: ~15fps while something is moving/changing, ~1.3fps idle.
export const NO_STREAM_ACTIVE_FPS = 15;
// Idle floor AND stalled-source backstop. Kept under the 1s MediaRecorder
// timeslice so every chunk still carries at least one video frame.
export const IDLE_HEARTBEAT_MS = 750;

export function resolveCapFps(allow120: boolean): number {
    return allow120 ? 120 : 60;
}

export function resolveChatAnimate(mode: ChatAnimationMode, streamActive: boolean): boolean {
    if (mode === "always") return true;
    if (mode === "never") return false;
    return streamActive; // "when-streaming"
}

// Count emit timestamps within the last `windowMs` — the displayed output fps.
export function fpsInWindow(timestamps: number[], now: number, windowMs = 1000): number {
    let c = 0;
    for (const t of timestamps) if (now - t < windowMs) c++;
    return c;
}

export interface ShouldEmitArgs {
    mode: FpsMode;
    capFps: number;
    now: number;
    lastEmitTs: number;       // 0 if no frame emitted yet
    sourceAdvanced: boolean;  // any streaming video advanced its decoded count
    hasStreams: boolean;      // any streaming video producing frames
    contentDirty: boolean;    // no-stream: chat/grid changed since last emit
    hasAnimation: boolean;    // no-stream: animated emote/GIF visible (and enabled)
    activeFps: number;        // no-stream active rate (NO_STREAM_ACTIVE_FPS)
    idleHeartbeatMs: number;  // idle floor + stalled-source backstop
}

export function shouldEmit(a: ShouldEmitArgs): boolean {
    if (a.lastEmitTs === 0) return true; // seed the track
    const elapsed = a.now - a.lastEmitTs;

    let due: boolean;
    if (!a.hasStreams) {
        const interval = (a.hasAnimation || a.contentDirty) ? 1000 / a.activeFps : a.idleHeartbeatMs;
        due = elapsed >= interval;
    } else if (a.mode === "auto") {
        due = a.sourceAdvanced && elapsed >= 1000 / a.capFps;
    } else {
        due = elapsed >= 1000 / a.mode; // fixed N: steady cadence
    }

    // Backstop: guarantees liveness when a source stalls/pauses so
    // MediaRecorder never starves and each timeslice carries a frame.
    return due || elapsed >= a.idleHeartbeatMs;
}
