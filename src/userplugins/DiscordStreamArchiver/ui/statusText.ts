import type { SessionTrigger } from "../stores/sessionStore";

export interface StopConditionInput {
    trigger: SessionTrigger;
    continueAfterStreamEnds: boolean;
    conditionNames: string[];
    channelName: string;
    absenceTimeoutSeconds: number;
}

export function joinNames(names: string[]): string {
    if (names.length === 0) return "";
    if (names.length === 1) return names[0];
    return names.slice(0, -1).join(", ") + " and " + names[names.length - 1];
}

// One plain-language sentence for the info panel: why this is recording and
// what will make it stop.
export function describeStopCondition(input: StopConditionInput): string {
    switch (input.trigger) {
        case "channel":
            return `Recording because #${input.channelName} is whitelisted — records until you leave the call.`;
        case "user":
            return `Recording because a whitelisted user is in the call — stops about ${input.absenceTimeoutSeconds}s after the last one leaves.`;
        case "stream-anchor":
        case "stream-flag": {
            // Names live in the dedicated "Recording because of" row; keep the
            // sentence generic (just count) so it isn't buried mid-paragraph.
            const n = input.conditionNames.length;
            const base = n > 1 ? `Recording ${n} live streams` : "Recording a live stream";
            return input.continueAfterStreamEnds
                ? `${base} — keeps recording after ${n > 1 ? "the streams end" : "the stream ends"}.`
                : `${base} — stops when ${n > 1 ? "the last stream ends" : "the stream ends"}.`;
        }
        case "manual":
        default:
            return "Manual recording — records until you stop it or leave the call.";
    }
}

export function formatCaptureFps(s: { fpsMode: string; currentFps: number }): string {
    return s.fpsMode === "auto"
        ? `Auto — ${s.currentFps} fps`
        : `${s.fpsMode} fps (fixed)`;
}
