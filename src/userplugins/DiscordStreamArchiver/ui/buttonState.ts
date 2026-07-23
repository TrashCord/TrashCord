import type { SessionTrigger } from "../stores/sessionStore";

// A session is "conditional" (yellow button) when an automatic rule could stop
// it earlier than a manual stop / leaving the call. Unconditional (red) means
// it records until the user stops it or leaves the VC.
export function isConditionalSession(input: { trigger: SessionTrigger; continueAfterStreamEnds: boolean }): boolean {
    switch (input.trigger) {
        case "user":
            return true; // absence timer can stop it
        case "stream-anchor":
        case "stream-flag":
            return !input.continueAfterStreamEnds; // stops when the stream(s) end
        case "manual":
        case "channel":
        default:
            return false; // records until manual stop / leave
    }
}
