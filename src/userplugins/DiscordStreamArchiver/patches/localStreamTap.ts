// Captures YOUR OWN outbound screenshare on Vesktop / web.
//
// Remote participants' streams reach us through Discord's inbound Output class,
// which webAudioTap hooks. Your own stream never goes through that class — it's
// captured locally and sent outbound — so the self-tile would otherwise stay
// blank. On Vesktop/web Discord obtains your screen as a normal MediaStream via
// navigator.mediaDevices.getDisplayMedia (Vesktop patches it to use its own
// source picker, but the JS call still happens). We decorate getDisplayMedia,
// remember the returned stream as the "self share stream", and hand it to the
// session through getLocalShareStream()/getLocalShareAudioStream().
//
// Deliberately NOT registered into the webAudioTap registry: that would make
// StreamTap/addStream pick it up too and mix your broadcast audio twice. The
// session reads it via a dep instead, keeping a single source.
//
// Native Discord Desktop captures the screen in C++ with no JS MediaStream, so
// install() is a no-op there (same wall as loopback audio).

import { logger } from "../utils";
import { notifyTapChange } from "./webAudioTap";

let installed = false;
let original: ((constraints?: any) => Promise<MediaStream>) | null = null;
// Incremented by callers (LoopbackAudio) that invoke getDisplayMedia themselves
// so we don't adopt their stream as a screenshare.
let ignoreCount = 0;

let shareStream: MediaStream | null = null;   // full local stream (video [+audio])
let shareAudio: MediaStream | null = null;    // stable audio-only view for the mixer

// Pure decision: adopt a getDisplayMedia result as the self screenshare iff it
// wasn't a self-initiated (ignored) call and it actually carries video.
export function shouldAdoptDisplayStream(stream: MediaStream | null, ignore: boolean): boolean {
    if (ignore) return false;
    if (!stream) return false;
    return stream.getVideoTracks().length > 0;
}

export function ignoreNextSelfDisplayCapture(): void {
    ignoreCount++;
}

export function getLocalShareStream(): MediaStream | null {
    return shareStream;
}

export function getLocalShareAudioStream(): MediaStream | null {
    return shareAudio;
}

function release(): void {
    if (!shareStream && !shareAudio) return;
    shareStream = null;
    shareAudio = null;
    notifyTapChange();
}

function adopt(stream: MediaStream): void {
    shareStream = stream;
    const audioTracks = stream.getAudioTracks();
    shareAudio = audioTracks.length ? new MediaStream(audioTracks) : null;
    // Drop the capture when you stop sharing (Discord ends the video track).
    for (const track of stream.getVideoTracks()) {
        track.addEventListener("ended", () => {
            if (shareStream === stream) release();
        });
    }
    logger.info(`localStreamTap: adopted self share stream (video=${stream.getVideoTracks().length} audio=${audioTracks.length})`);
    notifyTapChange();
}

export function installLocalStreamTap(): void {
    if (installed) return;
    if (IS_DISCORD_DESKTOP) return; // native capture — no JS MediaStream to tap
    const md = navigator.mediaDevices as any;
    if (!md || typeof md.getDisplayMedia !== "function") {
        logger.warn("localStreamTap: getDisplayMedia unavailable; own stream won't be captured");
        return;
    }
    original = md.getDisplayMedia.bind(md);
    md.getDisplayMedia = function (constraints?: any) {
        const ignore = ignoreCount > 0;
        if (ignore) ignoreCount--;
        const p = original!(constraints);
        p.then((stream: MediaStream) => {
            if (shouldAdoptDisplayStream(stream, ignore)) adopt(stream);
        }).catch(() => { /* cancelled / error — nothing to adopt */ });
        return p;
    };
    installed = true;
    logger.info("localStreamTap installed (wrapping getDisplayMedia)");
}

export function uninstallLocalStreamTap(): void {
    if (!installed) return;
    const md = navigator.mediaDevices as any;
    if (original && md) md.getDisplayMedia = original;
    original = null;
    installed = false;
    release();
}
