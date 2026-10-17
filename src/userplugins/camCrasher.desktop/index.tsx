import type { NavContextMenuPatchCallback } from "@api/ContextMenu";
import { definePluginSettings } from "@api/Settings";
import { UserAreaButton } from "@api/UserArea";
import ErrorBoundary from "@components/ErrorBoundary";
import { openPluginModal } from "@components/settings";
import definePlugin, { OptionType, type PluginNative } from "@utils/types";
import { findByPropsLazy, findStoreLazy } from "@webpack";
import { FluxDispatcher, Menu, Popout, Select, SelectedChannelStore, showToast, useEffect, UserStore, useRef, useState, useStateFromStores, VoiceStateStore } from "@webpack/common";

const Native = VencordNative.pluginHelpers.CamCrasher as PluginNative<typeof import("./native")>;
const MediaEngineStore = findStoreLazy("MediaEngineStore");
const MediaEngineActions = findByPropsLazy("setVideoDevice");

const BUTTON_ID = "cam-crasher-account-button";

const toast = showToast;

function notify(message: string, type: string) {
    if (settings.store.toasts) toast(message, type);
}

let hidden = false;
let suppress = false;
let previousDevice: string | null = null;
let lastSwitchAt = 0;
let lastFire = 0;
let lastVideo = false;
let lastChannel: string | null = null;

const heldBroadcast = new Map<any, any>();
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
    return !!MediaEngineStore.isVideoEnabled?.();
}

function cameraState(): "on" | "fake" | "off" {
    if (!inCall()) return "off";
    if (videoOn()) return "on";
    const me = UserStore.getCurrentUser()?.id;
    return me && VoiceStateStore.getVoiceStateForUser?.(me)?.selfVideo ? "fake" : "off";
}

function listDevices(): any[] {
    return Object.values<any>(MediaEngineStore.getVideoDevices?.() ?? {});
}

function backupName() {
    return (settings.store.manualCamera || settings.store.safeCameraName || "").trim();
}

async function registerKeybind(accelerator: string) {
    const ok = await Native.registerKeybind(accelerator || "F7");
    if (!ok) notify("Keybind unavailable, pick another one", "failure");
}

function playToggleSound(on: boolean) {
    if (!settings.store.soundEnabled || suppress) return;
    try {
        const ctx = new AudioContext({ sinkId: "communications" } as any);
        const play = () => {
            const t = ctx.currentTime;
            const gain = ctx.createGain();
            gain.connect(ctx.destination);

            if (on) {
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

function videoConnections(): any[] {
    try {
        const conns = MediaEngineStore.getMediaEngine?.()?.connections;
        return conns ? Array.from(conns as Iterable<any>).filter(c => c && c.context !== "stream") : [];
    } catch {
        return [];
    }
}

function hideSupported() {
    return videoConnections().some(c => typeof c.setVideoBroadcast === "function");
}

function holdBroadcast(on: boolean) {
    for (const c of videoConnections()) {
        if (typeof c.setVideoBroadcast !== "function") continue;
        try {
            if (on) {
                if (!heldBroadcast.has(c)) {
                    const original = c.setVideoBroadcast;
                    heldBroadcast.set(c, original);
                    c.setVideoBroadcast = function (this: any, value: boolean) {
                        return original.call(this, hidden ? false : value);
                    };
                }
                heldBroadcast.get(c).call(c, false);
            } else if (heldBroadcast.has(c)) {
                const original = heldBroadcast.get(c);
                heldBroadcast.delete(c);
                c.setVideoBroadcast = original;
                original.call(c, videoOn());
            }
        } catch { }
    }
    if (!on) heldBroadcast.clear();
}

function pickBackupDevice(current: string | undefined) {
    const needle = (backupName() || "virtual").toLowerCase();
    return listDevices().find(d => d.id !== current && (d.id === needle || d.name?.toLowerCase().includes(needle)));
}

function switchCamera() {
    const current = MediaEngineStore.getVideoDeviceId?.();
    const target = pickBackupDevice(current);
    if (!target) {
        notify("Backup camera not found. Pick one in the camera menu or type it in settings", "failure");
        return;
    }
    previousDevice = current ?? "";
    lastSwitchAt = Date.now();
    playToggleSound(true);
    MediaEngineActions.setVideoDevice(target.id);
    emit();
}

function restoreCamera(silent = false) {
    const id = previousDevice;
    previousDevice = null;
    if (id) {
        if (!silent) playToggleSound(false);
        lastSwitchAt = Date.now();
        MediaEngineActions.setVideoDevice(id);
    }
    emit();
}

let watching = false;
let buttonAdded = false;

function watchCamera(on: boolean) {
    if (on === watching) return;
    watching = on;
    if (on) {
        lastVideo = videoOn();
        lastChannel = SelectedChannelStore.getVoiceChannelId() ?? null;
        MediaEngineStore.addChangeListener(syncCamera);
        SelectedChannelStore.addChangeListener(syncCamera);
        FluxDispatcher.subscribe("MEDIA_ENGINE_SET_VIDEO_ENABLED", syncCamera);
        FluxDispatcher.subscribe("VOICE_CHANNEL_SELECT", syncCamera);
    } else {
        MediaEngineStore.removeChangeListener(syncCamera);
        SelectedChannelStore.removeChangeListener(syncCamera);
        FluxDispatcher.unsubscribe("MEDIA_ENGINE_SET_VIDEO_ENABLED", syncCamera);
        FluxDispatcher.unsubscribe("VOICE_CHANNEL_SELECT", syncCamera);
    }
}

function syncButton() {
    const want = settings.store.buttonLocation === "account";
    if (want === buttonAdded) return;
    buttonAdded = want;
    if (want) Vencord.Api.UserArea.addUserAreaButton(BUTTON_ID, () => <CamButtonWrapped />);
    else Vencord.Api.UserArea.removeUserAreaButton(BUTTON_ID);
}

function applyHidden(val: boolean) {
    hidden = val;
    playToggleSound(val);
    holdBroadcast(val);
    watchCamera(val);
    if (val && !suppress && inCall() && videoOn() && !hideSupported()) {
        notify("Hide Camera is not supported on this Discord build, use the backup camera", "failure");
    }
    emit();
}

function setHidden(on: boolean) {
    settings.store.isEnabled = on;
}

function panic() {
    if (hidden || previousDevice !== null) {
        if (hidden) setHidden(false);
        if (previousDevice !== null) restoreCamera();
        return;
    }
    if (cameraState() !== "on") {
        notify("Turn on your camera first", "failure");
        return;
    }
    if (settings.store.panicAction === "switch") switchCamera();
    else setHidden(true);
}

function syncCamera(data?: any) {
    if (!hidden || !settings.store.autoDisableOnCamera) return;

    const video = typeof data?.enabled === "boolean" ? data.enabled : videoOn();
    const channel = SelectedChannelStore.getVoiceChannelId() ?? null;
    if (video === lastVideo && channel === lastChannel) return;
    lastVideo = video;
    lastChannel = channel;

    if (Date.now() - lastSwitchAt < 2000) return;

    suppress = true;
    settings.store.isEnabled = false;
    suppress = false;
}

const ui = {
    panel: { padding: "12px 14px", borderRadius: 8, marginBottom: 8, background: "var(--background-base-lower, var(--background-secondary))" },
    row: { display: "flex", alignItems: "center", gap: 10 },
    title: { flex: 1, fontWeight: 600, color: "var(--text-strong, var(--header-primary))" },
    sub: { marginTop: 6, fontSize: 12, color: "var(--text-subtle, var(--text-muted))" },
    button: { padding: "4px 14px", border: 0, borderRadius: 6, cursor: "pointer", fontWeight: 500, color: "#fff", background: "var(--brand-500, #5865f2)" },
    label: { marginBottom: 6, fontSize: 12, fontWeight: 600, textTransform: "uppercase" as const, color: "var(--text-strong, var(--header-secondary))" }
};

function StatusPanel() {
    const { isEnabled } = settings.use(["isEnabled"]);
    const { switched } = useCamState();
    const state = useStateFromStores([MediaEngineStore, SelectedChannelStore, VoiceStateStore], () => cameraState());

    const active = isEnabled || switched;
    const usable = active || state === "on";
    const title = isEnabled ? "Camera hidden" : switched ? "Backup camera active" : state === "on" ? "Camera visible" : state === "fake" ? "Fake camera active" : "Camera off";
    const hint = active || state === "on"
        ? hideSupported() ? "Hide Camera is ready" : "Hide Camera is not supported here, use the backup camera"
        : state === "fake" ? "Fake Camera is on, your real camera is off" : "Join a call and turn on your camera to use CamCrasher";

    return (
        <div style={ui.panel}>
            <div style={ui.row}>
                <span style={{ width: 10, height: 10, borderRadius: "50%", background: active ? "var(--status-danger, #f23f43)" : state === "on" ? "var(--status-positive, #23a55a)" : "var(--interactive-muted, #4e5058)" }} />
                <span style={ui.title}>{title}</span>
                <button type="button" disabled={!usable} style={{ ...ui.button, opacity: usable ? 1 : 0.5, cursor: usable ? "pointer" : "not-allowed" }} onClick={panic}>{active ? "Restore" : "Test"}</button>
            </div>
            <div style={ui.sub}>{hint}</div>
        </div>
    );
}

function BackupCameraPicker() {
    const { safeCameraName } = settings.use(["safeCameraName"]);
    const devices = useStateFromStores([MediaEngineStore], () => MediaEngineStore.getVideoDevices?.());
    const options = Object.values<any>(devices ?? {}).map(d => ({ label: d.name, value: d.name }));

    return (
        <div style={{ marginBottom: 8 }}>
            <div style={ui.label}>Backup Camera</div>
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
            <div style={ui.sub}>The camera Discord swaps to for "Switch to Backup Camera", e.g. OBS Virtual Camera showing a clean scene.</div>
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
            { label: "Hide Camera", value: "hide", default: true },
            { label: "Switch to Backup Camera", value: "switch" }
        ]
    },
    safeCameraName: {
        type: OptionType.COMPONENT,
        component: BackupCameraPicker
    },
    manualCamera: {
        type: OptionType.STRING,
        description: "Backup camera name typed manually (overrides the detected one, partial match)",
        default: "",
        placeholder: "OBS Virtual Camera"
    },
    buttonLocation: {
        type: OptionType.SELECT,
        description: "Where to place the button (applies instantly)",
        options: [
            { label: "Hidden (camera context menu / keybind only)", value: "none", default: true },
            { label: "Account Section", value: "account" }
        ],
        onChange: () => syncButton()
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
        description: "Keybind accelerator, e.g. F7 or Control+F3. You can also record it from the camera context menu",
        default: "F7",
        onChange: val => { if (settings.store.keybindEnabled) registerKeybind(val); }
    },
    soundEnabled: {
        type: OptionType.BOOLEAN,
        description: "Play a sound when the camera is hidden or shown",
        default: true
    },
    toasts: {
        type: OptionType.BOOLEAN,
        description: "Show toast notifications",
        default: false
    },
    autoDisableOnCamera: {
        type: OptionType.BOOLEAN,
        description: "Show the camera again when it is turned on or off, or when you change voice channel",
        default: true
    },
    isEnabled: {
        type: OptionType.BOOLEAN,
        description: "Camera hidden",
        default: false,
        hidden: true,
        onChange: val => applyHidden(val)
    }
});

const CamIcon = ({ active }: { active: boolean; }) => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
        <path
            fill={active ? "var(--status-danger)" : "currentColor"}
            fillRule="evenodd"
            clipRule="evenodd"
            d="M4 5h9.5A3.5 3.5 0 0 1 17 8.5v7a3.5 3.5 0 0 1-3.5 3.5H4A3.5 3.5 0 0 1 .5 15.5v-7A3.5 3.5 0 0 1 4 5zM8.75 9.4a2.6 2.6 0 1 0 0 5.2 2.6 2.6 0 0 0 0-5.2z"
        />
        <path
            fill={active ? "var(--status-danger)" : "currentColor"}
            d="M18.5 10.4l3-1.9a.9.9 0 0 1 1.4.77v5.46a.9.9 0 0 1-1.4.77l-3-1.9z"
        />
        {active && (
            <>
                <path d="M3 21 21 3" stroke="var(--background-base-lowest, #1e1f22)" strokeWidth="4.5" strokeLinecap="round" />
                <path d="M3 21 21 3" stroke="var(--status-danger)" strokeWidth="2" strokeLinecap="round" />
            </>
        )}
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
    notify("Press a key combo (Esc to cancel)", "clock");

    recordingHandler = (e: KeyboardEvent) => {
        e.preventDefault();
        e.stopImmediatePropagation();

        if (e.code === "Escape") {
            stopRecording();
            notify("Keybind recording cancelled", "clock");
            return;
        }

        const acc = buildAccelerator(e);
        if (!acc) return;

        stopRecording();
        settings.store.keybind = acc;
        notify(`Keybind set to ${acc}`, "success");
    };

    window.addEventListener("keydown", recordingHandler, true);
}

function buildItems(prefix: string) {
    const { isEnabled, panicAction } = settings.store;
    const keybind = settings.store.keybind || "F7";
    const switched = previousDevice !== null;
    const backup = backupName().toLowerCase();
    const devices = listDevices();

    return [
        <Menu.MenuCheckboxItem
            key={`${prefix}-toggle`}
            id={`${prefix}-toggle`}
            label={isEnabled ? "Show Camera" : switched ? "Back to Main Camera" : panicAction === "switch" ? "Switch to Backup Camera" : "Hide Camera"}
            checked={isEnabled || switched}
            action={panic}
        />,
        <Menu.MenuItem key={`${prefix}-action`} id={`${prefix}-action`} label="Panic Action">
            <Menu.MenuCheckboxItem
                id={`${prefix}-action-hide`}
                label="Hide Camera"
                checked={panicAction !== "switch"}
                action={() => { settings.store.panicAction = "hide"; }}
            />
            <Menu.MenuCheckboxItem
                id={`${prefix}-action-switch`}
                label="Switch to Backup Camera"
                checked={panicAction === "switch"}
                action={() => { settings.store.panicAction = "switch"; }}
            />
        </Menu.MenuItem>,
        <Menu.MenuItem key={`${prefix}-backup`} id={`${prefix}-backup`} label="Backup Camera">
            {devices.length === 0
                ? <Menu.MenuItem id={`${prefix}-backup-none`} label="No cameras found" disabled />
                : devices.map(d => (
                    <Menu.MenuCheckboxItem
                        key={d.id}
                        id={`${prefix}-backup-${d.id}`}
                        label={d.name}
                        checked={!!backup && d.name?.toLowerCase().includes(backup)}
                        action={() => {
                            settings.store.safeCameraName = d.name;
                            settings.store.manualCamera = "";
                        }}
                    />
                ))}
        </Menu.MenuItem>,
        <Menu.MenuItem
            key={`${prefix}-keybind`}
            id={`${prefix}-keybind`}
            label={`Set Keybind (${keybind})`}
            action={recordKeybind}
        />,
        <Menu.MenuItem
            key={`${prefix}-settings`}
            id={`${prefix}-settings`}
            label="CamCrasher Settings"
            icon={SettingsIcon}
            action={() => openPluginModal(CamCrasherPlugin)}
        />
    ];
}

const CamCrasherPatch: NavContextMenuPatchCallback = children => {
    if (!hidden && previousDevice === null && cameraState() !== "on") return;
    children.push(<Menu.MenuSeparator />, ...buildItems("vcc"));
};

function PopoutMenu({ closePopout }: { closePopout: () => void; }) {
    settings.use(["isEnabled", "panicAction", "keybind", "safeCameraName", "manualCamera"]);
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
    const { isEnabled } = settings.use(["isEnabled"]);
    const { switched } = useCamState();
    const camOn = useStateFromStores([MediaEngineStore, SelectedChannelStore, VoiceStateStore], () => cameraState() === "on");

    if (!camOn && !isEnabled && !switched) return null;

    const active = isEnabled || switched;
    const tooltip = active ? "Show Camera (right-click for options)" : "Hide Camera (right-click for options)";

    return (
        <Popout
            position="top"
            align="left"
            animation={Popout.Animation.FADE}
            spacing={4}
            targetElementRef={buttonRef}
            renderPopout={({ closePopout }) => <PopoutMenu closePopout={closePopout} />}
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

const styles = `.vc-camcrasher-btn { color: var(--interactive-normal); margin-left: 4px; } .vc-cc-wrap { width: fit-content; min-width: 0; }`;

const CamCrasherPlugin = definePlugin({
    name: "CamCrasher",
    description: "Instantly hide your webcam from everyone in the call with a global keybind, or switch to a backup camera like OBS Virtual Camera.",
    authors: [{ name: "zfrancesck1", id: 456195985404592149n }],
    tags: ["Voice", "Privacy", "Utility"],
    enabledByDefault: false,
    searchTerms: ["CameraCrasher", "HideCamera", "WebcamPanic", "CameraPanic"],
    settings,
    styles,

    contextMenus: {
        "video-device-context": CamCrasherPatch
    },

    start() {
        if (settings.store.isEnabled) {
            suppress = true;
            settings.store.isEnabled = false;
            suppress = false;
        }
        hidden = false;
        previousDevice = null;
        if (!settings.store.keybind || settings.store.keybind === "F8") settings.store.keybind = "F7";

        if (settings.store.keybindEnabled) registerKeybind(settings.store.keybind);
        syncButton();
    },

    stop() {
        watchCamera(false);
        stopRecording();
        hidden = false;
        holdBroadcast(false);
        if (previousDevice !== null) restoreCamera(true);
        Native.unregisterKeybind();
        if (buttonAdded) {
            buttonAdded = false;
            Vencord.Api.UserArea.removeUserAreaButton(BUTTON_ID);
        }
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