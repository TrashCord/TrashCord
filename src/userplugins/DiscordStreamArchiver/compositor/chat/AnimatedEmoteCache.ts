import { PluginNative } from "@utils/types";
import { logger } from "../../utils";
import { DiscordMediaIndex } from "./DiscordMediaIndex";

const Native = VencordNative.pluginHelpers.DiscordStreamArchiver as PluginNative<typeof import("../../native")>;

// URLs that we can't reach with the worker's own fetch (origin sends no
// Access-Control-Allow-Origin). For these we fetch in the main process and
// hand the bytes to the worker. Discord's sticker CDN
// (cdn.discordapp.com/stickers/<id>.<ext>) is the canonical case — its
// emoji sibling sends CORS, the sticker endpoint doesn't.
function needsNativeFetch(url: string): boolean {
    return /https?:\/\/cdn\.discordapp\.com\/stickers\/\d+\./i.test(url);
}

// Inline Worker source. Kept as a template literal so it travels with the
// plugin bundle rather than requiring a separate Worker entry point (Vencord's
// esbuild pipeline produces one file). The worker owns all heavy decoding:
// fetch, ImageDecoder, frame scheduling. It posts ImageBitmap frames back to
// the main thread, which just stores the latest per URL and blits it with
// drawImage. This decouples decode cost from the rAF / MediaRecorder pipeline
// — if the worker falls behind, we draw the most-recent frame instead of
// stalling the compositor.
//
// Messages from main -> worker:
//   { cmd: "preload", url }
//   { cmd: "dispose", url }
//   { cmd: "terminate" }
//
// Messages from worker -> main:
//   { type: "frame", url, bitmap }   (bitmap transferred)
//   { type: "noTrack", url, mime }
//   { type: "error", url, err }
const WORKER_SCRIPT = `
"use strict";
const decoders = new Map();

function guessMime(url) {
    if (/\\.png(\\?|$)/i.test(url)) return "image/png";
    if (/\\.webp(\\?|$)/i.test(url)) return "image/webp";
    return "image/gif";
}

async function startDecoding(url) {
    if (decoders.has(url)) return;
    const entry = { decoder: null, disposed: false, timer: null };
    decoders.set(url, entry);
    try {
        const res = await fetch(url);
        if (!res.ok) throw new Error("fetch " + res.status);
        const data = await res.arrayBuffer();
        const ct = res.headers.get("content-type");
        const mime = (ct && ct.split(";")[0].trim()) || guessMime(url);
        await decodeFromBytes(url, entry, data, mime);
    } catch (err) {
        self.postMessage({ type: "error", url, err: String((err && err.message) || err) });
    }
}

// Used when the main thread already fetched the bytes (typically because the
// origin doesn't send CORS headers and the worker's own fetch would fail).
// Same decode pipeline, just skips the network step.
async function startDecodingFromBytes(url, data, mime) {
    if (decoders.has(url)) return;
    const entry = { decoder: null, disposed: false, timer: null };
    decoders.set(url, entry);
    try {
        await decodeFromBytes(url, entry, data, mime || guessMime(url));
    } catch (err) {
        self.postMessage({ type: "error", url, err: String((err && err.message) || err) });
    }
}

async function decodeFromBytes(url, entry, data, mime) {
    const decoder = new ImageDecoder({ type: mime, data });
    await decoder.tracks.ready;
    if (entry.disposed) return;
    if (!decoder.tracks.selectedTrack) {
        self.postMessage({ type: "noTrack", url, mime });
        return;
    }
    entry.decoder = decoder;
    scheduleFrame(url, entry, 0);
}

async function scheduleFrame(url, entry, index) {
    if (entry.disposed || !entry.decoder) return;
    const track = entry.decoder.tracks.selectedTrack;
    if (!track) return;
    const total = track.frameCount;
    if (total <= 0) return;
    const clampedIndex = index % total;
    let result;
    try {
        result = await entry.decoder.decode({ frameIndex: clampedIndex });
    } catch (err) {
        self.postMessage({ type: "error", url, err: "decode: " + String((err && err.message) || err) });
        return;
    }
    if (entry.disposed) {
        try { result.image.close && result.image.close(); } catch (e) {}
        return;
    }
    const vf = result.image;
    const durationUs = vf.duration;
    let bitmap;
    try {
        bitmap = await createImageBitmap(vf);
    } catch (err) {
        try { vf.close && vf.close(); } catch (e) {}
        self.postMessage({ type: "error", url, err: "createImageBitmap: " + String((err && err.message) || err) });
        return;
    }
    try { vf.close && vf.close(); } catch (e) {}
    if (entry.disposed) {
        try { bitmap.close(); } catch (e) {}
        return;
    }
    self.postMessage({ type: "frame", url, bitmap }, [bitmap]);
    // Single-frame payloads (static PNG/WebP that got routed through here
    // because the URL pattern looked sticker-shaped) don't need a schedule.
    // Stop after frame 0 — otherwise we'd spin decoding the same frame
    // 30x/sec for nothing.
    if (total === 1) return;
    // Clamp to 30fps max. Some APNGs report 20ms/frame (50fps), which
    // would saturate the main thread's drawImage coalescing without any
    // perceptible benefit.
    const ms = Math.max(33, Math.floor((durationUs || 100000) / 1000));
    entry.timer = setTimeout(() => {
        scheduleFrame(url, entry, clampedIndex + 1);
    }, ms);
}

self.onmessage = (e) => {
    const msg = e.data || {};
    if (msg.cmd === "preload") {
        startDecoding(msg.url);
    } else if (msg.cmd === "preloadBytes") {
        startDecodingFromBytes(msg.url, msg.bytes, msg.mime);
    } else if (msg.cmd === "dispose") {
        const entry = decoders.get(msg.url);
        if (entry) {
            entry.disposed = true;
            if (entry.timer) clearTimeout(entry.timer);
            decoders.delete(msg.url);
        }
    } else if (msg.cmd === "terminate") {
        for (const entry of decoders.values()) {
            entry.disposed = true;
            if (entry.timer) clearTimeout(entry.timer);
        }
        decoders.clear();
        self.close();
    }
};
`;

type WorkerMessage =
    | { type: "frame"; url: string; bitmap: ImageBitmap }
    | { type: "noTrack"; url: string; mime: string }
    | { type: "error"; url: string; err: string };

// Cap on retained animated frames. Each entry is a live ImageBitmap (GPU
// memory) AND a worker-side decoder spinning a setTimeout loop, so an
// unbounded map leaks both memory and CPU across a long session. The visible
// animated working set is small (tens of emotes); 150 leaves generous slack
// while keeping the ceiling bounded.
const MAX_FRAMES = 150;

export class AnimatedEmoteCache {
    private worker: Worker | null = null;
    private workerUrl: string | null = null;
    private frames = new Map<string, ImageBitmap>();
    private preloaded = new Set<string>();
    private domIndex = new DiscordMediaIndex();
    private warnedNoWorker = false;

    constructor(private readonly onFrame: () => void) {
        this.spawnWorker();
    }

    private spawnWorker(): void {
        try {
            const blob = new Blob([WORKER_SCRIPT], { type: "text/javascript" });
            this.workerUrl = URL.createObjectURL(blob);
            this.worker = new Worker(this.workerUrl);
            this.worker.onmessage = ev => this.handleMessage(ev.data as WorkerMessage);
            this.worker.onerror = ev => {
                logger.warn(`[AEC] worker error: ${ev.message}`);
            };
        } catch (err) {
            logger.warn("[AEC] failed to spawn decode worker; animations will not decode", err);
            this.worker = null;
        }
    }

    private handleMessage(msg: WorkerMessage): void {
        if (msg.type === "frame") {
            // Close the previous bitmap for this URL before overwriting —
            // ImageBitmaps hold GPU memory and are not GC-eligible via
            // normal refcounting. Without close(), every frame we don't
            // replace would leak until page close.
            const prev = this.frames.get(msg.url);
            if (prev) { try { prev.close(); } catch { /* ignore */ } }
            this.frames.set(msg.url, msg.bitmap);
            this.evictFrames();
            this.onFrame();
        } else if (msg.type === "noTrack") {
            logger.warn(`[AEC] no selected track for ${msg.url} (mime=${msg.mime})`);
        } else if (msg.type === "error") {
            logger.warn(`[AEC] ${msg.url}: ${msg.err}`);
        }
    }

    getFrame(url: string): CanvasImageSource | null {
        // Zero-decode path first: if Discord's client is currently rendering
        // this media (i.e. the user is viewing the recording channel), reuse
        // its <img>/<video> directly. drawImage on Discord's animating <img>
        // samples its current decoded frame — no bytes re-fetched, no frames
        // re-decoded. The compositor's animTick dirty-flip keeps re-sampling
        // it across rAF ticks.
        const discordEl = this.domIndex.find(url);
        if (discordEl) return discordEl;
        // Worker-decoded fallback. If the worker hasn't produced a first
        // frame yet (preload still in flight), returns null — caller then
        // falls back to the static ImageCache <img> frame-0.
        const f = this.frames.get(url);
        if (f) {
            // Re-insert to mark most-recently-used, so the on-screen working
            // set is never the target of frame eviction.
            this.frames.delete(url);
            this.frames.set(url, f);
            return f;
        }
        return null;
    }

    // Evict least-recently-used decoded frames once over the cap: close the
    // bitmap (frees GPU memory) and tell the worker to dispose the decoder
    // (stops its setTimeout decode loop). Dropping the URL from `preloaded`
    // lets it be re-decoded if it scrolls back into view later.
    private evictFrames(): void {
        while (this.frames.size > MAX_FRAMES) {
            const oldest = this.frames.keys().next().value as string | undefined;
            if (oldest === undefined) break;
            const bmp = this.frames.get(oldest);
            this.frames.delete(oldest);
            if (bmp) { try { bmp.close(); } catch { /* ignore */ } }
            this.preloaded.delete(oldest);
            try { this.worker?.postMessage({ cmd: "dispose", url: oldest }); } catch { /* ignore */ }
        }
    }

    preload(url: string): void {
        if (!url || this.preloaded.has(url)) return;
        this.preloaded.add(url);
        const w = this.worker;
        if (!w) {
            if (!this.warnedNoWorker) {
                logger.warn("[AEC] no worker available; animations will not decode");
                this.warnedNoWorker = true;
            }
            return;
        }
        if (needsNativeFetch(url)) {
            // Origin doesn't send CORS — worker's fetch would fail. Pull
            // bytes through the main process (no CORS) and hand them to
            // the worker for decoding. Bytes are transferred (no copy).
            Native.fetchAsBytes(url).then(({ bytes, mime }) => {
                w.postMessage({ cmd: "preloadBytes", url, bytes, mime }, [bytes.buffer]);
            }).catch(err => {
                logger.warn(`[AEC] native fetch failed for ${url}`, err);
            });
        } else {
            w.postMessage({ cmd: "preload", url });
        }
    }

    dispose(): void {
        if (this.worker) {
            try { this.worker.postMessage({ cmd: "terminate" }); } catch { /* ignore */ }
            try { this.worker.terminate(); } catch { /* ignore */ }
            this.worker = null;
        }
        for (const bitmap of this.frames.values()) {
            try { bitmap.close(); } catch { /* ignore */ }
        }
        this.frames.clear();
        this.preloaded.clear();
        this.domIndex.dispose();
        if (this.workerUrl) {
            try { URL.revokeObjectURL(this.workerUrl); } catch { /* ignore */ }
            this.workerUrl = null;
        }
    }
}
