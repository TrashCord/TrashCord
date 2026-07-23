import { definePluginSettings } from "@api/Settings";
import { openPluginModal } from "@components/settings";
import ErrorBoundary from "@components/ErrorBoundary";
import type { NavContextMenuPatchCallback } from "@api/ContextMenu";
import { UserAreaButton } from "@api/UserArea";
import { Devs } from "@utils/constants";
import definePlugin, { OptionType, type PluginNative } from "@utils/types";
import { findComponentByCodeLazy, findStoreLazy } from "@webpack";
import { ApplicationStreamingStore, Menu, Popout, showToast, Toasts, useLayoutEffect, useMemo, useRef, UserStore, useStateFromStores, VoiceActions } from "@webpack/common";

const Native = VencordNative.pluginHelpers.StreamCrasher as PluginNative<typeof import("./native")>;
const ApplicationStreamingSettingsStore = findStoreLazy("ApplicationStreamingSettingsStore");

async function tryRegisterKeybind(accelerator: string) {
    const acc = accelerator || "F6";
    return await Native.registerGlobalKeybind(acc);
}

export const crashModeLabels: Record<string, { value: string; subText?: string; }> = {
    freeze:   { value: "Freeze",       subText: "Freezes the stream" },
    flashing: { value: "Flashing",     subText: "Looping black/white flash" },
    white:    { value: "White Screen" },
    colors:   { value: "Color Cycle",  subText: "Looping rainbow cycle" },
    static:   { value: "Static",       subText: "TV Noise" },
    bsod:     { value: "Crash Screen", subText: "OS-specific BSOD" },
    image:    { value: "Image",        subText: "PNG/JPG/GIF/WebP, URL or local path" }
};

export const settings = definePluginSettings({
    isEnabled: {
        type: OptionType.BOOLEAN,
        description: "Crashing state",
        default: false,
        onChange: val => { isEnabledCache = val; if (!suppressStateChange) { playToggleSound(val); updateStream(val); } }
    },
    keybindEnabled: {
        type: OptionType.BOOLEAN,
        description: "Toggle the crasher with a global keybind (works even when Discord is not focused)",
        default: false,
        onChange: val => {
            if (val) tryRegisterKeybind(settings.store.keybind);
            else Native.unregisterGlobalKeybind();
            syncKeybindLoop();
        }
    },
    keybind: {
        type: OptionType.STRING,
        description: "Global keybind accelerator. Use 'Set Keybind' in the right-click options menu to record it by pressing keys, or type one manually (e.g. F6, Control+F3)",
        default: "F6",
        onChange: val => { if (settings.store.keybindEnabled) tryRegisterKeybind(val); }
    },
    crashMode: {
        type: OptionType.SELECT,
        description: "What viewers see when the crasher is active",
        options: Object.entries(crashModeLabels).map(([value, { value: label, subText }], i) => ({
            label, value, subtext: subText, default: i === 0
        })),
        onChange: () => {
            if (!settings.store.isEnabled) { Native.updateCrashMode(); return; }
            updateStream(false);
            setTimeout(() => updateStream(true), 80);
        }
    },
    imageUrl: {
        type: OptionType.STRING,
        description: "Image/GIF/WebP URL or local path (e.g. C:\\img.gif or https://...)",
        default: "",
        placeholder: "https://example.com/image.gif",
        componentProps: { onBlur: () => Native.updateCrashMode() },
        hidden() { return this.store.crashMode !== "image"; }
    },
    buttonLocation: {
        type: OptionType.SELECT,
        description: "Where to place the crasher button (applies instantly, no restart)",
        options: [
            { label: "Account Section", value: "account", default: true },
            { label: "Streaming Panel", value: "stream" },
            { label: "Hidden (keybind / context menu only)", value: "none" }
        ]
    },
    soundEnabled: {
        type: OptionType.BOOLEAN,
        description: "Play a sound when the crasher is toggled on or off",
        default: true
    },
    autoDisableOnStream: {
        type: OptionType.BOOLEAN,
        description: "Always disable the crasher when a stream starts or Discord launches (recommended)",
        default: true
    }
});

let suppressStateChange = false;
let isEnabledCache = false;

function playToggleSound(enabled: boolean) {
    if (!settings.store.soundEnabled || suppressStateChange) return;
    try {
        const ctx = new AudioContext({ sinkId: "communications" } as any);
        const play = () => {
            const t = ctx.currentTime;
            if (enabled) {
                const gain = ctx.createGain();
                gain.connect(ctx.destination);
                const o1 = ctx.createOscillator();
                const o2 = ctx.createOscillator();
                o1.type = "sine"; o1.frequency.value = 523;
                o2.type = "sine"; o2.frequency.value = 784;
                o1.connect(gain); o2.connect(gain);
                gain.gain.setValueAtTime(0, t);
                gain.gain.linearRampToValueAtTime(0.020, t + 0.008);
                gain.gain.setValueAtTime(0.020, t + 0.055);
                gain.gain.linearRampToValueAtTime(0, t + 0.075);
                gain.gain.setValueAtTime(0, t + 0.09);
                gain.gain.linearRampToValueAtTime(0.020, t + 0.1);
                gain.gain.setValueAtTime(0.020, t + 0.165);
                gain.gain.exponentialRampToValueAtTime(0.001, t + 0.21);
                o1.start(t); o1.stop(t + 0.075);
                o2.start(t + 0.09); o2.stop(t + 0.21);
                o2.onended = () => ctx.close();
            } else {
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                osc.connect(gain); gain.connect(ctx.destination);
                osc.type = "triangle";
                osc.frequency.setValueAtTime(500, t);
                osc.frequency.exponentialRampToValueAtTime(220, t + 0.15);
                gain.gain.setValueAtTime(0.020, t);
                gain.gain.exponentialRampToValueAtTime(0.001, t + 0.17);
                osc.start(t); osc.stop(t + 0.18);
                osc.onended = () => ctx.close();
            }
        };
        if (ctx.state === "suspended") ctx.resume().then(play).catch(() => ctx.close());
        else play();
    } catch {}
}

let lastSourceId: string | null = null;
let lastQualityOptions: { preset?: number; resolution?: number; frameRate?: number; } | null = null;
let crashSourceId: string | null = null;
let lastCrashSourceId: string | null = null;
let currentUpdate: Promise<void> | null = null;
let pendingState: boolean | null = null;
let crashUpdateInProgress = false;

function setLastSourceId(sourceId: string | null, qualityOptions?: any): boolean {
    if (!sourceId || sourceId === crashSourceId || sourceId === lastCrashSourceId || crashUpdateInProgress) return false;
    lastSourceId = sourceId;
    if (qualityOptions?.frameRate > 0) lastQualityOptions = qualityOptions;
    lastCrashSourceId = null;
    return true;
}

async function getSourceId(isEnabled: boolean): Promise<string> {
    if (isEnabled) {
        if (!lastSourceId) {
            const sources = await DiscordNative.desktopCapture.getDesktopCaptureSources({ types: ["screen"], thumbnailSize: { width: 0, height: 0 } });
            lastSourceId = sources[0]?.id ?? "default";
        }
        crashSourceId = await Native.createCrashSource();
        lastCrashSourceId = crashSourceId;
        return crashSourceId ?? "";
    }
    crashSourceId = null;
    if (lastSourceId) return lastSourceId;
    const sources = await DiscordNative.desktopCapture.getDesktopCaptureSources({ types: ["screen"], thumbnailSize: { width: 0, height: 0 } });
    return sources[0]?.id ?? "default";
}

function resolveRestoreQuality() {
    if (lastQualityOptions?.frameRate > 0) {
        return {
            preset: lastQualityOptions.preset ?? 2,
            resolution: lastQualityOptions.resolution ?? 720,
            frameRate: lastQualityOptions.frameRate
        };
    }
    const s = ApplicationStreamingSettingsStore?.getState?.() ?? {};
    return {
        preset: s.preset ?? 2,
        resolution: s.resolution ?? 720,
        frameRate: (s.fps && s.fps > 0) ? s.fps : 60
    };
}

async function doUpdateStream(isEnabled: boolean) {
    try {
        let streaming = ApplicationStreamingStore.getCurrentUserActiveStream() != null;
        if (!streaming) {
            await new Promise(r => setTimeout(r, 500));
            streaming = ApplicationStreamingStore.getCurrentUserActiveStream() != null;
            if (!streaming) return;
        }

        crashUpdateInProgress = true;
        const sourceId = await getSourceId(isEnabled);
        if (!sourceId) { crashUpdateInProgress = false; return; }

        const type = sourceId.includes(":") ? sourceId.split(":")[0] : "screen";
        const sound = isEnabled ? false : (ApplicationStreamingSettingsStore?.getState?.()?.soundshareEnabled ?? false);
        const qualityOptions = isEnabled ? { preset: 2, resolution: 480, frameRate: 60 } : resolveRestoreQuality();

        VoiceActions.setGoLiveSource({
            desktopSettings: { sourceId, type, sound },
            qualityOptions,
            context: "stream"
        });

        await new Promise(r => setTimeout(r, 100));
        crashUpdateInProgress = false;

        if (!isEnabled) Native.stopCrashSource();
    } catch {
        crashUpdateInProgress = false;
    }
}

function updateStream(isEnabled: boolean) {
    if (currentUpdate) {
        pendingState = isEnabled;
        return;
    }
    currentUpdate = doUpdateStream(isEnabled).finally(() => {
        currentUpdate = null;
        if (pendingState !== null) {
            const next = pendingState;
            pendingState = null;
            updateStream(next);
        }
    });
}

const Button = findComponentByCodeLazy(".GREEN,positionKeyStemOverride:");

const CrashIcon = ({ isEnabled }) => (
    <svg width="18" height="18" viewBox="0 0 24 24">
        <path
            fill={isEnabled ? "var(--icon-voice-muted)" : "currentColor"}
            d="M18.75 6c0 2.08-1.19 3.91-3 4.98V12c0 .83-.67 1.5-1.5 1.5h-4.5c-.83 0-1.5-.67-1.5-1.5v-1.02c-1.81-1.08-3-2.91-3-4.98C5.25 2.69 8.27 0 12 0s6.75 2.69 6.75 6zM9.38 8.25c.83 0 1.5-.67 1.5-1.5s-.67-1.5-1.5-1.5-1.5.67-1.5 1.5.67 1.5 1.5 1.5zm6.75-1.5c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5.67 1.5 1.5 1.5 1.5-.67 1.5-1.5zM4.8 15c.3-.6 1-.85 1.6-.55L12 17l5.6-2.55c.6-.3 1.35-.05 1.6.55s.05 1.35-.55 1.6L14.8 18l3.65 1.6c.6.3.85 1 .55 1.6s-1 .85-1.6.55L12 19l-5.6 2.75c-.6.3-1.35.05-1.6-.55s-.05-1.35.55-1.6L9.2 18l-3.65-1.6c-.6-.3-.85-1-.55-1.6z"
        />
    </svg>
);

const SettingsIcon = () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
        <path d="M19.14 12.94a7.07 7.07 0 0 0 0-1.88l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.49.49 0 0 0-.59-.22l-2.39.96a7.04 7.04 0 0 0-1.62-.94l-.36-2.54a.48.48 0 0 0-.48-.41h-3.84a.48.48 0 0 0-.48.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96a.49.49 0 0 0-.59.22L2.74 8.87a.48.48 0 0 0 .12.61l2.03 1.58a7.07 7.07 0 0 0 0 1.88l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.49.37 1.03.7 1.62.94l.36 2.54c.05.24.26.41.48.41h3.84c.22 0 .43-.17.48-.41l.36-2.54c.59-.24 1.13-.57 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32a.49.49 0 0 0-.12-.61l-2.03-1.58zM12 15.6A3.6 3.6 0 1 1 15.6 12 3.6 3.6 0 0 1 12 15.6z"/>
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

let recordingActive = false;
let recordingHandler: ((e: KeyboardEvent) => void) | null = null;

function recordKeybind() {
    if (recordingActive) return;
    recordingActive = true;
    showToast("Press a key combo for the keybind (Esc to cancel)", Toasts.Type.CLOCK);

    recordingHandler = (e: KeyboardEvent) => {
        e.preventDefault();
        e.stopImmediatePropagation();

        if (e.code === "Escape") {
            window.removeEventListener("keydown", recordingHandler!, true);
            recordingHandler = null;
            recordingActive = false;
            showToast("Keybind recording cancelled", Toasts.Type.CLOCK);
            return;
        }

        const acc = buildAccelerator(e);
        if (!acc) return;

        window.removeEventListener("keydown", recordingHandler!, true);
        recordingHandler = null;
        recordingActive = false;
        settings.store.keybind = acc;
        if (settings.store.keybindEnabled) tryRegisterKeybind(acc);
        showToast(`Keybind set to ${acc}`, Toasts.Type.SUCCESS);
    };

    window.addEventListener("keydown", recordingHandler, true);
}

function buildCrashModeSubmenu(idPrefix: string, crashMode: string) {
    return (
        <Menu.MenuItem id={`${idPrefix}-mode`} label="Crash Mode">
            {Object.entries(crashModeLabels).map(([value, { value: label, subText }]) => (
                <Menu.MenuCheckboxItem
                    key={value}
                    id={`${idPrefix}-mode-${value}`}
                    label={label}
                    subtext={subText}
                    checked={crashMode === value}
                    action={() => settings.store.crashMode = value}
                />
            ))}
        </Menu.MenuItem>
    );
}

function CrasherContextMenu({ closePopout }: { closePopout: () => void; }) {
    const { isEnabled, keybindEnabled, crashMode, buttonLocation, keybind } = settings.use([
        "isEnabled", "keybindEnabled", "crashMode", "buttonLocation", "keybind"
    ]);

    return (
        <Menu.Menu navId="stream-crasher-context" onClose={closePopout}>
            <Menu.MenuCheckboxItem
                id="ctx-toggle"
                label={isEnabled ? "Disable Crasher" : "Enable Crasher"}
                checked={isEnabled}
                action={() => settings.store.isEnabled = !settings.store.isEnabled}
            />

            <Menu.MenuSeparator />

            {buildCrashModeSubmenu("ctx", crashMode)}

            <Menu.MenuItem id="ctx-location" label="Button Location">
                {([
                    { label: "Account Section", value: "account" },
                    { label: "Streaming Panel", value: "stream" },
                    { label: "Hidden", value: "none" }
                ] as const).map(opt => (
                    <Menu.MenuCheckboxItem
                        key={opt.value}
                        id={`ctx-loc-${opt.value}`}
                        label={opt.label}
                        checked={buttonLocation === opt.value}
                        action={() => settings.store.buttonLocation = opt.value}
                    />
                ))}
            </Menu.MenuItem>

            <Menu.MenuSeparator />

            <Menu.MenuCheckboxItem
                id="ctx-keybind-toggle"
                label="Enable Global Keybind"
                checked={keybindEnabled}
                action={() => settings.store.keybindEnabled = !settings.store.keybindEnabled}
            />

            <Menu.MenuItem
                id="ctx-keybind-record"
                label={`Set Keybind (${keybind || "F6"})`}
                action={recordKeybind}
            />

            <Menu.MenuSeparator />

            <Menu.MenuItem
                id="ctx-settings"
                label="Crasher Settings"
                icon={SettingsIcon}
                action={() => openPluginModal(StreamCrasherPlugin)}
            />
        </Menu.Menu>
    );
}

const StreamCrasherPatch: NavContextMenuPatchCallback = children => {
    const isEnabled = settings.store.isEnabled;
    const crashMode = settings.store.crashMode;
    const keybind = settings.store.keybind || "F6";

    children.splice(3, 0,
        <Menu.MenuCheckboxItem
            id="stream-crasher-toggle"
            label={isEnabled ? "Disable Crasher" : "Enable Crasher"}
            checked={isEnabled}
            action={() => settings.store.isEnabled = !settings.store.isEnabled}
        />,
        buildCrashModeSubmenu("scm", crashMode),
        <Menu.MenuItem
            id="stream-crasher-keybind"
            label={`Set Keybind (${keybind})`}
            action={recordKeybind}
        />,
        <Menu.MenuItem
            id="stream-crasher-settings"
            label="Crasher Settings"
            icon={SettingsIcon}
            action={() => openPluginModal(StreamCrasherPlugin)}
        />
    );
};

function CrashButton() {
    const buttonRef = useRef(null);
    const { isEnabled } = settings.use(["isEnabled"]);
    const userId = useMemo(() => UserStore.getCurrentUser()?.id, []);
    const isStreaming = useStateFromStores(
        [ApplicationStreamingStore],
        () => ApplicationStreamingStore.getActiveStreamForUser(userId) != null
    );

    useLayoutEffect(() => {
        if (isStreaming && settings.store.autoDisableOnStream !== false && settings.store.isEnabled) {
            suppressStateChange = true;
            settings.store.isEnabled = false;
            suppressStateChange = false;
            isEnabledCache = false;
        }
    }, [isStreaming]);

    if (!isStreaming) return null;

    return (
        <Popout
            position="top"
            align="left"
            animation={Popout.Animation.FADE}
            spacing={4}
            targetElementRef={buttonRef}
            renderPopout={({ closePopout }) => <CrasherContextMenu closePopout={closePopout} />}
        >
            {({ onClick: openPopout }) => (
                <div ref={buttonRef}>
                    <Button
                        aria-checked={isEnabled}
                        aria-label={isEnabled ? "Disable Crasher" : "Enable Crasher"}
                        icon={() => <CrashIcon isEnabled={isEnabled} />}
                        onClick={() => settings.store.isEnabled = !settings.store.isEnabled}
                        onContextMenu={openPopout}
                        plated={false}
                        redGlow={isEnabled}
                        role="switch"
                        tooltipText={isEnabled ? "Disable Crasher (right-click for options)" : "Enable Crasher (right-click for options)"}
                    />
                </div>
            )}
        </Popout>
    );
}

function CrashButtonAccount() {
    const buttonRef = useRef(null);
    const { isEnabled } = settings.use(["isEnabled"]);
    const userId = useMemo(() => UserStore.getCurrentUser()?.id, []);
    const isStreaming = useStateFromStores(
        [ApplicationStreamingStore],
        () => ApplicationStreamingStore.getActiveStreamForUser(userId) != null
    );

    useLayoutEffect(() => {
        if (isStreaming && settings.store.autoDisableOnStream !== false && settings.store.isEnabled) {
            suppressStateChange = true;
            settings.store.isEnabled = false;
            suppressStateChange = false;
            isEnabledCache = false;
        }
    }, [isStreaming]);

    if (!isStreaming) return null;

    return (
        <Popout
            position="top"
            align="left"
            animation={Popout.Animation.FADE}
            spacing={4}
            targetElementRef={buttonRef}
            renderPopout={({ closePopout }) => <CrasherContextMenu closePopout={closePopout} />}
        >
            {({ onClick: openPopout }) => (
                <div ref={buttonRef} className="vc-sc-wrap">
                    <UserAreaButton
                        tooltipText={isEnabled ? "Disable Crasher (right-click for options)" : "Enable Crasher (right-click for options)"}
                        icon={<CrashIcon isEnabled={isEnabled} />}
                        role="switch"
                        aria-checked={isEnabled}
                        onClick={() => settings.store.isEnabled = !settings.store.isEnabled}
                        onContextMenu={openPopout}
                        className={`vc-streamcrasher-btn${isEnabled ? " danger" : ""}`}
                    />
                </div>
            )}
        </Popout>
    );
}

function CrashButtonStream() {
    const { buttonLocation } = settings.use(["buttonLocation"]);
    if (buttonLocation !== "stream") return null;
    return <CrashButton />;
}

let keybindLoopActive = false;

let isStreamingNow = false;

async function keybindLoop() {
    keybindLoopActive = true;
    while (keybindLoopActive) {
        await Native.waitForKeybind();
        if (keybindLoopActive && isStreamingNow && settings.store.keybindEnabled)
            settings.store.isEnabled = !settings.store.isEnabled;
    }
}

function stopKeybindLoop() {
    if (!keybindLoopActive) return;
    keybindLoopActive = false;
    void Native.cancelKeybindWait();
}

function syncKeybindLoop() {
    if (settings.store.keybindEnabled && isStreamingNow) {
        if (!keybindLoopActive) void keybindLoop();
    } else {
        stopKeybindLoop();
    }
}

const styles = `.vc-streamcrasher-btn { color: var(--interactive-normal); margin-left: 4px; } .vc-sc-wrap { width: fit-content; min-width: 0; }`;

const StreamCrasherPlugin = definePlugin({
    name: "StreamCrasher",
    description: "Crashes/Freezes your stream in Discord calls when you're screensharing",
    authors: [Devs.RoScripter999, { name: "zfrancesck1", id: 456195985404592149n }],
    tags: ["Voice", "Utility", "Privacy"],
    enabledByDefault: false,
    searchTerms: ["StreamFreezer", "ScreenshareCrasher"],
    settings,
    styles,
    contextMenus: {
        "manage-streams": StreamCrasherPatch
    },

    start() {
        isStreamingNow = ApplicationStreamingStore.getCurrentUserActiveStream() != null;
        if (settings.store.keybindEnabled) tryRegisterKeybind(settings.store.keybind);
        syncKeybindLoop();

        setTimeout(() => {
            Vencord.Api.UserArea.addUserAreaButton("stream-crasher-account-button", () =>
                settings.store.buttonLocation === "account" ? <CrashButtonAccount /> : null
            );
        }, 500);
    },

    stop() {
        if (recordingActive && recordingHandler) {
            window.removeEventListener("keydown", recordingHandler, true);
            recordingHandler = null;
            recordingActive = false;
        }
        Native.unregisterGlobalKeybind();
        stopKeybindLoop();
        Vencord.Api.UserArea.removeUserAreaButton("stream-crasher-account-button");
    },

    flux: {
        STREAM_CREATE() {
            isStreamingNow = ApplicationStreamingStore.getCurrentUserActiveStream() != null;
            syncKeybindLoop();
            if (settings.store.autoDisableOnStream !== false) {
                suppressStateChange = true;
                settings.store.isEnabled = false;
                suppressStateChange = false;
                isEnabledCache = false;
            } else if (isStreamingNow && settings.store.isEnabled) {
                playToggleSound(true);
                updateStream(true);
            }
        },
        STREAM_UPDATE() {
            isStreamingNow = ApplicationStreamingStore.getCurrentUserActiveStream() != null;
        },
        STREAM_DELETE() {
            isStreamingNow = ApplicationStreamingStore.getCurrentUserActiveStream() != null;
            syncKeybindLoop();
        },
        MEDIA_ENGINE_SET_GO_LIVE_SOURCE(data) {
            isStreamingNow = ApplicationStreamingStore.getCurrentUserActiveStream() != null;
            syncKeybindLoop();
            const sourceId = data.settings?.desktopSettings?.sourceId;
            const qualityOptions = data.settings?.qualityOptions;
            if (sourceId && sourceId !== "" && setLastSourceId(sourceId, qualityOptions) && settings.store.isEnabled && settings.store.autoDisableOnStream === false) {
                playToggleSound(true);
                updateStream(true);
            }
        },
        STREAM_STOP() {
            if (settings.store.autoDisableOnStream !== false) {
                suppressStateChange = true;
                settings.store.isEnabled = false;
                suppressStateChange = false;
                isEnabledCache = false;
            }
            isStreamingNow = false;
            syncKeybindLoop();
            Native.stopCrashSource();
        }
    },

    patches: [
        {
            find: "_handleVideo",
            replacement: {
                match: /if\(null!=this\._connection&&this\.userId!==t\)\{/,
                replace: 'if($self.isSettingEnabled&&this.context==="Stream")return;$&'
            }
        },
        {
            find: "ClipsPanelButton",
            replacement: {
                match: /return ([\w$]+&&[\w$]+)\?(\(0,[\w$.]+\)\([\w$.]+,\{disabled:[^,]+,tooltipText:[\w$.]+,onClick:\(\)=>\{[^}]*\},onContextMenu:[\w$.]+,icon:[\w$.]+\}\)):null/,
                replace: "return $1?[$2,$self.CrashButtonStream()]:null"
            }
        }
    ],

    get isSettingEnabled() {
        return isEnabledCache;
    },

    CrashButtonAccount: ErrorBoundary.wrap(CrashButtonAccount, { noop: true }),
    CrashButtonStream: ErrorBoundary.wrap(CrashButtonStream, { noop: true })
});

export default StreamCrasherPlugin;