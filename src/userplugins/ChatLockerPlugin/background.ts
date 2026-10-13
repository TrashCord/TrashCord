import { settings } from "./settings";

// Cache of which background URL is currently "showing" for each locked
// channel. Populated by rerollBackground(), which is called from
// storage.ts's lock() -- i.e. exactly when a chat "becomes" locked.
const picked = new Map<string, string>();

function parseUrls(raw: string): string[] {
    return (raw || "")
        .split(/[\n,]/)
        .map(s => s.trim())
        .filter(Boolean);
}

/**
 * Choose (and cache) the background to show for this channel's lock
 * screen. Called whenever a channel transitions to locked.
 */
export function rerollBackground(id: string) {
    const urls = parseUrls(settings.store.backgroundImage);

    if (urls.length === 0) {
        picked.delete(id);
        return;
    }

    if (urls.length === 1 || !settings.store.shuffleBackground) {
        picked.set(id, urls[0]);
        return;
    }

    // Multiple URLs + shuffle enabled: pick at random, avoiding an
    // immediate repeat of whatever was showing last time so it actually
    // feels like it "shuffled".
    const previous = picked.get(id);
    const candidates = previous ? urls.filter(u => u !== previous) : urls;
    const pool = candidates.length > 0 ? candidates : urls;
    picked.set(id, pool[Math.floor(Math.random() * pool.length)]);
}

/** The currently-cached background URL for this channel, if any. */
export function getBackgroundFor(id: string): string {
    return picked.get(id) ?? "";
}
