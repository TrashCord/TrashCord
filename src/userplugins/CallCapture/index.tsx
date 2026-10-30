/*
 * TrashCord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ApplicationCommandInputType } from "@api/Commands";
import { HeaderBarButton } from "@api/HeaderBar";
import { showNotification } from "@api/Notifications";
import { definePluginSettings } from "@api/Settings";
import { UserAreaButton } from "@api/UserArea";
import ErrorBoundary from "@components/ErrorBoundary";
import { HeadingSecondary } from "@components/Heading";
import { openPluginModal } from "@components/settings";
import definePlugin, { OptionType, PluginSettingComponentProps } from "@utils/types";
import { findByPropsLazy, findStoreLazy } from "@webpack";
import { Avatar, ChannelStore, FluxDispatcher, IconUtils, React, RelationshipStore, Select, SelectedChannelStore, showToast, UploadHandler, useEffect, UserStore, useState } from "@webpack/common";
import { Button, SearchableSelect, TextInput } from "@webpack/common/components";

import { checkOutput, getMicLabel, getRecordingStart, isCurrentlyRecording, onSaved, setLevels, startRecording, startReplay, stopAll, stopRecording, testMic } from "./recorder";
import { buildClip, isRewinding, setRewindSeconds } from "./rewind";
import { Common, emitState, getNative, Kind, Profile, SaveResult, subscribeState } from "./shared";

type ButtonId = "clip" | "record";
type Item = [string, string | number];
type Show = "always" | "voice" | "video";

const VoiceStateStore = findStoreLazy("VoiceStateStore") ?? findByPropsLazy("getVoiceState");

const BUTTON_IDS: Record<ButtonId, string> = {
    clip: "call-capture-clip-button",
    record: "call-capture-record-button"
};

const LOOPBACK_INPUT = /mix|missaggio|mixage|cable|voicemeeter|vb-audio|loopback|what u hear/i;

const TYPES: Item[] = [["Voice Only", "voice"], ["Voice + Video", "video"]];
const SOURCES: Item[] = [["Mic + Others", "both"], ["Mic Only", "mic"], ["Others Only", "others"]];
const KHZ: Item[] = [["48 kHz", 48000], ["44.1 kHz", 44100], ["24 kHz", 24000], ["16 kHz", 16000]];
const KBPS: Item[] = [["64 kbps", 64], ["96 kbps", 96], ["128 kbps", 128], ["192 kbps", 192], ["256 kbps", 256]];
const VQ: Item[] = [["Auto", 0], ["2 Mbps", 2000], ["4 Mbps", 4000], ["6 Mbps", 6000], ["8 Mbps", 8000], ["12 Mbps", 12000], ["16 Mbps", 16000], ["25 Mbps", 25000]];
const REC_AUDIO: Item[] = [["OGG / Opus", "ogg"], ["M4A / AAC", "mp4"], ["WebM / Opus", "webm"]];
const REC_VIDEO: Item[] = [["MP4 / H.264", "mp4"], ["WebM / VP8", "webm"], ["MKV / H.264", "mkv"]];
const CLIP_AUDIO: Item[] = [["OGG / Opus", "ogg"], ["WAV", "wav"]];
const CLIP_VIDEO: Item[] = [["MP4 / H.264", "mp4"], ["MKV / H.264", "mkv"], ["WebM / VP8", "webm"]];
const PLACES: Item[] = [["Header Bar", "header"], ["Account Section", "account"], ["Hidden", "none"]];

const labelStyle = { fontSize: 14, fontWeight: 500, color: "#e3e5e8", marginBottom: 8, fontFamily: "var(--font-primary)" };
const hintStyle = { fontSize: 12, color: "var(--text-muted)" };

function choice(description: string, items: Item[], def: string | number) {
    return {
        type: OptionType.SELECT as const,
        description,
        options: items.map(([label, value]) => ({ label, value, default: value === def }))
    };
}

function SectionSeparator(title: string, hint: string) {
    return (
        <>
            <hr style={{ width: "100%" }} />
            <HeadingSecondary>{title}</HeadingSecondary>
            {hint && <div style={{ ...hintStyle, marginBottom: 8 }}>{hint}</div>}
            <hr style={{ width: "100%" }} />
        </>
    );
}

const separator = (title: string, hint = "") => ({
    type: OptionType.COMPONENT as const,
    description: "",
    component: () => SectionSeparator(title, hint)
});

const volume = (description: string) => ({
    type: OptionType.SLIDER as const,
    description,
    markers: [0, 25, 50, 75, 100, 125, 150, 200],
    default: 100,
    stickToMarkers: false,
    componentProps: {
        onValueRender: (v: number) => `${Math.round(v)}%`,
        onMarkerRender: (v: number) => `${v}%`
    },
    onChange: () => pushLevels()
});

const BlacklistSelector = (props: PluginSettingComponentProps) => {
    const options = React.useMemo(
        () => (RelationshipStore?.getFriendIDs?.() ?? [])
            .map((id: string) => UserStore?.getUser?.(id))
            .filter(Boolean)
            .map((f: any) => ({
                label: f.globalName || f.username,
                value: f.id
            })),
        []
    );
    const val = getBlacklist();

    return (
        <div style={{ marginBottom: 12 }}>
            <div style={labelStyle}>Blacklisted friends (nothing is captured while they are in your call)</div>
            <SearchableSelect
                options={options}
                value={val}
                onChange={(v: string[]) => props.setValue(v)}
                placeholder="Select friends..."
                multi={true}
                {...{
                    renderOption: (opt: any) => {
                        const u = UserStore?.getUser?.(opt.value);
                        return (
                            <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "10px 16px 10px 14px" }}>
                                <div style={{ marginLeft: 8 }}>
                                    <Avatar src={IconUtils?.getUserAvatarURL?.(u) || ""} size={"SIZE_32" as any} />
                                </div>
                                <span style={{ fontSize: 14, fontWeight: 500, color: "var(--text-normal)" }}>{opt.label}</span>
                            </div>
                        );
                    },
                    renderOptionLabel: (opt: any) => {
                        const u = UserStore?.getUser?.(opt.value);
                        return (
                            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                <Avatar src={IconUtils?.getUserAvatarURL?.(u) || ""} size={"SIZE_20" as any} />
                                <span style={{ color: "var(--text-normal)" }}>{opt.label}</span>
                            </div>
                        );
                    }
                } as any}
            />
        </div>
    );
};

function deviceSelector(key: "micDevice" | "playbackDevice", title: string, def: string) {
    return {
        type: OptionType.COMPONENT as const,
        default: def,
        component: function DeviceSelector(_props: PluginSettingComponentProps): JSX.Element {
            const value = (settings.use([key]) as Record<string, any>)[key];
            const [devices, setDevices] = useState<Array<{ label: string; value: string; }>>([]);
            const [warning, setWarning] = useState("");
            const [busyTest, setBusyTest] = useState(false);
            const playback = key === "playbackDevice";

            useEffect(() => {
                navigator.mediaDevices.enumerateDevices()
                    .then(list => {
                        const real = list.filter(d => d.deviceId !== "default" && d.deviceId !== "communications");
                        const name = (d: MediaDeviceInfo) => d.label || d.deviceId;

                        if (!playback) {
                            setDevices(real.filter(d => d.kind === "audioinput").map(d => ({ label: name(d), value: d.deviceId })));
                            return;
                        }

                        const outputs = real.filter(d => d.kind === "audiooutput").map(d => ({ label: name(d), value: `out:${d.deviceId}` }));
                        const loopbacks = real.filter(d => d.kind === "audioinput" && LOOPBACK_INPUT.test(d.label)).map(d => ({ label: name(d), value: d.deviceId }));
                        setDevices([...outputs, ...loopbacks]);
                    })
                    .catch(() => { });
            }, []);

            useEffect(() => {
                if (playback) checkOutput(String(value)).then(msg => setWarning(msg ?? "")).catch(() => { });
            }, [value]);

            const runTest = () => {
                setBusyTest(true);
                testMic(readCommon(), readProfile("record"))
                    .then(label => { if (label) say("Playing back 4 seconds of your mic", label); })
                    .catch(() => { })
                    .finally(() => setBusyTest(false));
            };

            return (
                <div style={{ marginBottom: 12 }}>
                    <div style={labelStyle}>{title}</div>
                    <Select
                        options={[{ label: "Default", value: def }, ...devices]}
                        placeholder="Default"
                        isSelected={(v: string) => v === value}
                        select={(v: string) => { (settings.store as Record<string, any>)[key] = v; }}
                        serialize={(v: string) => v}
                    />
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}>
                        <div style={{ flex: 1, ...(warning ? { fontSize: 12, color: "var(--status-warning)" } : hintStyle) }}>
                            {playback
                                ? warning || "Default is the Windows output. The device you pick must be the Windows default."
                                : "Default is the device selected in Discord. Test plays back 4 seconds of your mic with the current settings."}
                        </div>
                        {playback ? (
                            <Button size={Button.Sizes.SMALL} onClick={() => { void getNative()?.openSoundSettings?.(); }}>
                                Windows sound
                            </Button>
                        ) : (
                            <Button size={Button.Sizes.SMALL} disabled={busyTest} onClick={runTest}>
                                Test
                            </Button>
                        )}
                    </div>
                </div>
            );
        }
    };
}

function visible(show: Show, type: unknown): boolean {
    return show === "always" || (show === "video") === (type === "video");
}

function pick(prefix: Kind, suffix: string, title: string, items: Item[], def: string | number, show: Show = "always") {
    const key = prefix + suffix;
    const typeKey = `${prefix}Type`;

    return {
        type: OptionType.COMPONENT as const,
        default: def,
        component: function PickField(_props: PluginSettingComponentProps): JSX.Element | null {
            const s = settings.use([key, typeKey] as any) as Record<string, any>;
            if (!visible(show, s[typeKey])) return null;

            return (
                <div style={{ marginBottom: 12 }}>
                    <div style={labelStyle}>{title}</div>
                    <Select
                        options={items.map(([label, value]) => ({ label, value }))}
                        isSelected={(v: string | number) => v === s[key]}
                        select={(v: string | number) => { (settings.store as Record<string, any>)[key] = v; }}
                        serialize={(v: string | number) => v}
                    />
                </div>
            );
        }
    };
}

function field(prefix: Kind, suffix: string, title: string, def: string, show: Show = "always") {
    const key = prefix + suffix;
    const typeKey = `${prefix}Type`;

    return {
        type: OptionType.COMPONENT as const,
        default: def,
        component: function TextField(_props: PluginSettingComponentProps): JSX.Element | null {
            const s = settings.use([key, typeKey] as any) as Record<string, any>;
            if (!visible(show, s[typeKey])) return null;

            return (
                <div style={{ marginBottom: 12 }}>
                    <div style={labelStyle}>{title}</div>
                    <TextInput
                        value={String(s[key] ?? "")}
                        onChange={(v: string) => { (settings.store as Record<string, any>)[key] = v; }}
                    />
                </div>
            );
        }
    };
}

function screenField(prefix: Kind, def: string) {
    const key = `${prefix}Target`;
    const typeKey = `${prefix}Type`;

    return {
        type: OptionType.COMPONENT as const,
        default: def,
        component: function ScreenField(_props: PluginSettingComponentProps): JSX.Element | null {
            const s = settings.use([key, typeKey] as any) as Record<string, any>;
            const [screens, setScreens] = useState<Array<{ id: string; name: string; }>>([]);

            useEffect(() => {
                Promise.resolve(getNative()?.getDesktopSources?.())
                    .then(list => setScreens(Array.isArray(list) ? list : []))
                    .catch(() => { });
            }, []);

            if (s[typeKey] !== "video") return null;

            const items: Item[] = [["Discord Window", "window"]];
            if (screens.length > 1) screens.forEach((screen, i) => items.push([screen.name || `Screen ${i + 1}`, screen.id]));
            else items.push(["Entire Screen", "screen"]);

            const current = s[key] === "screen" && screens.length > 1 ? screens[0].id : s[key];

            return (
                <div style={{ marginBottom: 12 }}>
                    <div style={labelStyle}>Video source</div>
                    <Select
                        options={items.map(([label, value]) => ({ label, value }))}
                        isSelected={(v: string | number) => v === current}
                        select={(v: string | number) => { (settings.store as Record<string, any>)[key] = v; }}
                        serialize={(v: string | number) => v}
                    />
                </div>
            );
        }
    };
}

function folderSelector(key: "replayFolder" | "recordFolder" | "autoFolder", title: string, placeholder: string) {
    return {
        type: OptionType.COMPONENT as const,
        default: "",
        component: function FolderSelector(props: PluginSettingComponentProps): JSX.Element {
            return (
                <div style={{ marginBottom: 12 }}>
                    <div style={labelStyle}>{title}</div>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                        <div style={{ flex: 1 }}>
                            <TextInput
                                value={(settings.store as Record<string, any>)[key] || ""}
                                placeholder={placeholder}
                                onChange={(v: string) => props.setValue(v)}
                            />
                        </div>
                        <Button
                            size={Button.Sizes.SMALL}
                            onClick={async () => {
                                try {
                                    const dir = await getNative()?.pickDirectory?.();
                                    if (dir) props.setValue(dir);
                                } catch { }
                            }}
                        >
                            Browse
                        </Button>
                    </div>
                </div>
            );
        }
    };
}

const settings = definePluginSettings({
    _sepGeneral: separator("🎙 General", "Microphone and call audio used by every mode below."),
    micDevice: deviceSelector("micDevice", "Input Device", "auto"),
    playbackDevice: deviceSelector("playbackDevice", "Output Device", "system"),
    echoCancellation: {
        type: OptionType.BOOLEAN,
        description: "Echo cancellation from the browser (Discord plays the call outside the browser, so it often has no effect)",
        default: true
    },
    noiseSuppression: {
        type: OptionType.BOOLEAN,
        description: "Noise suppression from the browser",
        default: true
    },
    noiseGate: {
        type: OptionType.SLIDER as const,
        description: "Noise gate: silences your mic below this level (0 = off, turning it on applies from the next call)",
        markers: [-80, -70, -60, -50, -40, -30, -20, 0],
        default: -50,
        stickToMarkers: false,
        componentProps: {
            onValueRender: (v: number) => (v >= 0 ? "Off" : `${Math.round(v)} dB`),
            onMarkerRender: (v: number) => (v >= 0 ? "Off" : `${v}`)
        },
        onChange: () => pushLevels()
    },
    inputVolume: volume("Input Volume"),
    outputVolume: volume("Output Volume"),
    silenceWhenMuted: {
        type: OptionType.BOOLEAN,
        description: "Silence the microphone while you are muted or deafened in Discord",
        default: true,
        onChange: () => pushLevels()
    },
    askBeforeSave: {
        type: OptionType.BOOLEAN,
        description: "Ask where to save recordings",
        default: false
    },
    blacklist: {
        type: OptionType.COMPONENT,
        component: BlacklistSelector,
        default: []
    },

    _sepReplay: separator("⚡ Shadowplay", "Keeps the last seconds of every call in memory. Press the clip button to save them as a file. Changes apply from the next call."),
    replayEnabled: {
        type: OptionType.BOOLEAN,
        description: "Keep the replay buffer during calls",
        default: true
    },
    replaySeconds: {
        type: OptionType.NUMBER,
        description: "Length in seconds (0 = unlimited, uses more RAM)",
        default: 120,
        onChange: (v: number) => setRewindSeconds(v)
    },
    replayType: pick("replay", "Type", "Type", TYPES, "voice"),
    replaySources: pick("replay", "Sources", "Audio sources", SOURCES, "both"),
    replayAudio: pick("replay", "Audio", "Voice format", CLIP_AUDIO, "ogg", "voice"),
    replayVideo: pick("replay", "Video", "Video format", CLIP_VIDEO, "mp4", "video"),
    replayKhz: pick("replay", "Khz", "Sample rate", KHZ, 44100),
    replayKbps: pick("replay", "Kbps", "Audio bitrate", KBPS, 64),
    replaySize: field("replay", "Size", "Resolution (WxH)", "1280x720", "video"),
    replayFps: field("replay", "Fps", "FPS", "30", "video"),
    replayVq: pick("replay", "Vq", "Video bitrate", VQ, 0, "video"),
    replayTarget: screenField("replay", "screen"),
    replayFolder: folderSelector("replayFolder", "Clips folder", "Empty = Videos\\Discord\\Clips"),
    replayUpload: {
        type: OptionType.BOOLEAN,
        description: "Attach the clip to the current chat",
        default: false
    },

    _sepRecord: separator("⏺ Recording", "Records the call from when you press the record button (or hotkey, or /record) until you press it again."),
    recordType: pick("record", "Type", "Type", TYPES, "video"),
    recordSources: pick("record", "Sources", "Audio sources", SOURCES, "both"),
    recordAudio: pick("record", "Audio", "Voice format", REC_AUDIO, "ogg", "voice"),
    recordVideo: pick("record", "Video", "Video format", REC_VIDEO, "mp4", "video"),
    recordKhz: pick("record", "Khz", "Sample rate", KHZ, 44100),
    recordKbps: pick("record", "Kbps", "Audio bitrate", KBPS, 96),
    recordSize: field("record", "Size", "Resolution (WxH)", "1280x720", "video"),
    recordFps: field("record", "Fps", "FPS", "30", "video"),
    recordVq: pick("record", "Vq", "Video bitrate", VQ, 0, "video"),
    recordTarget: screenField("record", "screen"),
    recordFolder: folderSelector("recordFolder", "Recordings folder", "Empty = Videos\\Discord\\Recordings"),

    _sepAuto: separator("🔁 Auto-record", "Starts a recording by itself every time you join a call."),
    autoRecord: {
        type: OptionType.BOOLEAN,
        description: "Record every call you join",
        default: false
    },
    autoType: pick("auto", "Type", "Type", TYPES, "voice"),
    autoSources: pick("auto", "Sources", "Audio sources", SOURCES, "both"),
    autoAudio: pick("auto", "Audio", "Voice format", REC_AUDIO, "ogg", "voice"),
    autoVideo: pick("auto", "Video", "Video format", REC_VIDEO, "mp4", "video"),
    autoKhz: pick("auto", "Khz", "Sample rate", KHZ, 24000),
    autoKbps: pick("auto", "Kbps", "Audio bitrate", KBPS, 64),
    autoSize: field("auto", "Size", "Resolution (WxH)", "1280x720", "video"),
    autoFps: field("auto", "Fps", "FPS", "15", "video"),
    autoVq: pick("auto", "Vq", "Video bitrate", VQ, 0, "video"),
    autoTarget: screenField("auto", "window"),
    autoFolder: folderSelector("autoFolder", "Auto-record folder", "Empty = Videos\\Discord\\Auto"),

    _sepButtons: separator("🎛 Buttons", "Quick buttons shown during a call. Right-click one to open these settings."),
    clipButton: {
        ...choice("Clip button (saves the replay buffer)", PLACES, "header"),
        onChange: () => syncButtons()
    },
    recordButton: {
        ...choice("Record button (start / stop recording)", PLACES, "header"),
        onChange: () => syncButtons()
    },

    _sepHotkeys: separator("⌨ Hotkeys", "Global shortcuts that work even when Discord is not focused. Active only during a call."),
    hotkeys: {
        type: OptionType.BOOLEAN,
        description: "Enable global hotkeys (the keys are captured by CallCapture)",
        default: false,
        onChange: () => syncHotkeys()
    },
    clipKey: {
        type: OptionType.STRING,
        description: "Save clip",
        default: "Alt+Shift+F2",
        onChange: () => syncHotkeys()
    },
    recordKey: {
        type: OptionType.STRING,
        description: "Start / stop recording",
        default: "Alt+Shift+F3",
        onChange: () => syncHotkeys()
    },

    _sepMessages: separator("🔔 Messages", "How CallCapture tells you what happened. Errors are always shown as toasts."),
    showToasts: {
        type: OptionType.BOOLEAN,
        description: "Toasts",
        default: true
    },
    showNotifications: {
        type: OptionType.BOOLEAN,
        description: "Notifications (click opens the folder)",
        default: false
    }
});

const bound: Record<ButtonId, string> = { clip: "", record: "" };
const accountAdded: Record<ButtonId, boolean> = { clip: false, record: false };

let lastChannelId: string | null | undefined = null;
let busy = false;
let unsubscribe: (() => void) | null = null;

function getBlacklist(): string[] {
    const v = settings.store.blacklist as unknown;
    return Array.isArray(v) ? v : (v ? [v as string] : []);
}

function num(value: unknown, fallback: number): number {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}

function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
}

function parseSize(value: unknown): [number, number] {
    const m = /(\d{3,5})\s*[x×*]\s*(\d{3,5})/i.exec(String(value));
    const w = m ? Number(m[1]) : 1280;
    const h = m ? Number(m[2]) : 720;
    return [clamp(w & ~1, 160, 7680), clamp(h & ~1, 90, 4320)];
}

function readCommon(): Common {
    const s = settings.store;
    return {
        micDevice: String(s.micDevice),
        playback: String(s.playbackDevice),
        echo: s.echoCancellation,
        noise: s.noiseSuppression,
        micVolume: Math.round(clamp(num(s.inputVolume, 100), 0, 200)),
        othersVolume: Math.round(clamp(num(s.outputVolume, 100), 0, 200)),
        follow: s.silenceWhenMuted,
        gateDb: Math.round(clamp(num(s.noiseGate, -50), -90, 0)),
        ask: s.askBeforeSave
    };
}

function readProfile(kind: Kind): Profile {
    const s = settings.store as Record<string, any>;
    const get = (key: string) => s[kind + key];
    const [width, height] = parseSize(get("Size"));
    const rate = Math.round(num(get("Fps"), 30));
    const fps = clamp(rate >= 1 ? rate : 30, 1, 240);
    const vq = num(get("Vq"), 0);
    const sources = String(get("Sources"));

    return {
        video: get("Type") === "video",
        mic: sources !== "others",
        others: sources !== "mic",
        target: String(get("Target")),
        audioFormat: String(get("Audio")),
        videoFormat: String(get("Video")),
        khz: num(get("Khz"), 48000),
        audioKbps: num(get("Kbps"), 128),
        width,
        height,
        fps,
        videoKbps: vq > 0 ? vq : Math.round(clamp(width * height * fps * 0.15 / 1000, 1500, 30000)),
        folder: String(get("Folder") ?? "")
    };
}

function pushLevels() {
    setLevels(readCommon());
}

function pad(n: number) {
    return String(n).padStart(2, "0");
}

function stamp(d: Date) {
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
}

function clock(ms: number) {
    const d = new Date(ms);
    return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fmtDuration(seconds: number) {
    const s = Math.round(seconds);
    if (s >= 3600) return `${Math.floor(s / 3600)}h ${pad(Math.floor((s % 3600) / 60))}m`;
    return s >= 60 ? `${Math.floor(s / 60)}m ${pad(s % 60)}s` : `${s}s`;
}

function say(title: string, detail = "", path?: string) {
    const s = settings.store;

    if (s.showToasts) showToast({ text: detail ? `${title} (${detail})` : title, variant: "success" });

    if (s.showNotifications) {
        const name = path ? path.split(/[\\/]/).pop() : "";
        showNotification({
            title,
            body: [detail, name].filter(Boolean).join(" - "),
            color: "#eb459e",
            onClick: path ? () => { void getNative()?.showInFolder(path); } : undefined
        });
    }
}

function fail(text: string) {
    showToast({ text, variant: "critical" });
}

function getConnectedVoiceChannelId(): string | null {
    const vcId = SelectedChannelStore?.getVoiceChannelId?.();
    if (vcId) return vcId;
    try {
        const currentUserId = UserStore?.getCurrentUser?.()?.id;
        if (currentUserId && VoiceStateStore?.getVoiceStateForUser) {
            const state = VoiceStateStore.getVoiceStateForUser(currentUserId);
            if (state?.channelId) return state.channelId;
        }
    } catch { }
    return null;
}

function isBlacklistedUserInChannel(channelId: string): boolean {
    const list = getBlacklist();
    if (list.length === 0) return false;
    const states = VoiceStateStore?.getVoiceStatesForChannel?.(channelId);
    if (!states) return false;
    return list.some(id => states[id] !== undefined);
}

function openSettings(): void {
    openPluginModal(CallCapturePlugin);
}

function onSettingsMenu(e: { preventDefault(): void; }): void {
    e.preventDefault();
    openSettings();
}

async function clip(channelId?: string) {
    if (busy) return;

    if (!isRewinding()) {
        fail("Shadowplay is off or you are not in a call.");
        return;
    }

    busy = true;

    try {
        const res = await buildClip(settings.store.replayAudio === "wav" ? "wav" : "ogg");
        if (!res) {
            fail("Nothing buffered yet, wait a few seconds.");
            return;
        }

        const filename = `Discord Clip ${stamp(new Date(Date.now() - res.seconds * 1000))}.${res.ext}`;
        const bytes = new Uint8Array(await res.blob.arrayBuffer());
        const path: string | null = await getNative()?.writeClip(settings.store.replayFolder, filename, bytes);

        if (!path) {
            fail("Failed to save clip.");
            return;
        }

        say("Clip saved", fmtDuration(res.seconds), path);

        if (settings.store.replayUpload) {
            const channel = ChannelStore.getChannel(channelId ?? SelectedChannelStore.getChannelId());
            if (channel) UploadHandler.promptToUpload([new File([bytes], filename, { type: res.blob.type })], channel, 0);
        }
    } catch {
        fail("Failed to save clip.");
    } finally {
        busy = false;
    }
}

async function record(kind: "record" | "auto") {
    if (await startRecording(kind, readCommon(), readProfile(kind))) say("Recording started", getMicLabel());
}

async function toggleRecord() {
    if (isCurrentlyRecording()) {
        await stopRecording();
        return;
    }

    if (!lastChannelId) {
        fail("Join a voice call first.");
        return;
    }

    if (isBlacklistedUserInChannel(lastChannelId)) {
        fail("Blacklisted user in channel.");
        return;
    }

    await record("record");
}

function handleSaved(result: SaveResult) {
    if (result.status === "saved") say("Recording saved", "", result.path);
    else if (result.status === "error") fail("Failed to save the recording.");
}

function bind(id: ButtonId, key: string) {
    if (bound[id] === key) return;
    bound[id] = key;

    const native = getNative();
    if (!key) {
        Promise.resolve(native?.unregisterKeybind?.(id)).catch(() => { });
        return;
    }

    Promise.resolve(native?.registerKeybind?.(id, key))
        .then(ok => {
            if (ok === false) fail(`Hotkey ${key} is unavailable, pick another one.`);
        })
        .catch(() => { });
}

function syncHotkeys() {
    const s = settings.store;
    const on = !!s.hotkeys && !!lastChannelId;
    bind("clip", on && isRewinding() ? (s.clipKey || "").trim() : "");
    bind("record", on ? (s.recordKey || "").trim() : "");
}

function useCallState() {
    const [, setTick] = useState(0);
    useEffect(() => subscribeState(() => setTick(n => n + 1)), []);
    return { inCall: !!lastChannelId, rewinding: isRewinding(), recording: isCurrentlyRecording(), since: getRecordingStart() };
}

function ClipIcon() {
    const { rewinding } = useCallState();

    return (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M12 5a7 7 0 1 1-6.3 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            <path d="M5 4v5h5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            <circle cx="12" cy="12" r="2.2" fill="currentColor" />
            {rewinding && <circle cx="19" cy="5" r="3.2" fill="var(--status-positive)" />}
        </svg>
    );
}

function RecordIcon() {
    const { recording } = useCallState();
    const color = recording ? "var(--status-danger)" : "currentColor";

    return (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <circle cx="12" cy="12" r="8" stroke={color} strokeWidth="2" />
            {recording && <circle cx="12" cy="12" r="4.5" fill={color} />}
        </svg>
    );
}

function clipTip(seconds: number, video: boolean, key: string) {
    const len = seconds > 0 ? `the last ${fmtDuration(seconds)}` : "the whole call";
    return `Save ${len} as a ${video ? "video" : "voice"} clip${key ? ` (${key})` : ""}. Right-click: settings`;
}

function recordTip(recording: boolean, since: number, key: string) {
    const state = recording ? `Recording since ${clock(since)}. Click to stop and save` : "Start recording this call";
    return `${state}${key ? ` (${key})` : ""}. Right-click: settings`;
}

function ClipButtonAccount() {
    const { rewinding } = useCallState();
    const { replaySeconds, replayType, clipKey, hotkeys } = settings.use(["replaySeconds", "replayType", "clipKey", "hotkeys"]);

    if (!rewinding) return null;

    return (
        <UserAreaButton
            tooltipText={clipTip(replaySeconds, replayType === "video", hotkeys ? clipKey : "")}
            icon={<ClipIcon />}
            role="button"
            aria-label="Save shadowplay clip"
            onClick={() => { void clip(); }}
            onContextMenu={onSettingsMenu}
        />
    );
}

function RecordButtonAccount() {
    const { inCall, recording, since } = useCallState();
    const { recordKey, hotkeys } = settings.use(["recordKey", "hotkeys"]);

    if (!inCall) return null;

    return (
        <UserAreaButton
            tooltipText={recordTip(recording, since, hotkeys ? recordKey : "")}
            icon={<RecordIcon />}
            role="button"
            aria-label="Record call"
            onClick={() => { void toggleRecord(); }}
            onContextMenu={onSettingsMenu}
        />
    );
}

const ClipButtonAccountWrapped = ErrorBoundary.wrap(ClipButtonAccount, { noop: true });
const RecordButtonAccountWrapped = ErrorBoundary.wrap(RecordButtonAccount, { noop: true });

function HeaderButtons() {
    const { inCall, rewinding, recording, since } = useCallState();
    const { clipButton, recordButton, replaySeconds, replayType, clipKey, recordKey, hotkeys } = settings.use(["clipButton", "recordButton", "replaySeconds", "replayType", "clipKey", "recordKey", "hotkeys"]);

    return (
        <>
            {clipButton === "header" && rewinding && (
                <div onContextMenu={onSettingsMenu} style={{ display: "flex", alignItems: "center" }}>
                    <HeaderBarButton
                        icon={ClipIcon}
                        tooltip={clipTip(replaySeconds, replayType === "video", hotkeys ? clipKey : "")}
                        onClick={() => { void clip(); }}
                    />
                </div>
            )}
            {recordButton === "header" && inCall && (
                <div onContextMenu={onSettingsMenu} style={{ display: "flex", alignItems: "center" }}>
                    <HeaderBarButton
                        icon={RecordIcon}
                        tooltip={recordTip(recording, since, hotkeys ? recordKey : "")}
                        onClick={() => { void toggleRecord(); }}
                    />
                </div>
            )}
        </>
    );
}

const HeaderButtonsWrapped = ErrorBoundary.wrap(HeaderButtons, { noop: true });

function setAccountButton(id: ButtonId, want: boolean) {
    if (want === accountAdded[id]) return;
    accountAdded[id] = want;

    if (!want) {
        Vencord.Api.UserArea.removeUserAreaButton(BUTTON_IDS[id]);
        return;
    }

    Vencord.Api.UserArea.addUserAreaButton(BUTTON_IDS[id], () => id === "clip" ? <ClipButtonAccountWrapped /> : <RecordButtonAccountWrapped />);
}

function syncButtons() {
    setAccountButton("clip", settings.store.clipButton === "account");
    setAccountButton("record", settings.store.recordButton === "account");
}

async function beginCall(channelId: string) {
    if (isBlacklistedUserInChannel(channelId)) {
        fail("Blacklisted user in channel.");
        return;
    }

    const s = settings.store;

    if (s.replayEnabled) await startReplay(readCommon(), readProfile("replay"), s.replaySeconds);
    if (s.autoRecord && lastChannelId === channelId) await record("auto");
}

async function handleVoiceChannelSelect(e: any) {
    const next = "channelId" in e ? (e.channelId ?? null) : getConnectedVoiceChannelId();
    const previous = lastChannelId;
    if (previous === next) return;

    lastChannelId = next;
    emitState();

    if (previous) await stopAll();

    if (next && lastChannelId === next) await beginCall(next);
}

async function handleVoiceStateUpdates(e: any) {
    if (!lastChannelId) return;

    const updates = Array.isArray(e.voiceStates) ? e.voiceStates : (e.voiceState ? [e.voiceState] : []);
    const me = UserStore?.getCurrentUser?.()?.id;
    const list = getBlacklist();

    for (const update of updates) {
        if (update.userId === me) {
            if ((update.channelId ?? null) !== lastChannelId) {
                await handleVoiceChannelSelect({ channelId: update.channelId ?? null });
                return;
            }
            continue;
        }

        if (list.length > 0 && (isRewinding() || isCurrentlyRecording()) && update.channelId === lastChannelId && list.includes(update.userId)) {
            fail("Blacklisted user in channel.");
            await stopAll();
            return;
        }
    }
}

const CallCapturePlugin = definePlugin({
    name: "CallCapture",
    description: "Shadowplay-style instant replay clips plus manual and automatic call recording, with per-mode quality, buttons, hotkeys and commands.",
    authors: [{ name: "zfrancesck1", id: 456195985404592149n }],
    tags: ["Voice", "Media", "Utility"],
    enabledByDefault: false,
    settings,

    headerBarButton: {
        icon: ClipIcon,
        render: HeaderButtonsWrapped,
        priority: 8
    },

    toolboxActions: {
        "Open CallCapture": (): void => openSettings()
    },

    commands: [
        {
            name: "clip",
            description: "Save the last seconds of the voice call to a file",
            inputType: ApplicationCommandInputType.BUILT_IN,
            execute: (_, ctx) => { void clip(ctx.channel.id); }
        },
        {
            name: "record",
            description: "Start or stop recording the voice call",
            inputType: ApplicationCommandInputType.BUILT_IN,
            execute: () => { void toggleRecord(); }
        }
    ],

    hotkey(id: string) {
        if (id === "clip") void clip();
        else if (id === "record") void toggleRecord();
    },

    start() {
        bound.clip = "";
        bound.record = "";
        Promise.resolve(getNative()?.unregisterAllKeybinds?.()).catch(() => { });

        pushLevels();
        onSaved(handleSaved);
        unsubscribe = subscribeState(syncHotkeys);
        syncButtons();

        lastChannelId = getConnectedVoiceChannelId();
        if (lastChannelId) void beginCall(lastChannelId);

        FluxDispatcher.subscribe("VOICE_CHANNEL_SELECT", handleVoiceChannelSelect);
        FluxDispatcher.subscribe("VOICE_STATE_UPDATES", handleVoiceStateUpdates);
    },

    stop() {
        FluxDispatcher.unsubscribe("VOICE_CHANNEL_SELECT", handleVoiceChannelSelect);
        FluxDispatcher.unsubscribe("VOICE_STATE_UPDATES", handleVoiceStateUpdates);
        unsubscribe?.();
        unsubscribe = null;
        lastChannelId = null;

        void stopAll().finally(() => {
            if (!unsubscribe) onSaved(null);
        });

        bound.clip = "";
        bound.record = "";
        Promise.resolve(getNative()?.unregisterAllKeybinds?.()).catch(() => { });

        setAccountButton("clip", false);
        setAccountButton("record", false);
    }
});

export default CallCapturePlugin;
