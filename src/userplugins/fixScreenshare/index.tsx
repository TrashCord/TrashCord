import definePlugin from "@utils/types";
import { findByPropsLazy } from "@webpack";
import { FluxDispatcher } from "@webpack/common";

const MediaEngineStore = findByPropsLazy("getMediaEngine");

let pollInterval: ReturnType<typeof setInterval> | null = null;

function tryFixEngine(): boolean {
    try {
        const engine = MediaEngineStore.getMediaEngine();
        if (!engine || typeof engine.reconfigure !== "function") return false;
        engine.reconfigure();
        return true;
    } catch {
        return false;
    }
}

function fixEngineWhenReady() {
    if (pollInterval) clearInterval(pollInterval);
    if (tryFixEngine()) return;
    let attempts = 0;
    pollInterval = setInterval(() => {
        attempts++;
        if (tryFixEngine() || attempts >= 10) {
            clearInterval(pollInterval!);
            pollInterval = null;
        }
    }, 500);
}

function handleVoiceChannelSelect() {
    fixEngineWhenReady();
}

export default definePlugin({
    name: "FixScreenshare",
    description: "Fixes infinite loading and crashes on screenshare after reload (Ctrl+R) by forcing module re-initialization.",
    authors: [{ name: "Nightcord", id: 0n }],
    tags: ["Voice", "Utility"],
    enabledByDefault: false,

    start() {
        fixEngineWhenReady();
        FluxDispatcher.subscribe("VOICE_CHANNEL_SELECT", handleVoiceChannelSelect);
    },

    stop() {
        FluxDispatcher.unsubscribe("VOICE_CHANNEL_SELECT", handleVoiceChannelSelect);
        if (pollInterval) {
            clearInterval(pollInterval);
            pollInterval = null;
        }
    }
});