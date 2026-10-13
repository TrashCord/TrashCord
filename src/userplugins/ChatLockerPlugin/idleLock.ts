import { getCurrentId, hasPassword, isLocked, lock } from "./storage";
import { refreshOverlay } from "./overlayManager";
import { settings } from "./settings";

// Events that count as "user is present". Deliberately cheap listeners
// (passive, no per-event work beyond resetting a timeout).
const ACTIVITY_EVENTS = ["mousemove", "mousedown", "keydown", "wheel", "touchstart"] as const;

let timer: ReturnType<typeof setTimeout> | null = null;
let listening = false;

function unitToMs(value: number, unit: string): number {
    const n = Number(value) || 0;
    switch (unit) {
        case "hours": return n * 60 * 60 * 1000;
        case "minutes": return n * 60 * 1000;
        case "seconds":
        default: return n * 1000;
    }
}

function clearTimer() {
    if (timer) {
        clearTimeout(timer);
        timer = null;
    }
}

function scheduleTimer() {
    clearTimer();
    if (!settings.store.idleLockEnabled) return;

    const ms = unitToMs(settings.store.idleLockValue, settings.store.idleLockUnit);
    if (!ms || ms <= 0) return;

    timer = setTimeout(() => {
        const id = getCurrentId();
        if (id && hasPassword(id) && !isLocked(id)) {
            lock(id);
            refreshOverlay();
        }
        // Keep the cycle going so a channel that's re-unlocked (or a new
        // channel navigated to) still gets auto-locked after another idle period.
        scheduleTimer();
    }, ms);
}

function onActivity() {
    scheduleTimer();
}

export function startIdleWatcher() {
    if (listening) return;
    listening = true;
    ACTIVITY_EVENTS.forEach(evt => document.addEventListener(evt, onActivity, { passive: true }));
    scheduleTimer();
}

export function stopIdleWatcher() {
    listening = false;
    ACTIVITY_EVENTS.forEach(evt => document.removeEventListener(evt, onActivity));
    clearTimer();
}
