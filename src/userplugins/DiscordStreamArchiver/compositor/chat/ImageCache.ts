export type LoadedImage = HTMLImageElement;

const MAX_ENTRIES = 500;
const CONTAINER_ID = "dsa-image-cache-container";

// Failed-load retry policy. A transient network blip on an avatar/emote/react
// fetch must not leave that image permanently blank: we back off exponentially
// (so a genuinely dead URL isn't hammered) but always allow a later retry,
// driven by the render path calling get() again.
const RETRY_BASE_MS = 4000;
const RETRY_MAX_MS = 60000;
// Cap the failure bookkeeping so a long session touching many dead URLs can't
// grow these maps without bound.
const MAX_FAILED_TRACKED = 1000;

// Shared hidden container for every ImageCache's HTMLImageElement instances.
// `transform:scale(0)` keeps the element painted at compositor level (so the
// image decoder keeps ticking, which matters for DOM-driven fallback of
// animated images when AnimatedEmoteCache can't fetch/decode) while making
// the element visually zero-sized. This is the state that was correlated
// with "animations work" in prior testing.
function getContainer(): HTMLElement {
    const existing = document.getElementById(CONTAINER_ID);
    if (existing) return existing;
    const el = document.createElement("div");
    el.id = CONTAINER_ID;
    el.style.cssText = "position:fixed;top:0;left:0;pointer-events:none;z-index:-9999;transform:scale(0);transform-origin:0 0;";
    document.body.appendChild(el);
    return el;
}

// LRU image cache shared by chat panel renderers. One in-flight promise per
// URL deduplicates concurrent requests. When an image finishes loading the
// owning renderer's dirty flag is flipped via `onLoaded`.
export class ImageCache {
    private cache = new Map<string, LoadedImage>();
    private inflight = new Map<string, Promise<LoadedImage | null>>();
    // url -> epoch ms before which we won't re-attempt a failed load, and the
    // consecutive failure count that drives the exponential backoff.
    private failedUntil = new Map<string, number>();
    private failAttempts = new Map<string, number>();
    private container = getContainer();
    private disposed = false;

    // maxEntries lets callers size the LRU to the media class it holds. High-
    // churn, low-reuse media (attachments, embed images) and small, bounded,
    // high-reuse media (avatars) should NOT share one cache — attachment churn
    // would otherwise evict avatars that are about to be re-rendered.
    constructor(private readonly onLoaded: () => void, private readonly maxEntries: number = MAX_ENTRIES) {}

    get(url: string): LoadedImage | null {
        const v = this.cache.get(url);
        if (v) {
            // Re-insert to mark as most-recently-used (Map preserves insertion order).
            this.cache.delete(url);
            this.cache.set(url, v);
            return v;
        }
        // Self-heal: the renderer wants this image but it isn't loaded — it
        // either never was, a previous load failed (transient network blip),
        // or the LRU evicted it. Kick a de-duplicated, backoff-guarded load so
        // a later frame can draw it. Without this a one-off failure left the
        // avatar/emote/react permanently blank, because preload() otherwise
        // only runs once at message-push time.
        this.preload(url);
        return null;
    }

    preload(url: string): void {
        if (this.disposed) return;
        if (!url) return;
        if (this.cache.has(url)) return;
        if (this.inflight.has(url)) return;
        const retryAt = this.failedUntil.get(url);
        if (retryAt !== undefined && Date.now() < retryAt) return;
        const p = this.doLoad(url);
        this.inflight.set(url, p);
        p.finally(() => this.inflight.delete(url));
    }

    private async doLoad(url: string): Promise<LoadedImage | null> {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.style.cssText = "position:absolute;top:0;left:0;width:auto;height:auto;";
        this.container.appendChild(img);
        try {
            await new Promise<void>((resolve, reject) => {
                img.onload = () => resolve();
                img.onerror = () => reject(new Error("image load failed: " + url));
                img.src = url;
            });
            // If the cache was disposed while this load was in flight, drop the
            // freshly-loaded <img> instead of leaking it into the shared
            // container (it would otherwise outlive the session).
            if (this.disposed) {
                try { img.remove(); } catch { /* ignore */ }
                return null;
            }
            // Clear any prior failure record now that it loaded cleanly.
            this.failedUntil.delete(url);
            this.failAttempts.delete(url);
            this.setAndEvict(url, img);
            this.onLoaded();
            return img;
        } catch {
            try { img.remove(); } catch { /* ignore */ }
            this.recordFailure(url);
            return null;
        }
    }

    private recordFailure(url: string): void {
        const n = (this.failAttempts.get(url) ?? 0) + 1;
        this.failAttempts.set(url, n);
        const backoff = Math.min(RETRY_BASE_MS * 2 ** (n - 1), RETRY_MAX_MS);
        this.failedUntil.set(url, Date.now() + backoff);
        if (this.failedUntil.size > MAX_FAILED_TRACKED) {
            const oldest = this.failedUntil.keys().next().value as string | undefined;
            if (oldest !== undefined) {
                this.failedUntil.delete(oldest);
                this.failAttempts.delete(oldest);
            }
        }
    }

    private setAndEvict(url: string, img: LoadedImage): void {
        this.cache.set(url, img);
        while (this.cache.size > this.maxEntries) {
            const oldestKey = this.cache.keys().next().value as string | undefined;
            if (oldestKey === undefined) break;
            const oldestImg = this.cache.get(oldestKey);
            this.cache.delete(oldestKey);
            if (oldestImg) {
                try { oldestImg.remove(); } catch { /* ignore */ }
            }
        }
    }

    // Remove every <img> this cache put in the shared DOM container and stop
    // accepting new loads. Without this the elements (and their decoded
    // bitmaps) accumulate across sessions and progressively load the
    // compositor — call from the owning renderer's dispose().
    dispose(): void {
        this.disposed = true;
        for (const img of this.cache.values()) {
            try { img.remove(); } catch { /* ignore */ }
        }
        this.cache.clear();
        this.inflight.clear();
        this.failedUntil.clear();
        this.failAttempts.clear();
    }
}
