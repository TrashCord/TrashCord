import type { TileSpec, Rect } from "../types";
import { layout } from "./GridLayout";
import { drawAvatarTile, drawStreamTile } from "./TileRenderer";
import type { ChatPanelRenderer } from "./ChatPanelRenderer";
import { logger } from "../utils";
import { shouldEmit, fpsInWindow, NO_STREAM_ACTIVE_FPS, IDLE_HEARTBEAT_MS, type FpsMode } from "./frameClock";

export interface CompositorOpts {
    width: number;
    height: number;
    framerate: FpsMode;   // number (fixed) | "auto"
    capFps: number;       // 60, or 120 when allow120FpsAuto
    bakeChat: boolean;
    chatPanelWidthPct: number;  // 0-100
    streamerOverlayBorder: boolean;
    codec: "vp9" | "vp8" | "av1";
    videoBitsPerSecond: number;
    timesliceMs: number;        // e.g. 1000
}

export interface CompositorCallbacks {
    onChunk: (bytes: Uint8Array) => Promise<void>;
    onError: (err: Error) => void;
    getAvatar: (tile: TileSpec) => HTMLImageElement | ImageBitmap | null;
    // TIMING PROBE — when set (debug mode on), per-second capture diagnostics
    // are written here (→ debug.log in the recording dir) instead of the console.
    debugLog?: (line: string) => void;
}

export class Compositor {
    private canvas: HTMLCanvasElement;
    private ctx: CanvasRenderingContext2D;
    private chatPanel: ChatPanelRenderer | null = null;
    private tiles: TileSpec[] = [];
    private rAFHandle: number | null = null;
    private recorder: MediaRecorder | null = null;
    private audioTrack: MediaStreamTrack | null = null;
    private chatCanvas: HTMLCanvasElement | null = null;

    // Output-frame metrics (replaces the old captureStream drop heuristic).
    currentFps = 0;
    totalEmittedFrames = 0;
    private mode: FpsMode;
    private capFps: number;
    private captureTrack: CanvasCaptureMediaStreamTrack | null = null;
    private lastEmitTs = 0;
    private emitTimestamps: number[] = [];
    // Per-streaming-source last decoded-frame count, to detect advancement.
    private sourceCounters = new Map<string, { count: number }>();
    // Set on tile changes so a no-stream grid change emits promptly.
    private contentDirty = true;
    // TIMING PROBE — diagnostic counters for the "missing frames" investigation.
    private probeTickCount = 0;
    private probeSourceAdv = 0;
    private probeLastTs = 0;
    private probeChunkBytes = 0;
    private probeChunkCount = 0;
    private onVisibility: (() => void) | null = null;
    private chunkQueue: Promise<void> = Promise.resolve();
    // Toggles on each drawFrame; when a visible message has animated content
    // we flip chatPanel.dirty on every 2nd tick so the chat layer repaints at
    // ~half framerate (enough for GIF emotes to appear smooth without burning
    // CPU when nothing is animating).
    private animTick = 0;

    constructor(
        private readonly opts: CompositorOpts,
        private readonly cb: CompositorCallbacks
    ) {
        this.canvas = document.createElement("canvas");
        // videoResolution defines the GRID area. When chat is baked in, the
        // chat panel is appended to the right, so the canvas is wider than
        // the video area rather than the video area being squeezed to make
        // room. Keeps streams at their native aspect.
        const videoW = opts.width;
        const videoH = opts.height;
        const chatW = opts.bakeChat ? Math.floor(videoW * opts.chatPanelWidthPct / 100) : 0;
        this.canvas.width = videoW + chatW;
        this.canvas.height = videoH;
        // captureStream ONLY produces frames if the canvas is actually
        // rendered by Chromium's paint pipeline. Several things prevent
        // that: display:none, off-viewport positioning (left:-99999px),
        // and sometimes 1x1 transparent elements that the compositor
        // treats as dead layers. Most reliable: full-size canvas at
        // position:fixed (so it doesn't push Discord's layout) with
        // visibility:hidden (kept in layout + still rendered to its
        // backing bitmap, just not shown) and behind everything.
        this.canvas.style.cssText =
            "position:fixed;top:0;left:0;visibility:hidden;pointer-events:none;z-index:-9999;";
        document.body.appendChild(this.canvas);

        const ctx = this.canvas.getContext("2d");
        if (!ctx) throw new Error("canvas 2d context unavailable");
        this.ctx = ctx;
        this.mode = opts.framerate;
        this.capFps = opts.capFps;

        if (opts.bakeChat) {
            this.chatCanvas = document.createElement("canvas");
            this.chatCanvas.width = chatW;
            this.chatCanvas.height = videoH;
        }
    }

    attachChatPanel(panel: ChatPanelRenderer): void {
        this.chatPanel = panel;
    }

    setTiles(tiles: TileSpec[]): void {
        this.tiles = tiles;
        this.contentDirty = true; // grid changed → emit promptly when no stream
    }

    async start(audioTrack: MediaStreamTrack): Promise<void> {
        this.audioTrack = audioTrack;

        // Draw the first frame BEFORE captureStream so the canvas track
        // starts in "live" state (some Chromium versions produce an inert
        // track otherwise, which makes MediaRecorder silently emit 0 bytes).
        this.drawFrame();

        // captureStream(0): the track emits a frame ONLY when we call
        // requestFrame(). We become the frame clock (see tick()).
        const stream = (this.canvas as any).captureStream(0) as MediaStream;
        this.captureTrack = stream.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack;
        stream.addTrack(audioTrack);
        logger.info(`captureStream tracks: video=${stream.getVideoTracks().length} audio=${stream.getAudioTracks().length}`);
        for (const t of stream.getTracks()) {
            logger.info(`  track ${t.kind} readyState=${t.readyState} enabled=${t.enabled} muted=${t.muted}`);
        }

        const mimeType = this.resolveMimeType();
        logger.info(`MediaRecorder mimeType=${mimeType}`);
        this.recorder = new MediaRecorder(stream, {
            mimeType,
            videoBitsPerSecond: this.opts.videoBitsPerSecond
        });

        let chunkCount = 0;
        this.recorder.ondataavailable = ev => {
            if (!ev.data || ev.data.size === 0) {
                logger.warn(`dataavailable with size=${ev.data?.size ?? "none"}`);
                return;
            }
            chunkCount++;
            // TIMING PROBE — accumulate bytes/chunks for the per-second probe line.
            if (this.cb.debugLog) {
                this.probeChunkBytes += ev.data.size;
                this.probeChunkCount++;
            }
            if (chunkCount <= 3 || chunkCount % 30 === 0) {
                logger.info(`chunk #${chunkCount} size=${ev.data.size}`);
            }
            // Serialize chunk writes: WebM stream is order-dependent,
            // and concurrent async handlers would let IPC deliver out of order.
            const blob = ev.data;
            this.chunkQueue = this.chunkQueue.then(async () => {
                try {
                    const buf = new Uint8Array(await blob.arrayBuffer());
                    await this.cb.onChunk(buf);
                } catch (err) {
                    this.cb.onError(err as Error);
                }
            });
        };
        this.recorder.onerror = ev => {
            const e = (ev as any).error ?? new Error("MediaRecorder error");
            logger.error("recorder error", e);
            this.cb.onError(e);
        };
        this.recorder.onstart = () => logger.info("MediaRecorder started");
        this.recorder.onstop = () => logger.info(`MediaRecorder stopped (total chunks received=${chunkCount})`);
        this.recorder.start(this.opts.timesliceMs);

        // Seed one frame immediately so the track is live the moment recording
        // starts (belt-and-suspenders alongside the first-tick emit).
        this.emitFrame(performance.now());

        // Start the scheduler loop AFTER the recorder is running.
        this.rAFHandle = requestAnimationFrame(this.tick);

        // TIMING PROBE — log window visibility transitions; rAF + canvas capture
        // throttle hard when the document is hidden/occluded, which is the
        // leading suspect for randomly-choppy recordings. Only when debug is on.
        if (this.cb.debugLog) {
            this.cb.debugLog(
                `SESSION canvas=${this.canvas.width}x${this.canvas.height} mode=${String(this.mode)} ` +
                `capFps=${this.capFps} codec=${this.opts.codec} bitrate=${this.opts.videoBitsPerSecond} mime=${mimeType} ` +
                // Cross-session resource counts. If these climb across back-to-back
                // recordings (no restart), a leak is loading the compositor.
                `domImgCache=${document.getElementById("dsa-image-cache-container")?.childElementCount ?? 0} ` +
                `videos=${document.querySelectorAll("video").length} canvases=${document.querySelectorAll("canvas").length}`
            );
            this.onVisibility = () => this.cb.debugLog?.(
                `visibilitychange hidden=${document.hidden} vis=${document.visibilityState} focus=${typeof document.hasFocus === "function" ? document.hasFocus() : "?"}`
            );
            document.addEventListener("visibilitychange", this.onVisibility);
        }
    }

    async stop(): Promise<void> {
        // TIMING PROBE — detach the visibility listener.
        if (this.onVisibility) {
            document.removeEventListener("visibilitychange", this.onVisibility);
            this.onVisibility = null;
        }
        if (this.rAFHandle !== null) {
            cancelAnimationFrame(this.rAFHandle);
            this.rAFHandle = null;
        }
        if (this.recorder && this.recorder.state !== "inactive") {
            const done = new Promise<void>(resolve => {
                const prev = this.recorder!.onstop;
                this.recorder!.onstop = ev => {
                    try { prev?.call(this.recorder!, ev); } catch { /* ignore */ }
                    resolve();
                };
            });
            this.recorder.stop();
            await done;
        }
        // Drain any queued chunk writes so the final flush reaches disk.
        await this.chunkQueue;
        // Release the off-screen canvas from the DOM.
        this.canvas.remove();
    }

    private resolveMimeType(): string {
        const codecMap = {
            vp9: ["video/webm;codecs=vp9,opus"],
            vp8: ["video/webm;codecs=vp8,opus"],
            av1: ["video/webm;codecs=av01,opus"]
        };
        const primary = codecMap[this.opts.codec];
        for (const mt of primary) {
            if (MediaRecorder.isTypeSupported(mt)) return mt;
        }
        // fallback chain
        for (const mt of ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"]) {
            if (MediaRecorder.isTypeSupported(mt)) return mt;
        }
        throw new Error("no supported MediaRecorder mimeType");
    }

    private tick = (ts: number) => {
        if (this.rAFHandle === null) return;

        // Sample each streaming source's decoded-frame counter to detect
        // advancement. getVideoPlaybackQuality is robust for our hidden
        // <video> elements; webkitDecodedFrameCount is the fallback.
        let sourceAdvanced = false;
        let hasStreams = false;
        for (const tile of this.tiles) {
            const v = tile.streaming ? tile.videoEl : null;
            if (!v || !(v.videoWidth > 0)) continue;
            hasStreams = true;
            const count = decodedFrameCount(v);
            const prev = this.sourceCounters.get(tile.userId);
            if (!prev) {
                this.sourceCounters.set(tile.userId, { count });
            } else if (count > prev.count) {
                sourceAdvanced = true;
                prev.count = count;
            }
        }

        // Tell the chat panel whether a stream is active (drives chat
        // animation gating in "when-streaming" mode).
        this.chatPanel?.setStreamActive(hasStreams);

        const hasAnimation = !!this.chatPanel?.hasVisibleAnimation();
        const contentDirty = this.contentDirty || !!this.chatPanel?.hasPendingRender();

        if (shouldEmit({
            mode: this.mode, capFps: this.capFps, now: ts,
            lastEmitTs: this.lastEmitTs, sourceAdvanced, hasStreams,
            contentDirty, hasAnimation,
            activeFps: NO_STREAM_ACTIVE_FPS, idleHeartbeatMs: IDLE_HEARTBEAT_MS
        })) {
            this.emitFrame(ts);
        }

        // TIMING PROBE — once-per-second snapshot to localize the missing-frames
        // bug: rAFticks≈1 means rAF is throttled (window hidden/occluded);
        // rAFticks high but bytes≈0 means the capture track/encoder isn't
        // capturing despite frames being requested. Only runs when debug is on.
        if (this.cb.debugLog) {
            this.probeTickCount++;
            if (sourceAdvanced) this.probeSourceAdv++;
            if (this.probeLastTs === 0) this.probeLastTs = ts;
            if (ts - this.probeLastTs >= 1000) {
                this.cb.debugLog(
                    `PROBE rAFticks=${this.probeTickCount} emitted=${this.currentFps} srcAdv=${this.probeSourceAdv} ` +
                    `chunks=${this.probeChunkCount} bytes=${this.probeChunkBytes} hasStreams=${hasStreams} ` +
                    `imgCache=${document.getElementById("dsa-image-cache-container")?.childElementCount ?? 0} ` +
                    `hidden=${document.hidden} vis=${document.visibilityState} focus=${typeof document.hasFocus === "function" ? document.hasFocus() : "?"}`
                );
                this.probeTickCount = 0;
                this.probeSourceAdv = 0;
                this.probeChunkBytes = 0;
                this.probeChunkCount = 0;
                this.probeLastTs = ts;
            }
        }

        this.rAFHandle = requestAnimationFrame(this.tick);
    };

    private emitFrame(now: number): void {
        this.drawFrame();
        this.captureTrack?.requestFrame();
        this.contentDirty = false;
        this.lastEmitTs = now;
        this.totalEmittedFrames++;
        this.emitTimestamps.push(now);
        // Keep only the last ~1s of timestamps and report the rolling rate.
        while (this.emitTimestamps.length > 0 && now - this.emitTimestamps[0] >= 1000) {
            this.emitTimestamps.shift();
        }
        this.currentFps = fpsInWindow(this.emitTimestamps, now);
    }

    private drawFrame(): void {
        const height = this.canvas.height;
        const videoW = this.opts.width;
        const chatW = this.chatCanvas?.width ?? 0;
        this.ctx.save();
        this.ctx.fillStyle = "#202225";
        this.ctx.fillRect(0, 0, videoW + chatW, height);

        const gridRect: Rect = { x: 0, y: 0, width: videoW, height };

        // When one or more screenshares are active, take over the grid with
        // just those — the whole point of viewing is to see the stream, and
        // cramping it into one small tile next to avatar boxes defeats that.
        // Falls back to the full participant grid when nobody is streaming.
        //
        // Only count a stream as occupying a slot when its <video> is actually
        // producing frames (videoWidth>0). A stream the user manually stopped
        // watching keeps its tile flagged `streaming` but stops delivering
        // decoded video; without this check its now-frameless black box would
        // still claim grid space and squeeze the streams you ARE watching.
        const streamingTiles = this.tiles.filter(
            t => t.streaming && t.videoEl && t.videoEl.videoWidth > 0 && t.videoEl.videoHeight > 0
        );
        const tilesToRender = streamingTiles.length > 0 ? streamingTiles : this.tiles;

        const rects = layout(tilesToRender.length, gridRect);
        for (let i = 0; i < rects.length; i++) {
            const tile = tilesToRender[i];
            const rect = rects[i];
            if (tile.streaming && tile.videoEl) {
                drawStreamTile(this.ctx, rect, tile, { borderGlow: this.opts.streamerOverlayBorder });
            } else {
                drawAvatarTile(this.ctx, rect, tile, this.cb.getAvatar(tile));
            }
        }

        if (this.opts.bakeChat && this.chatPanel && this.chatCanvas) {
            const chatBmp = this.chatPanel.getBitmap();
            this.ctx.drawImage(chatBmp, videoW, 0);
        }

        this.ctx.restore();

        // Animated content in the chat panel needs a periodic dirty-flip so
        // decoded frames reach the composite. Skip this nudge when nothing
        // visible is animated so static chat doesn't churn CPU.
        if (this.opts.bakeChat && this.chatPanel) {
            this.animTick = (this.animTick + 1) & 1;
            if (this.animTick === 0 && this.chatPanel.hasVisibleAnimation()) {
                this.chatPanel.markDirty();
            }
        }
    }
}

function decodedFrameCount(v: HTMLVideoElement): number {
    const q = (v as any).getVideoPlaybackQuality?.();
    if (q && typeof q.totalVideoFrames === "number") return q.totalVideoFrames;
    return (v as any).webkitDecodedFrameCount ?? 0;
}
