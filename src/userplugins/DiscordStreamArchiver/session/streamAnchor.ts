import type { SessionTrigger } from "../stores/sessionStore";

export interface AnchorDrainInput {
    trigger: SessionTrigger;
    anchorCount: number;          // size of the anchor set AFTER removing the ended stream
    continueAfterStreamEnds: boolean;
}

// Should an anchored session stop now that one of its anchor streams ended?
// Only stream-anchored sessions ("Record this stream" and flagged-streamer
// auto-records) stop on anchor drain, and only when no anchors remain and the
// user hasn't asked to keep recording past stream end.
export function shouldStopAfterAnchorDrain(input: AnchorDrainInput): boolean {
    if (input.trigger !== "stream-anchor" && input.trigger !== "stream-flag") return false;
    if (input.continueAfterStreamEnds) return false;
    return input.anchorCount === 0;
}
