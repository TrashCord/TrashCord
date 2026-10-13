import { addContextMenuPatch } from "@api/ContextMenu";
import definePlugin from "@utils/types";
import { FluxDispatcher, Menu, React, UserStore } from "@webpack/common";

const WINDOW_MS = 8000;
const IDLE_RESET_MS = 3000;

let charTimestamps: number[] = [];
let lastLength = 0;
let idleTimeout: ReturnType<typeof setTimeout> | null = null;
let badge: HTMLDivElement | null = null;

// Map to store message ID -> calculated WPM
const msgWpmMap = new Map<string, number>();
let lastSentWpm: number | null = null;
let lastSentWpmTimeout: ReturnType<typeof setTimeout> | null = null;
let unpatchContextMenu: (() => void) | null = null;

function computeWpm(): number {
    const now = Date.now();
    charTimestamps = charTimestamps.filter(t => now - t <= WINDOW_MS);
    if (charTimestamps.length < 2) return 0;

    const first = charTimestamps[0];
    const last = charTimestamps[charTimestamps.length - 1];
    const elapsedMinutes = Math.max((last - first) / 60000, 1 / 60000);

    const wordsTyped = charTimestamps.length / 5;
    return Math.round(wordsTyped / elapsedMinutes);
}

function render() {
    if (!badge) return;
    const wpm = computeWpm();
    if (wpm > 0) {
        badge.textContent = `${wpm} WPM`;
        badge.style.display = "block";
    } else {
        badge.style.display = "none";
    }
}

function ensureBadgeMounted(textArea: HTMLElement) {
    if (badge && textArea.contains(badge)) return;

    if (getComputedStyle(textArea).position === "static") {
        textArea.style.position = "relative";
    }

    badge = document.createElement("div");
    badge.className = "vc-wpm-tracker-root";
    badge.style.position = "absolute";
    badge.style.left = "16px";
    badge.style.bottom = "calc(100% + 6px)";
    badge.style.color = "var(--text-muted)";
    badge.style.fontWeight = "600";
    badge.style.fontSize = "12px";
    badge.style.fontFamily = "var(--font-code, monospace)";
    badge.style.pointerEvents = "none";
    badge.style.userSelect = "none";
    badge.style.zIndex = "50";
    badge.style.display = "none";
    textArea.appendChild(badge);
}

function resetTracker() {
    charTimestamps = [];
    lastLength = 0;
    if (badge) render();
}

function scheduleIdleReset() {
    if (idleTimeout) clearTimeout(idleTimeout);
    idleTimeout = setTimeout(resetTracker, IDLE_RESET_MS);
}

function registerCharacterDelta(delta: number) {
    if (delta === 0) return;
    const now = Date.now();
    if (delta > 0) {
        for (let i = 0; i < delta; i++) charTimestamps.push(now);
    } else {
        charTimestamps.splice(charTimestamps.length + delta, -delta);
    }
    render();
    scheduleIdleReset();
}

const inputHandler = (e: Event) => {
    const target = e.target as HTMLElement | null;
    if (!target || target.getAttribute?.("data-slate-editor") !== "true") return;

    const textArea = target.closest('[class*="channelTextArea"]') as HTMLElement | null;
    if (!textArea) return;

    ensureBadgeMounted(textArea);

    const currentLength = (target.textContent ?? "").length;
    const delta = currentLength - lastLength;
    lastLength = currentLength;
    registerCharacterDelta(delta);
};

const keydownResetHandler = (e: KeyboardEvent) => {
    const target = e.target as HTMLElement | null;
    if (!target || target.getAttribute?.("data-slate-editor") !== "true") return;

    if (e.key === "Enter" && !e.shiftKey) {
        const finalWpm = computeWpm();
        if (finalWpm > 0) {
            lastSentWpm = finalWpm;
            if (lastSentWpmTimeout) clearTimeout(lastSentWpmTimeout);
            // Expire pending WPM after 10s if Discord fails to dispatch MESSAGE_CREATE
            lastSentWpmTimeout = setTimeout(() => {
                lastSentWpm = null;
            }, 10000);
        }
        resetTracker();
    }
};

function onMessageCreate({ message }: { message: any }) {
    // Check if the created message was sent by you and we have a cached WPM
    if (lastSentWpm !== null && message?.author?.id === UserStore.getCurrentUser()?.id) {
        msgWpmMap.set(message.id, lastSentWpm);
        lastSentWpm = null;
        if (lastSentWpmTimeout) {
            clearTimeout(lastSentWpmTimeout);
            lastSentWpmTimeout = null;
        }
    }
}

export default definePlugin({
    name: "WPMTracker",
    description: "Shows live typing speed above chat and lets you view your WPM on right-clicked messages.",
    authors: [{ name: "Your Name", id: 0n }],
    tags: ["Chat", "Utility", "Fun"],
    enabledByDefault: false,
    start() {
        document.addEventListener("input", inputHandler, true);
        document.addEventListener("keydown", keydownResetHandler, true);

        // Listen for sent messages
        FluxDispatcher.subscribe("MESSAGE_CREATE", onMessageCreate);

        // Inject custom entry into the message right-click context menu
        unpatchContextMenu = addContextMenuPatch("message", (children, { message }) => {
            if (!message || message.author?.id !== UserStore.getCurrentUser()?.id) return;

            const wpm = msgWpmMap.get(message.id);
            if (wpm !== undefined) {
                children.push(
                    React.createElement(Menu.MenuItem, {
                        id: "vc-wpm-info",
                        label: `Typing Speed: ${wpm} WPM`,
                        action: () => {}
                    })
                );
            }
        });
    },

    stop() {
        document.removeEventListener("input", inputHandler, true);
        document.removeEventListener("keydown", keydownResetHandler, true);

        FluxDispatcher.unsubscribe("MESSAGE_CREATE", onMessageCreate);

        if (unpatchContextMenu) {
            unpatchContextMenu();
            unpatchContextMenu = null;
        }

        if (idleTimeout) clearTimeout(idleTimeout);
        if (lastSentWpmTimeout) clearTimeout(lastSentWpmTimeout);

        if (badge) {
            badge.remove();
            badge = null;
        }

        charTimestamps = [];
        lastLength = 0;
        msgWpmMap.clear();
        lastSentWpm = null;
    }
});