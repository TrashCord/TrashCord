/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import managedStyle from "./style.css?managed";

import { showNotification } from "@api/Notifications";
import { definePluginSettings } from "@api/Settings";
import ErrorBoundary from "@components/ErrorBoundary";
import { Heading } from "@components/Heading";
import { HeadphonesIcon } from "@components/Icons";
import { Paragraph } from "@components/Paragraph";
import SettingsPlugin from "@plugins/_core/settings";
import { removeFromArray } from "@utils/misc";
import definePlugin, { OptionType, PluginNative, ReporterTestable } from "@utils/types";
import { Alerts, Button, React, Select, SettingsRouter, showToast, TextInput, Toasts } from "@webpack/common";

import type { ActionInfo, InstallInfo, NativeResult, PatchMethod, StereoMethod2Quality } from "./native";

const Native = VencordNative.pluginHelpers.StereoInstaller as PluginNative<typeof import("./native")>;

const SETTINGS_ENTRY_KEY  = "illegalcord_stereo_installer";
const DAC_SOURCE_URL      = "https://github.com/ProdHallow/Discord-Stereo-Windows-MacOS-Linux";
const VP_SOURCE_URL       = "https://codeberg.org/UnpackedX/Discord-Experimental-Subsystem";
const VP_TUTORIAL_URL     = "https://www.youtube.com/watch?v=zSIIganbZxg";

const MAX_LOG_LINES = 150;

type InstallerMethod = "method1" | "method2";
type InstallStatus   = "idle" | "patched" | "repatch-needed" | "unpatched" | "error";

const METHOD_LABELS: Record<InstallerMethod, string> = {
    method1: "Discord Audio Collective",
    method2: "Voice Playground",
};

const METHOD_LAST_PATCH_KEYS: Record<InstallerMethod, keyof InstallInfo["lastPatchLabels"]> = {
    method1: "discordAudioCollective",
    method2: "voicePlayground",
};

const METHOD_OPTIONS = [
    { label: "Discord Audio Collective Method (Default)", value: "method1" as InstallerMethod },
    { label: "Voice Playground Method",                   value: "method2" as InstallerMethod },
];

const METHOD2_QUALITY_OPTIONS = [
    { label: "128 kbps  (recommended for low-end PCs)", value: "128" as StereoMethod2Quality },
    { label: "384 kbps",                                value: "384" as StereoMethod2Quality },
    { label: "512 kbps",                                value: "512" as StereoMethod2Quality },
];

const shownNotifyKeys = new Set<string>();

const PATCH_METHOD_DISPLAY: Record<PatchMethod, string> = {
    discordAudioCollective: "Discord Audio Collective Method",
    voicePlayground: "Voice Playground Method",
};

function notifyRepatchIfNeeded(info: InstallInfo): void {
    if (!settings.store.enableNotifications) return;
    if (!info.repatchWarning) return;

    const key = `${info.discordRoot}::${info.repatchWarning}`;
    if (shownNotifyKeys.has(key)) return;
    shownNotifyKeys.add(key);

    showNotification({
        title: "StereoInstaller - Repatch needed",
        body: info.repatchWarning,
        permanent: false,
        onClick: () => SettingsRouter.openUserSettings(`${SETTINGS_ENTRY_KEY}_panel`),
    });
}

async function runAutoPatchIfNeeded(detected: InstallInfo): Promise<void> {
    if (!settings.store.autoPatchOnStart) return;

    const needsRepatch = detected.installStatus === "needsReinstall";
    const notInstalled = detected.installStatus === "notInstalled";
    const shouldPatch = settings.store.autoPatchOnlyOnRepatchNeeded ? needsRepatch : (needsRepatch || notInstalled);
    if (!shouldPatch) return;

    const wantsMethod2 = settings.store.autoPatchMethod === "method2";
    const method: PatchMethod = wantsMethod2 && detected.platformKey === "windows"
        ? "voicePlayground"
        : "discordAudioCollective";

    if (settings.store.enableNotifications) {
        showNotification({
            title: "StereoInstaller - Auto-patch",
            body: `Reapplying ${PATCH_METHOD_DISPLAY[method]}. Discord will restart briefly.`,
            permanent: false,
        });
    }

    await (method === "voicePlayground"
        ? Native.patchMethod2(detected.discordRoot, settings.store.autoPatchQuality as StereoMethod2Quality)
        : Native.patch(detected.discordRoot));
}

function deriveStatus(info: InstallInfo | null, hasError: boolean): InstallStatus {
    if (hasError) return "error";
    if (!info)    return "idle";
    if (info.installStatus === "needsReinstall") return "repatch-needed";
    return info.installStatus === "installed" ? "patched" : "unpatched";
}

const STATUS_CFG: Record<InstallStatus, { icon: string; label: string; mod: string; }> = {
    "idle":            { icon: "○", label: "Not detected",   mod: "idle" },
    "patched":         { icon: "✓", label: "Patched",        mod: "patched" },
    "repatch-needed":  { icon: "⚠", label: "Repatch needed", mod: "warn" },
    "unpatched":       { icon: "●", label: "Not patched",    mod: "idle" },
    "error":           { icon: "✗", label: "Error",          mod: "error" },
};

const openDacSource  = () => VencordNative.native.openExternal(DAC_SOURCE_URL);
const openVpSource   = () => VencordNative.native.openExternal(VP_SOURCE_URL);
const openVpTutorial = () => VencordNative.native.openExternal(VP_TUTORIAL_URL);

function StatusBadge({ status, busy }: { status: InstallStatus; busy: boolean; }) {
    if (busy) return <span className="vc-stereo-badge vc-stereo-badge--busy">⟳ Working…</span>;
    const { icon, label, mod } = STATUS_CFG[status];
    return <span className={`vc-stereo-badge vc-stereo-badge--${mod}`}>{icon} {label}</span>;
}

function InfoLine({ label, value, warn }: { label: string; value: string; warn?: boolean; }) {
    return (
        <div className="vc-stereo-info-line">
            <span>{label}</span>
            <code className={warn ? "vc-stereo-code--warn" : ""}>{value || "-"}</code>
        </div>
    );
}

function logLineVariant(line: string): "ok" | "warn" | "fail" | "section" | "default" {
    const body = line.replace(/^\[[^\]]*\]\s*/, "");
    if (body.startsWith("FAIL:")) return "fail";
    if (body.startsWith("WARN:")) return "warn";
    if (body.startsWith("OK:"))   return "ok";
    if (body.startsWith("==="))  return "section";
    return "default";
}

function LogPanel({ lines, onClear }: { lines: string[]; onClear: () => void; }) {
    const logRef  = React.useRef<HTMLDivElement>(null);
    const linesRef = React.useRef(lines);
    linesRef.current = lines;

    React.useEffect(() => {
        const el = logRef.current;
        if (el) el.scrollTop = el.scrollHeight;
    }, [lines.length]);

    const handleCopy = React.useCallback(() => {
        navigator.clipboard.writeText(linesRef.current.join("\n")).then(
            () => showToast("Log copied to clipboard.", Toasts.Type.SUCCESS),
            () => showToast("Failed to copy log.", Toasts.Type.FAILURE),
        );
    }, []);

    return (
        <div className="vc-stereo-log-panel">
            <div className="vc-stereo-log-toolbar">
                <span className="vc-stereo-log-title">
                    Console - {lines.length}/{MAX_LOG_LINES} line{lines.length !== 1 ? "s" : ""}
                </span>
                <Button className="vc-stereo-btn vc-stereo-btn--brand" color={Button.Colors.PRIMARY} size={Button.Sizes.TINY} onClick={handleCopy}>Copy</Button>
                <Button className="vc-stereo-btn vc-stereo-btn--red"   color={Button.Colors.RED}     size={Button.Sizes.TINY} onClick={onClear}>Clear</Button>
            </div>
            <div ref={logRef} className="vc-stereo-log">
                {lines.length === 0 && <div className="vc-stereo-log-line vc-stereo-log-line--empty">No activity logged yet.</div>}
                {lines.map((line, i) => (
                    <div key={i} className={`vc-stereo-log-line vc-stereo-log-line--${logLineVariant(line)}`}>{line}</div>
                ))}
            </div>
        </div>
    );
}

function SettingToggle({ label, description, value, onChange }: { label: string; description: string; value: boolean; onChange: (value: boolean) => void; }) {
    return (
        <div className="vc-stereo-settings-row">
            <div>
                <span>{label}</span>
                <Paragraph>{description}</Paragraph>
            </div>
            <button
                type="button"
                aria-pressed={value}
                className={`vc-stereo-toggle${value ? " vc-stereo-toggle--on" : ""}`}
                onClick={() => onChange(!value)}
            >
                <span className="vc-stereo-toggle-knob" />
            </button>
        </div>
    );
}

function StereoSettingsSection() {
    const [, forceRerender] = React.useReducer((n: number) => n + 1, 0);

    const toggle = React.useCallback((key: "enableNotifications" | "autoDetectOnOpen" | "autoDetectOnStart" | "autoPatchOnStart" | "autoPatchOnlyOnRepatchNeeded") => {
        settings.store[key] = !settings.store[key];
        forceRerender();
    }, []);

    const setAutoPatchMethod = React.useCallback((value: InstallerMethod) => {
        settings.store.autoPatchMethod = value;
        forceRerender();
    }, []);

    const setAutoPatchQuality = React.useCallback((value: StereoMethod2Quality) => {
        settings.store.autoPatchQuality = value;
        forceRerender();
    }, []);

    return (
        <div className="vc-stereo-settings-section" id="vc-stereo-settings">
            <Heading tag="h2" style={{ margin: 0 }}>Settings</Heading>
            <div className="vc-stereo-settings-grid">
                <SettingToggle
                    label="Repatch notifications"
                    description="Show a notification when Discord updates and the voice module needs repatching."
                    value={settings.store.enableNotifications}
                    onChange={() => toggle("enableNotifications")}
                />
                <SettingToggle
                    label="Auto-detect on open"
                    description="Auto-detect your Discord install when this panel opens."
                    value={settings.store.autoDetectOnOpen}
                    onChange={() => toggle("autoDetectOnOpen")}
                />
                <SettingToggle
                    label="Auto-detect on Discord start"
                    description="Silently check for repatch warnings in the background when Discord starts."
                    value={settings.store.autoDetectOnStart}
                    onChange={() => toggle("autoDetectOnStart")}
                />
                <SettingToggle
                    label="Auto-patch on Discord start"
                    description="Automatically reapply the patch when Discord starts. Discord restarts once if a patch is applied. Disabled by default."
                    value={settings.store.autoPatchOnStart}
                    onChange={() => toggle("autoPatchOnStart")}
                />

                {settings.store.autoPatchOnStart && (
                    <div className="vc-stereo-settings-subgroup">
                        <SettingToggle
                            label="Only when the update removed the patch"
                            description="Auto-patch only if Discord's own update wiped the voice module, never if you manually reverted it yourself."
                            value={settings.store.autoPatchOnlyOnRepatchNeeded}
                            onChange={() => toggle("autoPatchOnlyOnRepatchNeeded")}
                        />
                        <div className="vc-stereo-select-row">
                            <div>
                                <span>Auto-patch method</span>
                                <Paragraph>Installer method applied automatically at startup.</Paragraph>
                            </div>
                            <Select
                                options={METHOD_OPTIONS}
                                select={setAutoPatchMethod}
                                isSelected={(v: InstallerMethod) => v === settings.store.autoPatchMethod}
                                serialize={(v: InstallerMethod) => v}
                            />
                        </div>
                        {settings.store.autoPatchMethod === "method2" && (
                            <div className="vc-stereo-select-row">
                                <div>
                                    <span>Auto-patch quality</span>
                                    <Paragraph>Voice Playground bitrate used when auto-patching. 128 kbps is recommended for low-end PCs.</Paragraph>
                                </div>
                                <Select
                                    options={METHOD2_QUALITY_OPTIONS}
                                    select={setAutoPatchQuality}
                                    isSelected={(v: StereoMethod2Quality) => v === settings.store.autoPatchQuality}
                                    serialize={(v: StereoMethod2Quality) => v}
                                />
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}

function StereoInstallerPanel() {
    const [root,            setRoot]            = React.useState("");
    const [info,            setInfo]            = React.useState<InstallInfo | ActionInfo | null>(null);
    const [statusMsg,       setStatusMsg]       = React.useState("Click Auto-detect to get started.");
    const [logs,            setLogs]            = React.useState<string[]>([]);
    const [busy,            setBusy]            = React.useState(false);
    const [hasError,        setHasError]        = React.useState(false);
    const [installerMethod, setInstallerMethod] = React.useState<InstallerMethod>("method1");
    const [method2Quality,  setMethod2Quality]  = React.useState<StereoMethod2Quality>("128");

    const status                 = React.useMemo(() => deriveStatus(info, hasError), [info, hasError]);
    const voicePlaygroundUnavail = React.useMemo(() => !!info && info.platformKey !== "windows", [info?.platformKey]);
    const hasRoot                = root.trim().length > 0;
    const selectedLastPatch      = React.useMemo(
        () => info?.lastPatchLabels[METHOD_LAST_PATCH_KEYS[installerMethod]] ?? "-",
        [info, installerMethod],
    );
    const statusMsgClass = `vc-stereo-status-msg vc-stereo-status-msg--${busy ? "busy" : (hasError ? "error" : status)}`;

    const addLogs = React.useCallback((newLines: string[] | undefined) => {
        if (!newLines?.length) return;
        setLogs(prev => {
            const next = [...prev, ...newLines];
            return next.length > MAX_LOG_LINES ? next.slice(-MAX_LOG_LINES) : next;
        });
    }, []);

    const clearLogs = React.useCallback(() => {
        setLogs([]);
        void Native.clearLogs();
    }, []);

    const runNative = React.useCallback(async <T,>(
        action: () => Promise<NativeResult<T>>
    ): Promise<T | null> => {
        setBusy(true);
        setHasError(false);
        try {
            const result = await action();
            addLogs(result.logs);
            if (!result.success) {
                setHasError(true);
                setStatusMsg(`Error: ${result.error}`);
                showToast(result.error, Toasts.Type.FAILURE);
                return null;
            }
            return result.data;
        } finally {
            setBusy(false);
        }
    }, [addLogs]);
    const hasAutoDetected = React.useRef(false);
    const hasLoadedLogs = React.useRef(false);

    React.useEffect(() => {
        if (hasLoadedLogs.current) return;
        hasLoadedLogs.current = true;

        void Native.readLogs().then(result => {
            if (result.success) addLogs(result.data);
        });
    }, [addLogs]);

    React.useEffect(() => {
        if (hasAutoDetected.current || !settings.store.autoDetectOnOpen) return;
        hasAutoDetected.current = true;

        void runNative(() => Native.autoDetect()).then(detected => {
            if (!detected) return;
            setInfo(detected);
            setRoot(detected.discordRoot);
            setHasError(false);
            setStatusMsg(detected.repatchWarning || `Detected: ${detected.clientLabel} (${detected.buildLabel})`);
            notifyRepatchIfNeeded(detected);
        });
    }, [runNative]);

    React.useEffect(() => {
        if (!voicePlaygroundUnavail || installerMethod !== "method2") return;
        setInstallerMethod("method1");
        setStatusMsg("Voice Playground is Windows-only. Switched to Discord Audio Collective.");
    }, [voicePlaygroundUnavail, installerMethod]);

    const handleAutoDetect = React.useCallback(async () => {
        const detected = await runNative(() => Native.autoDetect());
        if (!detected) return;
        setInfo(detected);
        setRoot(detected.discordRoot);
        setHasError(false);
        setStatusMsg(detected.repatchWarning || `Detected: ${detected.clientLabel} (${detected.buildLabel})`);
        notifyRepatchIfNeeded(detected);
    }, [runNative]);

    const handleBrowse = React.useCallback(async () => {
        const selected = await runNative(() => Native.chooseDiscordRoot());
        if (selected == null) return;
        setInfo(selected);
        setRoot(selected.discordRoot);
        setHasError(false);
        setStatusMsg(selected.repatchWarning || `Selected: ${selected.clientLabel} (${selected.buildLabel})`);
        notifyRepatchIfNeeded(selected);
    }, [runNative]);

    const handlePatch = React.useCallback(async () => {
        const result = await runNative<ActionInfo>(() =>
            installerMethod === "method2"
                ? Native.patchMethod2(root, method2Quality)
                : Native.patch(root)
        );
        if (!result) return;
        setInfo(result);
        setHasError(false);
        setStatusMsg("Patch scheduled - Discord will close briefly, apply the patch, then reopen.");
        showToast("Patch scheduled. Discord will restart shortly.", Toasts.Type.SUCCESS);
    }, [runNative, root, installerMethod, method2Quality]);

    const handleRevert = React.useCallback(async () => {
        const result = await runNative<ActionInfo>(() => Native.revert(root));
        if (!result) return;
        setInfo(result);
        setHasError(false);
        setStatusMsg("Revert scheduled - Discord will close briefly, restore the backup, then reopen.");
        showToast("Revert scheduled. Discord will restart shortly.", Toasts.Type.SUCCESS);
    }, [runNative, root]);

    const handleMethod2IndexPatch = React.useCallback(async () => {
        const result = await runNative<ActionInfo>(() => Native.patchMethod2Index(root));
        if (!result) return;
        setInfo(result);
        setHasError(false);
        setStatusMsg("index.js replacement scheduled - Discord will close briefly then reopen.");
        showToast("index.js replacement scheduled. Discord will restart shortly.", Toasts.Type.SUCCESS);
    }, [runNative, root]);

    const requireRoot = React.useCallback((fn: () => void): void => {
        if (!hasRoot) {
            showToast("Select a Discord install folder first - use Auto-detect or Browse.", Toasts.Type.FAILURE);
            return;
        }
        fn();
    }, [hasRoot]);

    const selectInstallerMethod = React.useCallback((value: InstallerMethod) => {
        if (value === "method2" && voicePlaygroundUnavail) {
            showToast("Voice Playground Method is only available on Windows.", Toasts.Type.FAILURE);
            setStatusMsg("Voice Playground Method is only available on Windows.");
            return;
        }
        setInstallerMethod(value);
    }, [voicePlaygroundUnavail]);

    const confirmPatch = React.useCallback(() => requireRoot(() => {
        const isM2 = installerMethod === "method2";
        Alerts.show({
            title: isM2 ? "Apply Voice Playground Method?" : "Apply Discord Audio Collective Method?",
            body: (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {isM2 ? (
                        <Paragraph>
                            Installs the local {method2Quality} kbps Voice Playground payload into Discord.
                            Only one method should be active at a time - revert to the backup before switching.
                        </Paragraph>
                    ) : (
                        <Paragraph>
                            Downloads and installs the Discord Audio Collective stereo module.
                            A backup of your original voice files will be saved automatically.
                        </Paragraph>
                    )}
                    <Paragraph>Discord will close briefly to apply the patch, then reopen automatically.</Paragraph>
                </div>
            ),
            confirmText: "Patch now",
            cancelText: "Cancel",
            confirmColor: Button.Colors.GREEN,
            onConfirm: () => void handlePatch(),
        });
    }), [requireRoot, installerMethod, method2Quality, handlePatch]);

    const confirmRevert = React.useCallback(() => requireRoot(() => {
        Alerts.show({
            title: "Revert to original Discord voice?",
            body: (
                <Paragraph>
                    Restores the unpatched backup saved before your first StereoInstaller patch.
                    Discord will close briefly then reopen automatically.
                </Paragraph>
            ),
            confirmText: "Revert",
            cancelText: "Cancel",
            confirmColor: Button.Colors.RED,
            onConfirm: () => void handleRevert(),
        });
    }), [requireRoot, handleRevert]);

    const confirmMethod2IndexPatch = React.useCallback(() => requireRoot(() => {
        Alerts.show({
            title: "Replace Voice Playground index.js?",
            body: (
                <Paragraph>
                    Replaces the index.js in the Discord voice module directory.
                    Use this only if Discord voice is broken after a Voice Playground patch.
                    Discord will close briefly then reopen.
                </Paragraph>
            ),
            confirmText: "Replace index.js",
            cancelText: "Cancel",
            confirmColor: Button.Colors.RED,
            onConfirm: () => void handleMethod2IndexPatch(),
        });
    }), [requireRoot, handleMethod2IndexPatch]);

    const handleRootChange = React.useCallback((v: string) => setRoot(v), []);

    return (
        <div className="vc-stereo-root" id="vc-stereo-panel">

            {}
            <div className="vc-stereo-header">
                <Heading tag="h4" style={{ margin: 0 }}>StereoInstaller</Heading>
                <StatusBadge status={status} busy={busy} />
            </div>

            {}
            <div className="vc-stereo-select-grid">

                <div className="vc-stereo-select-row">
                    <div>
                        <span>Installer method</span>
                        <Paragraph>
                            {voicePlaygroundUnavail
                                ? "Voice Playground is Windows-only."
                                : "Keep only one method active at a time."}
                        </Paragraph>
                    </div>
                    <Select
                        options={METHOD_OPTIONS}
                        select={selectInstallerMethod}
                        isSelected={(v: InstallerMethod) => v === installerMethod}
                        serialize={(v: InstallerMethod) => v}
                    />
                </div>

                {installerMethod === "method2" && (
                    <div className="vc-stereo-select-row">
                        <div>
                            <span>Voice Playground quality</span>
                            <Paragraph>Higher bitrate uses more CPU. Use 128 kbps on low-end PCs.</Paragraph>
                        </div>
                        <Select
                            options={METHOD2_QUALITY_OPTIONS}
                            select={(v: StereoMethod2Quality) => setMethod2Quality(v)}
                            isSelected={(v: StereoMethod2Quality) => v === method2Quality}
                            serialize={(v: StereoMethod2Quality) => v}
                        />
                    </div>
                )}

                <div className="vc-stereo-select-row">
                    <div>
                        <span>Source code</span>
                        <Paragraph>Each method has its own upstream repository.</Paragraph>
                    </div>
                    <div className="vc-stereo-source-buttons">
                        <Button
                            className="vc-stereo-btn vc-stereo-btn--brand"
                            color={Button.Colors.PRIMARY}
                            size={Button.Sizes.SMALL}
                            onClick={openDacSource}
                        >
                            Discord Audio Collective
                        </Button>
                        <Button
                            className="vc-stereo-btn vc-stereo-btn--brand"
                            color={Button.Colors.PRIMARY}
                            size={Button.Sizes.SMALL}
                            onClick={openVpSource}
                        >
                            Voice Playground
                        </Button>
                    </div>
                </div>

            </div>

            {}
            {installerMethod === "method2" && (
                <div className="vc-stereo-method2-note">
                    <Paragraph>
                        Voice Playground uses locally bundled payloads. Install only one method at a time.
                        If Discord voice breaks after patching, use the repair button and follow the tutorial.
                    </Paragraph>
                    <div className="vc-stereo-inline-buttons">
                        <Button
                            className="vc-stereo-btn vc-stereo-btn--brand"
                            color={Button.Colors.PRIMARY}
                            size={Button.Sizes.SMALL}
                            onClick={openVpTutorial}
                        >
                            Corruption fix tutorial
                        </Button>
                        <Button
                            className="vc-stereo-btn vc-stereo-btn--red"
                            color={Button.Colors.RED}
                            size={Button.Sizes.SMALL}
                            disabled={busy || !hasRoot}
                            onClick={confirmMethod2IndexPatch}
                        >
                            Replace index.js
                        </Button>
                    </div>
                </div>
            )}

            {}
            <div className="vc-stereo-controls">
                <TextInput
                    value={root}
                    placeholder="Discord install folder (e.g. C:\Users\...\AppData\Local\Discord)"
                    onChange={handleRootChange}
                    disabled={busy}
                />
                <div className="vc-stereo-buttons">
                    <Button
                        className="vc-stereo-btn vc-stereo-btn--brand"
                        color={Button.Colors.PRIMARY}
                        size={Button.Sizes.SMALL}
                        disabled={busy}
                        onClick={() => void handleAutoDetect()}
                    >
                        Auto-detect
                    </Button>
                    <Button
                        className="vc-stereo-btn vc-stereo-btn--brand"
                        color={Button.Colors.PRIMARY}
                        size={Button.Sizes.SMALL}
                        disabled={busy}
                        onClick={() => void handleBrowse()}
                    >
                        Browse
                    </Button>
                    <Button
                        className="vc-stereo-btn vc-stereo-btn--green"
                        color={Button.Colors.GREEN}
                        size={Button.Sizes.SMALL}
                        disabled={busy || !hasRoot}
                        onClick={confirmPatch}
                    >
                        Patch Discord voice
                    </Button>
                    <Button
                        className="vc-stereo-btn vc-stereo-btn--red"
                        color={Button.Colors.RED}
                        size={Button.Sizes.SMALL}
                        disabled={busy || !hasRoot}
                        onClick={confirmRevert}
                    >
                        Revert to backup
                    </Button>
                </div>
            </div>

            {}
            {info && (
                <div className={`vc-stereo-info vc-stereo-info--${status}`}>
                    <InfoLine label="Client"       value={info.clientLabel} />
                    <InfoLine label="Platform"     value={`${info.platformLabel} ${info.readableOs}`} />
                    <InfoLine label="Voice module" value={info.voiceDir} />
                    {"logPath" in info && <InfoLine label="Log file" value={(info as ActionInfo).logPath} />}
                    <InfoLine
                        label={`${METHOD_LABELS[installerMethod]} last patch`}
                        value={selectedLastPatch}
                        warn={status === "repatch-needed"}
                    />
                </div>
            )}

            {}
            <Paragraph className={statusMsgClass}>
                {busy ? "⟳ Working, please wait…" : statusMsg}
            </Paragraph>

            {}
            {logs.length > 0 && <LogPanel lines={logs} onClear={clearLogs} />}

        </div>
    );
}

const settings = definePluginSettings({
    enableNotifications: {
        type: OptionType.BOOLEAN,
        description: "Show a notification when Discord updates and the voice module needs repatching",
        default: true,
        restartNeeded: false,
    },
    autoDetectOnOpen: {
        type: OptionType.BOOLEAN,
        description: "Auto-detect your Discord install when the StereoInstaller panel opens",
        default: true,
        restartNeeded: false,
    },
    autoDetectOnStart: {
        type: OptionType.BOOLEAN,
        description: "Silently check for repatch warnings in the background when Discord starts",
        default: true,
        restartNeeded: false,
    },
    autoPatchOnStart: {
        type: OptionType.BOOLEAN,
        description: "Automatically reapply the patch when Discord starts (Discord restarts once if a patch is applied)",
        default: false,
        restartNeeded: false,
    },
    autoPatchOnlyOnRepatchNeeded: {
        type: OptionType.BOOLEAN,
        description: "Only auto-patch when a Discord update removed the patch, never when it was manually reverted or never installed",
        default: true,
        restartNeeded: false,
    },
    autoPatchMethod: {
        type: OptionType.SELECT,
        description: "Installer method to use for Auto-patch on Discord start",
        options: [
            { label: "Discord Audio Collective Method", value: "method1", default: true },
            { label: "Voice Playground Method",         value: "method2" },
        ],
        restartNeeded: false,
    },
    autoPatchQuality: {
        type: OptionType.SELECT,
        description: "Voice Playground quality to use for Auto-patch (only used if the method above is Voice Playground)",
        options: [
            { label: "128 kbps (recommended for low-end PCs)", value: "128", default: true },
            { label: "384 kbps",                                value: "384" },
            { label: "512 kbps",                                value: "512" },
        ],
        restartNeeded: false,
    },
    installer: {
        type: OptionType.COMPONENT,
        component: ErrorBoundary.wrap(StereoInstallerPanel, { noop: true }),
    },
});

function StereoWarning() {
    return (
        <div className="vc-stereo-warning" id="vc-stereo-warning">
            <Heading tag="h4">Before you use StereoInstaller</Heading>
            <Paragraph>
                StereoInstaller replaces local Discord voice files to unlock higher audio quality.
                A backup of your original files is saved automatically before any changes are made.
            </Paragraph>
            <Paragraph>
                Keep only one method installed at a time.
                Always revert to the backup before switching methods, or after a Discord update
                if voice stops working.
            </Paragraph>
            <div className="vc-stereo-warning-critical">
                <span className="vc-stereo-warning-critical-icon">⚠</span>
                <Paragraph className="vc-stereo-critical-text">
                    Patching turns off Discord's{" "}
                    <span className="vc-stereo-critical-term">Krisp</span>,{" "}
                    <span className="vc-stereo-critical-term">Standard</span> and{" "}
                    <span className="vc-stereo-critical-term">Echo cancellation</span>{" "}
                    noise suppression. Revert to get them back.
                </Paragraph>
            </div>
        </div>
    );
}

function StereoInstallerPage() {
    return (
        <>
            <StereoWarning />
            <StereoInstallerPanel />
            <StereoSettingsSection />
        </>
    );
}

export default definePlugin({
    name: "StereoInstaller",
    description: "Installs and reverts the Discord stereo voice module (Discord Audio Collective or Voice Playground).",
    authors: [{ name: "irritably", id: 928787166916640838n }, { name: "zfrancesck1", id: 456195985404592149n }],
    tags: ["Utility", "Voice", "Audio"],
    enabledByDefault: true,
    managedStyle,
    reporterTestable: ReporterTestable.None,
    settings,
    settingsAboutComponent: ErrorBoundary.wrap(StereoWarning, { noop: true }),
    toolboxActions: {
        "Open StereoInstaller": () => SettingsRouter.openUserSettings(`${SETTINGS_ENTRY_KEY}_panel`),
    },

    start() {
        if (!SettingsPlugin.customEntries.some(e => e.key === SETTINGS_ENTRY_KEY)) {
            SettingsPlugin.customEntries.push({
                key: SETTINGS_ENTRY_KEY,
                title: "StereoInstaller",
                Component: ErrorBoundary.wrap(StereoInstallerPage, { noop: true }),
                Icon: HeadphonesIcon,
            });
        }

        if (settings.store.autoDetectOnStart || settings.store.autoPatchOnStart) {
            void Native.shouldRunStartupChecks().then(gate => {
                if (!gate.success || !gate.data) return;

                void Native.autoDetect().then(result => {
                    if (!result.success) return;
                    notifyRepatchIfNeeded(result.data);
                    void runAutoPatchIfNeeded(result.data);
                }, () => void 0);
            }, () => void 0);
        }
    },

    stop() {
        removeFromArray(SettingsPlugin.customEntries, e => e.key === SETTINGS_ENTRY_KEY);
    },
});