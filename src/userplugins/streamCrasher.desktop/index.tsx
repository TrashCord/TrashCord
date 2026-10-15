import type { NavContextMenuPatchCallback } from "@api/ContextMenu";
import { definePluginSettings } from "@api/Settings";
import { UserAreaButton } from "@api/UserArea";
import ErrorBoundary from "@components/ErrorBoundary";
import { openPluginModal } from "@components/settings";
import definePlugin, { OptionType, type PluginNative } from "@utils/types";
import { findByPropsLazy, findStoreLazy } from "@webpack";
import { Menu, Popout, Select, SelectedChannelStore, showToast, useEffect, useRef, useState, useStateFromStores } from "@webpack/common";

declare const MediaStreamTrackProcessor: any;
declare const MediaStreamTrackGenerator: any;

const Native = VencordNative.pluginHelpers.CamCrasher as PluginNative<typeof import("./native")>;
const MediaEngineStore = findStoreLazy("MediaEngineStore");
const MediaEngineActions = findByPropsLazy("setVideoDevice");

const BUTTON_ID = "cam-crasher-account-button";

export const crashModeLabels: Record<string, { value: string; subText?: string; }> = {
    freeze: { value: "Freeze", subText: "Freezes the camera" },
    flashing: { value: "Flashing", subText: "Looping black/white flash" },
    white: { value: "White Screen" },
    colors: { value: "Color Cycle", subText: "Looping rainbow cycle" },
    static: { value: "Static", subText: "TV Noise" },
    bsod: { value: "Crash Screen", subText: "OS-specific BSOD" },
    image: { value: "Image", subText: "PNG/JPG/WebP, URL or local path" }
};

let crashed = false;
let modeCache = "freeze";
let suppress = false;
let previousDevice: string | null = null;
let fallbackUsed = false;
let lastSwitchAt = 0;
let lastFire = 0;
let originalGetUserMedia: any = null;
let restorers: Array<() => void> = [];
let imageBitmap: ImageBitmap | null = null;
let imageVersion = 0;
let imageToken = 0;
let drawnKey = "";

const wrapped = new WeakSet<object>();
const sent = new Set<object>();
const listeners = new Set<() => void>();

function emit() {
    listeners.forEach(fn => fn());
}

function useCamState() {
    const [, setTick] = useState(0);
    useEffect(() => {
        const fn = () => setTick(n => n + 1);
        listeners.add(fn);
        return () => void listeners.delete(fn);
    }, []);
    return { switched: previousDevice !== null };
}

function inCall() {
    return !!SelectedChannelStore.getVoiceChannelId();
}

function videoOn() {
    return MediaEngineStore.isVideoEnabled?.() ?? true;
}

function listDevices(): any[] {
    return Object.values<any>(MediaEngineStore.getVideoDevices?.() ?? {});
}

function safeName() {
    return (settings.store.manualCamera || settings.store.safeCameraName || "").trim();
}

async function registerKeybind(accelerator: string) {
    const ok = await Native.registerKeybind(accelerator || "F7");
    if (!ok) showToast("Keybind unavailable, pick another one", "failure");
}

function playToggleSound(enabled: boolean) {
    if (!settings.store.soundEnabled || suppress) return;
    try {
        const ctx = new AudioContext({ sinkId: "communications" } as any);
        const play = () => {
            const t = ctx.currentTime;
            const gain = ctx.createGain();
            gain.connect(ctx.destination);

            if (enabled) {
                const len = Math.floor(ctx.sampleRate * 0.028);
                const buf = ctx.createBuffer(1, len, ctx.sampleRate);
                const data = buf.getChannelData(0);
                for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);

                const filter = ctx.createBiquadFilter();
                filter.type = "highpass";
                filter.frequency.value = 2400;
                filter.connect(gain);
                gain.gain.value = 0.06;

                const first = ctx.createBufferSource();
                const second = ctx.createBufferSource();
                first.buffer = buf;
                second.buffer = buf;
                first.connect(filter);
                second.connect(filter);
                first.start(t);
                second.start(t + 0.085);
                second.onended = () => ctx.close();
            } else {
                const osc = ctx.createOscillator();
                osc.type = "sine";
                osc.frequency.setValueAtTime(210, t);
                osc.frequency.exponentialRampToValueAtTime(70, t + 0.13);
                gain.gain.setValueAtTime(0.08, t);
                gain.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
                osc.connect(gain);
                osc.start(t);
                osc.stop(t + 0.16);
                osc.onended = () => ctx.close();
            }
        };
        if (ctx.state === "suspended") ctx.resume().then(play).catch(() => ctx.close());
        else play();
    } catch { }
}

function StatusPanel() {
    const { isEnabled } = settings.use(["isEnabled"]);
    const { switched } = useCamState();
    const active = useStateFromStores([MediaEngineStore, SelectedChannelStore], () => inCall() && videoOn());

    const path = !active
        ? "No active camera"
        : sent.size > 0
            ? "Hooked (all crash modes work)"
            : "Native (uses the safe camera)";

    return (
        <div className="vc-cc-panel">
            <div className="vc-cc-row">
                <span className={`vc-cc-dot${isEnabled || switched ? " on" : ""}`} />
                <span className="vc-cc-title">{isEnabled || switched ? "Protection active" : "Protection idle"}</span>
                <button type="button" className="vc-cc-btn" onClick={panic}>
                    {isEnabled || switched ? "Restore" : "Test"}
                </button>
            </div>
            <div className="vc-cc-sub">Camera path: {path}</div>
        </div>
    );
}

function SafeCameraPicker() {
    const { safeCameraName } = settings.use(["safeCameraName"]);
    const devices = useStateFromStores([MediaEngineStore], () => MediaEngineStore.getVideoDevices?.());
    const options = Object.values<any>(devices ?? {}).map(d => ({ label: d.name, value: d.name }));

    return (
        <div className="vc-cc-field">
            <div className="vc-cc-label">Safe Camera</div>
            <Select
                options={options}
                placeholder="Select a detected camera"
                isSelected={(v: string) => v === safeCameraName}
                select={(v: string) => {
                    settings.store.safeCameraName = v;
                    settings.store.manualCamera = "";
                }}
                serialize={(v: string) => v}
            />
            <div className="vc-cc-sub">Used by Switch and by the native fallback. Type a name below to override.</div>
        </div>
    );
}

export const settings = definePluginSettings({
    status: {
        type: OptionType.COMPONENT,
        component: StatusPanel
    },
    panicAction: {
        type: OptionType.SELECT,
        description: "What the button and the keybind do",
        options: [
            { label: "Crash Camera", value: "crash", default: true },
            { label: "Switch to Safe Camera", value: "switch" }
        ]
    },
    crashMode: {
        type: OptionType.SELECT,
        description: "What viewers see when the crasher is active",
        options: Object.entries(crashModeLabels).map(([value, { value: label, subText }], i) => ({
            label, value, subtext: subText, default: i === 0
        })),
        onChange: val => {
            modeCache = val;
            drawnKey = "";
            refreshImage();
        }
    },
    imageUrl: {
        type: OptionType.STRING,
        description: "Image URL or local path (e.g. C:\\img.png or https://...)",
        default: "",
        placeholder: "https://example.com/image.png",
        componentProps: { onBlur: () => refreshImage() },
        hidden() { return this.store.crashMode !== "image"; }
    },
    safeCameraName: {
        type: OptionType.COMPONENT,
        component: SafeCameraPicker
    },
    manualCamera: {
        type: OptionType.STRING,
        description: "Safe camera name typed manually (overrides the detected one, partial match)",
        default: "",
        placeholder: "OBS Virtual Camera"
    },
    fallbackSwitch: {
        type: OptionType.BOOLEAN,
        description: "Native camera fallback: when the crasher cannot hook the camera, switch to the safe camera instead of leaving it exposed",
        default: true
    },
    hookStream: {
        type: OptionType.BOOLEAN,
        description: "Hook camera streams for freeze and crash modes (applies the next time the camera starts)",
        default: true
    },
    buttonLocation: {
        type: OptionType.SELECT,
        description: "Where to place the crasher button (applies instantly, no restart)",
        options: [
            { label: "Hidden (camera context menu / keybind only)", value: "none", default: true },
            { label: "Account Section", value: "account" }
        ]
    },
    keybindEnabled: {
        type: OptionType.BOOLEAN,
        description: "Global keybind (works even when Discord is not focused)",
        default: true,
        onChange: val => {
            if (val) registerKeybind(settings.store.keybind);
            else Native.unregisterKeybind();
        }
    },
    keybind: {
        type: OptionType.STRING,
        description: "Keybind accelerator. Use 'Set Keybind' in the camera context menu to record it, or type one (e.g. F7, Control+F3)",
        default: "F7",
        onChange: val => { if (settings.store.keybindEnabled) registerKeybind(val); }
    },
    soundEnabled: {
        type: OptionType.BOOLEAN,
        description: "Play a sound when the crasher is toggled",
        default: true
    },
    autoDisableOnCamera: {
        type: OptionType.BOOLEAN,
        description: "Disable the crasher when the camera is turned on or off, or when you change voice channel",
        default: true
    },
    isEnabled: {
        type: OptionType.BOOLEAN,
        description: "Crashing state",
        default: false,
        hidden: true,
        onChange: val => applyCrash(val)
    }
});

async function refreshImage() {
    const token = ++imageToken;
    imageBitmap?.close();
    imageBitmap = null;
    imageVersion++;
    const mode = settings.store.crashMode;
    if (mode !== "image" && mode !== "bsod") return;
    const source = mode === "bsod" ? "@bsod" : (settings.store.imageUrl || "").trim();
    if (!source) return;

    const uri = await Native.loadImage(source);
    if (!uri || token !== imageToken) return;

    try {
        const mime = uri.slice(5, uri.indexOf(";"));
        const bin = atob(uri.slice(uri.indexOf(",") + 1));
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        const bmp = await createImageBitmap(new Blob([bytes], { type: mime }));
        if (token !== imageToken) { bmp.close(); return; }
        imageBitmap = bmp;
        imageVersion++;
    } catch { }
}

const canvas = new OffscreenCanvas(640, 360);
const ctx = canvas.getContext("2d", { alpha: false })!;
const noiseCanvas = new OffscreenCanvas(128, 72);
const noiseCtx = noiseCanvas.getContext("2d", { alpha: false })!;
const noiseImage = noiseCtx.createImageData(128, 72);
const COLORS = ["#f00", "#ff8000", "#ff0", "#0f0", "#0ff", "#00f"];

function renderContent(w: number, h: number): string {
    const ch = w > 0 && h > 0 ? Math.max(2, Math.round((640 * h / w) / 2) * 2) : 360;
    const t = Date.now();
    const phase = modeCache === "flashing" ? Math.floor(t / 120) % 2
        : modeCache === "colors" ? Math.floor(t / 200) % 6
            : modeCache === "static" ? Math.floor(t / 130)
                : 0;
    const key = `${modeCache}:${phase}:${imageVersion}:${ch}`;
    if (key === drawnKey) return key;
    drawnKey = key;

    if (canvas.height !== ch) canvas.height = ch;
    const W = canvas.width;
    const H = canvas.height;

    switch (modeCache) {
        case "white":
            ctx.fillStyle = "#fff";
            ctx.fillRect(0, 0, W, H);
            break;
        case "flashing":
            ctx.fillStyle = phase ? "#fff" : "#000";
            ctx.fillRect(0, 0, W, H);
            break;
        case "colors":
            ctx.fillStyle = COLORS[phase];
            ctx.fillRect(0, 0, W, H);
            break;
        case "static": {
            const d = noiseImage.data;
            for (let i = 0; i < d.length; i += 4) {
                const v = Math.random() * 255 | 0;
                d[i] = d[i + 1] = d[i + 2] = v;
                d[i + 3] = 255;
            }
            noiseCtx.putImageData(noiseImage, 0, 0);
            ctx.imageSmoothingEnabled = false;
            ctx.drawImage(noiseCanvas, 0, 0, W, H);
            break;
        }
        case "image":
        case "bsod":
            if (imageBitmap) {
                ctx.drawImage(imageBitmap, 0, 0, W, H);
                break;
            }
        default:
            ctx.fillStyle = "#000";
            ctx.fillRect(0, 0, W, H);
    }
    return key;
}

function wrapStream(stream: MediaStream): MediaStream {
    const [track] = stream.getVideoTracks();
    if (!track || track.getSettings().displaySurface) return stream;

    const processor = new MediaStreamTrackProcessor({ track });
    const generator = new MediaStreamTrackGenerator({ kind: "video" });
    wrapped.add(generator);

    let last: VideoFrame | null = null;
    let cached: VideoFrame | null = null;
    let cachedKey = "";

    processor.readable
        .pipeThrough(new TransformStream<VideoFrame, VideoFrame>({
            transform(frame, controller) {
                if (!crashed) {
                    if (cached) { cached.close(); cached = null; cachedKey = ""; }
                    if (modeCache === "freeze") {
                        last?.close();
                        last = frame.clone();
                    } else if (last) {
                        last.close();
                        last = null;
                    }
                    controller.enqueue(frame);
                    return;
                }

                const ts = frame.timestamp;

                if (modeCache === "freeze") {
                    if (!last) {
                        last = frame.clone();
                        controller.enqueue(frame);
                        return;
                    }
                    frame.close();
                    controller.enqueue(new VideoFrame(last, { timestamp: ts }));
                    return;
                }

                const key = renderContent(frame.displayWidth, frame.displayHeight);
                frame.close();
                if (!cached || key !== cachedKey) {
                    cached?.close();
                    cached = new VideoFrame(canvas, { timestamp: ts });
                    cachedKey = key;
                }
                controller.enqueue(new VideoFrame(cached, { timestamp: ts }));
            },
            flush() {
                last?.close();
                cached?.close();
                last = null;
                cached = null;
            }
        }))
        .pipeTo(generator.writable)
        .catch(() => { });

    const stop = generator.stop.bind(generator);
    generator.stop = () => {
        if (sent.delete(generator)) emit();
        track.stop();
        stop();
    };

    const cloneTrack = generator.clone?.bind(generator);
    if (cloneTrack) {
        generator.clone = () => {
            const copy = cloneTrack();
            wrapped.add(copy);
            return copy;
        };
    }

    return new MediaStream([generator, ...stream.getAudioTracks()]);
}

function hook(proto: any, key: string) {
    const original = proto?.[key];
    if (typeof original !== "function") return;
    proto[key] = function (this: any, ...args: any[]) {
        const t = args[0];
        if (t && typeof t === "object" && wrapped.has(t) && !sent.has(t)) {
            sent.add(t);
            emit();
        }
        return original.apply(this, args);
    };
    restorers.push(() => { proto[key] = original; });
}

function installCapture() {
    if (originalGetUserMedia || typeof MediaStreamTrackProcessor === "undefined") return;
    const md = navigator.mediaDevices as any;
    originalGetUserMedia = md.getUserMedia;
    md.getUserMedia = async function (constraints?: MediaStreamConstraints) {
        const stream = await originalGetUserMedia.call(md, constraints);
        const video = constraints?.video;
        if (!settings.store.hookStream || !video || (typeof video === "object" && (video as any).mandatory)) return stream;
        try { return wrapStream(stream); } catch { return stream; }
    };
    hook(window.RTCPeerConnection?.prototype, "addTrack");
    hook(window.RTCPeerConnection?.prototype, "addTransceiver");
    hook(window.RTCRtpSender?.prototype, "replaceTrack");
}

function uninstallCapture() {
    if (!originalGetUserMedia) return;
    delete (navigator.mediaDevices as any).getUserMedia;
    originalGetUserMedia = null;
    restorers.forEach(fn => fn());
    restorers = [];
    sent.clear();
}

function pickSafeDevice(current: string | undefined) {
    const needle = (safeName() || "virtual").toLowerCase();
    return listDevices().find(d => d.id !== current && (d.id === needle || d.name?.toLowerCase().includes(needle)));
}

function switchCamera(): boolean {
    const current = MediaEngineStore.getVideoDeviceId?.();
    const target = pickSafeDevice(current);
    if (!target) {
        showToast("Safe camera not found. Pick one in the camera menu or type it in settings", "failure");
        return false;
    }
    previousDevice = current ?? "";
    lastSwitchAt = Date.now();
    MediaEngineActions.setVideoDevice(target.id);
    emit();
    return true;
}

function restoreCamera() {
    const id = previousDevice;
    previousDevice = null;
    fallbackUsed = false;
    if (id) {
        lastSwitchAt = Date.now();
        MediaEngineActions.setVideoDevice(id);
    }
    emit();
}

function toggleSwitch() {
    if (previousDevice !== null) restoreCamera();
    else switchCamera();
}

function applyCrash(val: boolean) {
    crashed = val;
    drawnKey = "";
    playToggleSound(val);

    if (val) {
        if (!suppress && inCall() && videoOn()) {
            if (sent.size > 0) {
                showToast("Crasher on, camera hooked", "success");
            } else if (!settings.store.fallbackSwitch) {
                showToast("Native camera: crasher cannot hook it, use Switch to Safe Camera", "failure");
            } else if (previousDevice !== null) {
                fallbackUsed = true;
            } else if (switchCamera()) {
                fallbackUsed = true;
                showToast("Native camera: switched to safe camera", "success");
            }
        }
    } else if (fallbackUsed && previousDevice !== null) {
        restoreCamera();
    }
    emit();
}

function setCrash(on: boolean) {
    settings.store.isEnabled = on;
}

function panic() {
    if (crashed || previousDevice !== null) {
        if (crashed) setCrash(false);
        if (previousDevice !== null) restoreCamera();
        return;
    }
    if (settings.store.panicAction === "switch") switchCamera();
    else setCrash(true);
}

function onVideoToggle() {
    if (!settings.store.autoDisableOnCamera || !crashed) return;
    if (Date.now() - lastSwitchAt < 1500) return;
    suppress = true;
    settings.store.isEnabled = false;
    suppress = false;
}

const CamIcon = ({ active }: { active: boolean; }) => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
        <path
            fill={active ? "var(--status-danger)" : "currentColor"}
            fillRule="evenodd"
            clipRule="evenodd"
            d={active
                ? "M4 5h9.5A3.5 3.5 0 0 1 17 8.5v7a3.5 3.5 0 0 1-3.5 3.5H4A3.5 3.5 0 0 1 .5 15.5v-7A3.5 3.5 0 0 1 4 5zM9.7 8 6.5 12.5h2.3L8 16l3.5-4.6H9.2z"
                : "M4 5h9.5A3.5 3.5 0 0 1 17 8.5v7a3.5 3.5 0 0 1-3.5 3.5H4A3.5 3.5 0 0 1 .5 15.5v-7A3.5 3.5 0 0 1 4 5zM8.75 9.4a2.6 2.6 0 1 0 0 5.2 2.6 2.6 0 0 0 0-5.2z"}
        />
        <path
            fill={active ? "var(--status-danger)" : "currentColor"}
            d="M18.5 10.4l3-1.9a.9.9 0 0 1 1.4.77v5.46a.9.9 0 0 1-1.4.77l-3-1.9z"
        />
    </svg>
);

const SettingsIcon = () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
        <path d="M19.14 12.94a7.07 7.07 0 0 0 0-1.88l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.49.49 0 0 0-.59-.22l-2.39.96a7.04 7.04 0 0 0-1.62-.94l-.36-2.54a.48.48 0 0 0-.48-.41h-3.84a.48.48 0 0 0-.48.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96a.49.49 0 0 0-.59.22L2.74 8.87a.48.48 0 0 0 .12.61l2.03 1.58a7.07 7.07 0 0 0 0 1.88l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.49.37 1.03.7 1.62.94l.36 2.54c.05.24.26.41.48.41h3.84c.22 0 .43-.17.48-.41l.36-2.54c.59-.24 1.13-.57 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32a.49.49 0 0 0-.12-.61l-2.03-1.58zM12 15.6A3.6 3.6 0 1 1 15.6 12 3.6 3.6 0 0 1 12 15.6z" />
    </svg>
);

const CODE_TO_ELECTRON: Record<string, string> = {
    Space: "Space", Enter: "Return", Escape: "Escape",
    Tab: "Tab", Backspace: "Backspace", Delete: "Delete",
    Insert: "Insert", Home: "Home", End: "End",
    PageUp: "PageUp", PageDown: "PageDown",
    ArrowUp: "Up", ArrowDown: "Down", ArrowLeft: "Left", ArrowRight: "Right",
    PrintScreen: "PrintScreen",
    Minus: "-", Equal: "=", BracketLeft: "[", BracketRight: "]",
    Backslash: "\\", Semicolon: ";", Quote: "'",
    Comma: ",", Period: "."
};

const MODIFIER_CODES = new Set(["ControlLeft", "ControlRight", "ShiftLeft", "ShiftRight", "AltLeft", "AltRight", "MetaLeft", "MetaRight"]);

function codeToElectronKey(code: string): string | null {
    if (code.startsWith("Key")) return code.slice(3);
    if (code.startsWith("Digit")) return code.slice(5);
    if (/^F\d{1,2}$/.test(code)) return code;
    if (code.startsWith("Numpad")) {
        const sub = code.slice(6);
        if (/^\d$/.test(sub)) return `num${sub}`;
        const nm: Record<string, string> = { Add: "numadd", Subtract: "numsub", Multiply: "nummult", Divide: "numdiv", Decimal: "numdec", Enter: "Return" };
        return nm[sub] ?? null;
    }
    return CODE_TO_ELECTRON[code] ?? null;
}

function buildAccelerator(e: KeyboardEvent): string | null {
    if (MODIFIER_CODES.has(e.code)) return null;
    const key = codeToElectronKey(e.code);
    if (!key) return null;
    const parts: string[] = [];
    if (e.ctrlKey) parts.push("Control");
    if (e.shiftKey) parts.push("Shift");
    if (e.altKey) parts.push("Alt");
    if (e.metaKey) parts.push("Super");
    parts.push(key);
    return parts.join("+");
}

let recordingHandler: ((e: KeyboardEvent) => void) | null = null;

function stopRecording() {
    if (recordingHandler) window.removeEventListener("keydown", recordingHandler, true);
    recordingHandler = null;
}

function recordKeybind() {
    if (recordingHandler) return;
    showToast("Press a key combo for the keybind (Esc to cancel)", "clock");

    recordingHandler = (e: KeyboardEvent) => {
        e.preventDefault();
        e.stopImmediatePropagation();

        if (e.code === "Escape") {
            stopRecording();
            showToast("Keybind recording cancelled", "clock");
            return;
        }

        const acc = buildAccelerator(e);
        if (!acc) return;

        stopRecording();
        settings.store.keybind = acc;
        showToast(`Keybind set to ${acc}`, "success");
    };

    window.addEventListener("keydown", recordingHandler, true);
}

function buildItems(prefix: string) {
    const { isEnabled, crashMode, panicAction, keybindEnabled } = settings.store;
    const keybind = settings.store.keybind || "F7";
    const switched = previousDevice !== null;
    const safe = safeName().toLowerCase();
    const devices = listDevices();

    return [
        <Menu.MenuCheckboxItem
            key={`${prefix}-toggle`}
            id={`${prefix}-toggle`}
            label={isEnabled ? "Disable StreamCrasher" : "Enable StreamCrasher"}
            subtext={isEnabled && fallbackUsed ? "Native camera: using the safe camera" : undefined}
            checked={isEnabled}
            action={() => setCrash(!settings.store.isEnabled)}
        />,
        <Menu.MenuItem key={`${prefix}-mode`} id={`${prefix}-mode`} label="StreamCrash Mode">
            {Object.entries(crashModeLabels).map(([value, { value: label, subText }]) => (
                <Menu.MenuCheckboxItem
                    key={value}
                    id={`${prefix}-mode-${value}`}
                    label={label}
                    subtext={subText}
                    checked={crashMode === value}
                    action={() => { settings.store.crashMode = value; }}
                />
            ))}
        </Menu.MenuItem>,
        <Menu.MenuSeparator key={`${prefix}-sep-a`} />,
        <Menu.MenuCheckboxItem
            key={`${prefix}-switch`}
            id={`${prefix}-switch`}
            label="Use Safe Camera"
            checked={switched}
            action={toggleSwitch}
        />,
        <Menu.MenuItem key={`${prefix}-safe`} id={`${prefix}-safe`} label="Safe Camera">
            {devices.length === 0
                ? <Menu.MenuItem id={`${prefix}-safe-none`} label="No cameras found" disabled />
                : devices.map(d => (
                    <Menu.MenuCheckboxItem
                        key={d.id}
                        id={`${prefix}-safe-${d.id}`}
                        label={d.name}
                        checked={!!safe && d.name?.toLowerCase().includes(safe)}
                        action={() => {
                            settings.store.safeCameraName = d.name;
                            settings.store.manualCamera = "";
                        }}
                    />
                ))}
        </Menu.MenuItem>,
        <Menu.MenuSeparator key={`${prefix}-sep-b`} />,
        <Menu.MenuItem key={`${prefix}-action`} id={`${prefix}-action`} label="Button / Keybind Action">
            <Menu.MenuCheckboxItem
                id={`${prefix}-action-crash`}
                label="Crash Camera"
                checked={panicAction === "crash"}
                action={() => { settings.store.panicAction = "crash"; }}
            />
            <Menu.MenuCheckboxItem
                id={`${prefix}-action-switch`}
                label="Switch to Safe Camera"
                checked={panicAction === "switch"}
                action={() => { settings.store.panicAction = "switch"; }}
            />
        </Menu.MenuItem>,
        <Menu.MenuCheckboxItem
            key={`${prefix}-keybind-toggle`}
            id={`${prefix}-keybind-toggle`}
            label="Enable Global Keybind"
            checked={keybindEnabled}
            action={() => { settings.store.keybindEnabled = !settings.store.keybindEnabled; }}
        />,
        <Menu.MenuItem
            key={`${prefix}-keybind-record`}
            id={`${prefix}-keybind-record`}
            label={`Set Keybind (${keybind})`}
            action={recordKeybind}
        />,
        <Menu.MenuItem
            key={`${prefix}-settings`}
            id={`${prefix}-settings`}
            label="StreamCrasher Settings"
            icon={SettingsIcon}
            action={() => openPluginModal(CamCrasherPlugin)}
        />
    ];
}

const CamCrasherPatch: NavContextMenuPatchCallback = children => {
    children.push(<Menu.MenuSeparator />, ...buildItems("vcc"));
};

function CrasherPopoutMenu({ closePopout }: { closePopout: () => void; }) {
    settings.use(["isEnabled", "crashMode", "panicAction", "keybind", "keybindEnabled", "safeCameraName", "manualCamera"]);
    useStateFromStores([MediaEngineStore], () => MediaEngineStore.getVideoDevices?.());
    useCamState();

    return (
        <Menu.Menu navId="cam-crasher-context" onClose={closePopout}>
            {buildItems("ccp")}
        </Menu.Menu>
    );
}

function CamButtonAccount() {
    const buttonRef = useRef(null);
    const { buttonLocation, isEnabled } = settings.use(["buttonLocation", "isEnabled"]);
    const { switched } = useCamState();
    const inVideo = useStateFromStores([MediaEngineStore, SelectedChannelStore], () => inCall() && videoOn());

    if (buttonLocation !== "account" || !inVideo) return null;

    const active = isEnabled || switched;
    const tooltip = active ? "Restore Camera (right-click for options)" : "Protect Camera (right-click for options)";

    return (
        <Popout
            position="top"
            align="left"
            animation={Popout.Animation.FADE}
            spacing={4}
            targetElementRef={buttonRef}
            renderPopout={({ closePopout }) => <CrasherPopoutMenu closePopout={closePopout} />}
        >
            {({ onClick: openPopout }) => (
                <div ref={buttonRef} className="vc-cc-wrap">
                    <UserAreaButton
                        tooltipText={tooltip}
                        icon={<CamIcon active={active} />}
                        role="switch"
                        aria-checked={active}
                        onClick={panic}
                        onContextMenu={openPopout}
                        className={`vc-camcrasher-btn${active ? " danger" : ""}`}
                    />
                </div>
            )}
        </Popout>
    );
}

const CamButtonWrapped = ErrorBoundary.wrap(CamButtonAccount, { noop: true });

const styles = `
.vc-camcrasher-btn { color: var(--interactive-normal); margin-left: 4px; }
.vc-cc-wrap { width: fit-content; min-width: 0; }
.vc-cc-panel { padding: 12px 14px; border-radius: 8px; margin-bottom: 8px; background: var(--background-base-lower, var(--background-secondary)); }
.vc-cc-row { display: flex; align-items: center; gap: 10px; }
.vc-cc-dot { width: 10px; height: 10px; border-radius: 50%; background: var(--interactive-muted, #4e5058); }
.vc-cc-dot.on { background: var(--status-danger, #f23f43); }
.vc-cc-title { flex: 1; font-weight: 600; color: var(--text-strong, var(--header-primary)); }
.vc-cc-sub { margin-top: 6px; font-size: 12px; color: var(--text-subtle, var(--text-muted)); }
.vc-cc-btn { padding: 4px 14px; border: 0; border-radius: 6px; cursor: pointer; font-weight: 500; color: #fff; background: var(--brand-500, #5865f2); }
.vc-cc-btn:hover { filter: brightness(1.1); }
.vc-cc-field { margin-bottom: 8px; }
.vc-cc-label { margin-bottom: 6px; font-size: 12px; font-weight: 600; text-transform: uppercase; color: var(--text-strong, var(--header-secondary)); }
`;

const CamCrasherPlugin = definePlugin({
    name: "CamCrasher",
    description: "Crash, freeze or swap your webcam with a global keybind when something private shows up in a call. Includes all StreamCrasher modes.",
    authors: [{ name: "zfrancesck1", id: 456195985404592149n }],
    tags: ["Voice", "Privacy", "Utility"],
    enabledByDefault: false,
    searchTerms: ["CameraCrasher", "WebcamFreeze", "CamFreeze", "CameraPanic"],
    settings,
    styles,

    contextMenus: {
        "video-device-context": CamCrasherPatch
    },

    flux: {
        MEDIA_ENGINE_SET_VIDEO_ENABLED: onVideoToggle,
        VOICE_CHANNEL_SELECT: onVideoToggle
    },

    start() {
        suppress = true;
        settings.store.isEnabled = false;
        suppress = false;
        crashed = false;
        previousDevice = null;
        fallbackUsed = false;
        modeCache = settings.store.crashMode;
        drawnKey = "";

        installCapture();
        refreshImage();
        if (settings.store.keybindEnabled) registerKeybind(settings.store.keybind);
        Vencord.Api.UserArea.addUserAreaButton(BUTTON_ID, () => <CamButtonWrapped />);
    },

    stop() {
        stopRecording();
        if (previousDevice !== null) restoreCamera();
        crashed = false;
        uninstallCapture();
        Native.unregisterKeybind();
        Vencord.Api.UserArea.removeUserAreaButton(BUTTON_ID);
        imageToken++;
        imageBitmap?.close();
        imageBitmap = null;
        listeners.clear();
    },

    onKeybind() {
        const now = Date.now();
        if (now - lastFire < 300) return;
        lastFire = now;
        panic();
    }
});

export default CamCrasherPlugin;