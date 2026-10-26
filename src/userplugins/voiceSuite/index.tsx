/*
 * TrashCord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { DataStore } from "@api/index";
import { HeaderBarButton } from "@api/HeaderBar";
import { definePluginSettings, Settings } from "@api/Settings";
import { UserAreaButton } from "@api/UserArea";
import { closeModal, ModalContent, ModalFooter, ModalHeader, ModalProps, ModalRoot, ModalSize, openModal } from "@utils/modal";
import { useForceUpdater } from "@utils/react";
import definePlugin, { OptionType } from "@utils/types";
import type { VoiceState } from "@vencord/discord-types";
import { findByCodeLazy, findByPropsLazy, findStoreLazy } from "@webpack";
import { DICTS, LANGS } from "./i18n";
import { cancelRecording, dropAllNative, dropNative, hasNative, nativeAccels, recordAccelerator, toElectron, tryNative } from "./keybind";
import { ApplicationStreamingStore, ChannelStore, FluxDispatcher, GuildChannelStore, GuildMemberStore, GuildRoleStore, GuildStore, MediaEngineStore, PermissionsBits, React, RelationshipStore, SelectedChannelStore, showToast, UserStore, VoiceStateStore } from "@webpack/common";

const MediaEngineActions = findByPropsLazy("toggleSelfMute");
const NotificationSettingsStore = findByPropsLazy("getDisableAllSounds", "getState");
const GatewaySocket = findByPropsLazy("getSocket");
const ChannelActions = findByPropsLazy("selectVoiceChannel");
const streamStart = findByCodeLazy('dispatch({type:"STREAM_START"');
const PresenceStore = findByPropsLazy("getStatus", "getActivities");
const LocaleStore = findStoreLazy("LocaleStore");

const STORE_KEY = "VoiceSuite_v1";
const SRC_KEY = "VoiceSuite_source_v1";
const OLD_STORE = "PhantomVoice_v1";
const OLD_SRC = "PhantomVoice_source_v1";
const FAKE_KEY = "VoiceSuite_fakes_v1";
const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const ID_RE = /^\d{17,20}$/;
const KNOWN_FAKE: Record<string, boolean> = { FakeVoiceState: true, FakeMuteAndDeafen: false };

type Trigger = "self_join" | "self_leave" | "user_join" | "user_leave" | "stream_start" | "stream_stop" | "startup" | "manual";
type Tri = 0 | 1 | 2;
type TabId = "rules" | "keybinds" | "activity" | "settings" | "help";
type AutoState = "on" | "paused" | "off";
type BoolKey = "enabled" | "showHeaderButton" | "showUserAreaButton" | "showToasts" | "enableLogs" | "autoMute" | "resetFakesOnLeave" | "pauseWhenInvisible" | "showActivity" | "stopFirst" | "keepFakes" | "cameraHook" | "cameraFallback" | "autoReleaseCrash" | "panicShare" | "panicMute" | "panicDeafen" | "panicLeave" | "collaborate" | "keybindsEnabled";

interface Actions {
    fakeMute: Tri;
    fakeDeafen: Tri;
    fakeCamera: Tri;
    fakeStream: Tri;
    mute: Tri;
    deafen: Tri;
    camera: Tri;
    crash: Tri;
    safeCam: Tri;
    panic: boolean;
    stream: Tri;
    disconnect: boolean;
    joinGuildId: string;
    joinChannelId: string;
    toast: boolean;
}

interface Rule {
    id: string;
    name: string;
    enabled: boolean;
    trigger: Trigger;
    guildIds: string[];
    channelIds: string[];
    whoAnyone: boolean;
    whoOwner: boolean;
    whoFriends: boolean;
    perms: string[];
    roleIds: string[];
    userIds: string[];
    ignoreIds: string[];
    ignoreBots: boolean;
    scanOnJoin: boolean;
    requireCamOn: boolean;
    requireStreaming: boolean;
    minUsers: number;
    once: boolean;
    delay: number;
    cooldown: number;
    revertAfter: number;
    hoursOn: boolean;
    hourFrom: number;
    hourTo: number;
    days: number[];
    actions: Actions;
}

interface Compiled {
    rule: Rule;
    users: Set<string>;
    ignore: Set<string>;
    roles: Set<string>;
    perms: bigint[];
}

const K = {
    bg: "#0a0810", card: "#131020", card2: "#1a1628", card3: "#0d0a14", input: "#07050c",
    line: "#2e2247", soft: "#1f1830", accent: "#8b7bc4", deep: "#5e3fa8", text: "#ddd6e8",
    sub: "#a89bbf", mute: "#706884", green: "#4e8c62", red: "#b15858", amber: "#b8903e",
    blue: "#5678a8", pink: "#a863a0", cyan: "#4a8f96", orange: "#b87848",
};

const TRIGGERS: { id: Trigger; label: string; desc: string; color: string; }[] = [
    { id: "self_join", label: "I join", desc: "Runs the moment you join a matching voice channel.", color: K.green },
    { id: "self_leave", label: "I leave", desc: "Runs when you leave a matching channel. Only fake-state actions apply.", color: K.red },
    { id: "user_join", label: "Someone joins", desc: "Runs when a matching person joins the channel you are in.", color: K.amber },
    { id: "user_leave", label: "Someone leaves", desc: "Runs when a matching person leaves the channel you are in.", color: K.blue },
    { id: "stream_start", label: "My share starts", desc: "Runs when your screenshare (real or fake) starts in a matching channel.", color: K.cyan },
    { id: "stream_stop", label: "My share stops", desc: "Runs when your screenshare ends in a matching channel.", color: K.orange },
    { id: "startup", label: "Plugin starts", desc: "Runs once when the plugin starts.", color: K.pink },
    { id: "manual", label: "Manual", desc: "Runs only when you press a Run button.", color: K.sub },
];

const PERMS: [string, string][] = [
    ["ADMINISTRATOR", "Administrator"], ["MANAGE_GUILD", "Manage Server"], ["MANAGE_CHANNELS", "Manage Channels"],
    ["MANAGE_ROLES", "Manage Roles"], ["KICK_MEMBERS", "Kick"], ["BAN_MEMBERS", "Ban"],
    ["MANAGE_MESSAGES", "Manage Messages"], ["MANAGE_THREADS", "Manage Threads"], ["MANAGE_EVENTS", "Manage Events"],
    ["MODERATE_MEMBERS", "Timeout"], ["MUTE_MEMBERS", "Mute Members"], ["DEAFEN_MEMBERS", "Deafen Members"],
    ["MOVE_MEMBERS", "Move Members"],
];

const STAFF_PERMS = PERMS.map(p => p[0]);
const BACKUP_KEYS: BoolKey[] = ["enabled", "showHeaderButton", "showUserAreaButton", "showToasts", "enableLogs", "autoMute", "resetFakesOnLeave", "pauseWhenInvisible", "showActivity", "stopFirst", "keepFakes", "cameraHook", "cameraFallback", "autoReleaseCrash", "panicShare", "panicMute", "panicDeafen", "panicLeave", "collaborate", "keybindsEnabled"];
const BACKUP_STR = ["safeCamera", "panicCamera", "language"] as const;

const settings = definePluginSettings({
    enabled: { type: OptionType.BOOLEAN, description: "Master switch for all automation rules.", default: true },
    showHeaderButton: { type: OptionType.BOOLEAN, description: "Show the Voice Suite button in the header bar.", default: true },
    showUserAreaButton: { type: OptionType.BOOLEAN, description: "Show the Voice Suite button in the user area (bottom-left).", default: false },
    showToasts: { type: OptionType.BOOLEAN, description: "Show toast notifications for actions.", default: false },
    enableLogs: { type: OptionType.BOOLEAN, description: "Print rule activity to the console.", default: false },
    autoMute: { type: OptionType.BOOLEAN, description: "Automatically mute when fake deafened.", default: false },
    resetFakesOnLeave: { type: OptionType.BOOLEAN, description: "Clear all fake states when you leave voice.", default: false },
    pauseWhenInvisible: { type: OptionType.BOOLEAN, description: "Pause all rules while your status is Invisible.", default: false },
    showActivity: { type: OptionType.BOOLEAN, description: "Show the Activity tab and record recent rule runs.", default: false },
    cameraHook: { type: OptionType.BOOLEAN, description: "Hook camera streams so Hide camera works (applies the next time the camera starts).", default: false, onChange: (v: boolean) => { if (pluginActive) { if (v) installCapture(); else uninstallCapture(); } } },
    cameraFallback: { type: OptionType.BOOLEAN, description: "When the camera cannot be hooked, switch to the safe camera instead.", default: true },
    autoReleaseCrash: { type: OptionType.BOOLEAN, description: "Show the camera again when the camera is toggled or you change voice channel.", default: true },
    safeCamera: { type: OptionType.STRING, description: "Name (or part of it) of the safe camera.", default: "" },
    panicCamera: { type: OptionType.STRING, description: "Panic profile camera action: none, off or hide.", default: "off" },
    panicShare: { type: OptionType.BOOLEAN, description: "Panic profile: stop the screenshare.", default: true },
    panicMute: { type: OptionType.BOOLEAN, description: "Panic profile: mute the microphone.", default: true },
    panicDeafen: { type: OptionType.BOOLEAN, description: "Panic profile: deafen the headset.", default: false },
    panicLeave: { type: OptionType.BOOLEAN, description: "Panic profile: leave the voice channel.", default: false },
    stopFirst: { type: OptionType.BOOLEAN, description: "When a rule has both, run Stop/Off actions before On/Start actions.", default: true },
    keepFakes: { type: OptionType.BOOLEAN, description: "Remember fake mute, deafen and camera between restarts.", default: false },
    language: { type: OptionType.STRING, description: "Interface language: system (follows Discord), en, it, es, fr, de or pt.", default: "system" },
    collaborate: { type: OptionType.BOOLEAN, description: "Work together with FakeVoiceState and FakeMuteAndDeafen: apply and mirror their fake states.", default: true, onChange: (v: boolean) => { if (!pluginActive) return; conflictCache = null; if (v) wrapExternals(); else unwrapExternals(); emit(); } },
    keybindsEnabled: { type: OptionType.BOOLEAN, description: "Master switch for the global keybinds.", default: false, onChange: () => { if (pluginActive) scheduleKbSync(); } },
    pauseMinutes: { type: OptionType.NUMBER, description: "Default pause length in minutes.", default: 15 },
    openPanel: {
        type: OptionType.COMPONENT,
        description: "",
        component: () => (
            <div role="button" onClick={() => openSuite()}
                style={{ display: "inline-block", padding: "8px 16px", borderRadius: 8, background: K.deep, color: "#fff", fontWeight: 700, cursor: "pointer", userSelect: "none" }}>
                Open Voice Suite
            </div>
        )
    }
});

let pluginActive = false;
let rules: Rule[] = [];
let compiled: Compiled[] = [];
const lastRun = new Map<string, number>();
const ran = new Set<string>();
const stats = new Map<string, { n: number; t: number; }>();
const activity: { t: number; text: string; }[] = [];
const timers = new Set<ReturnType<typeof setTimeout>>();
const listeners = new Set<() => void>();
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let trackedChannel: string | null = null;
let joinPending = false;
let isFakeStreamActive = false;
let srcChoice: { id: string; name: string; } | null = null;
let sourceList: { id: string; name: string; type: string; }[] = [];
let modalKey: string | null = null;
let pausedUntil = 0;
let pauseTimer: ReturnType<typeof setTimeout> | null = null;
let patchSeen = false;
let hookWarn = false;
let emitQueued = false;
let guildCache: { t: number; list: [string, string][]; } | null = null;

const fake = {
    _selfMute: false,
    get selfMute() {
        try {
            if (!settings.store.autoMute) return this._selfMute;
            return this.selfDeaf || this._selfMute;
        } catch {
            return this._selfMute;
        }
    },
    set selfMute(value: boolean) {
        this._selfMute = value;
    },
    selfDeaf: false,
    selfVideo: false
};

const StateKeys = ["selfDeaf", "selfMute", "selfVideo"] as const;

const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-3);
const opt = (v: string, l: string): [string, string] => [v, l];
const gName = (id: string) => GuildStore.getGuild(id)?.name ?? `ID ${id}`;
const chName = (id: string) => ChannelStore.getChannel(id)?.name ?? `ID ${id}`;
const permName = (id: string) => PERMS.find(p => p[0] === id)?.[1] ?? id;
const dictCache: Record<string, Record<string, string>> = {};

let sysLang = "en";

function resolveSystemLang() {
    let loc = "";
    try { loc = String((LocaleStore as any)?.locale ?? navigator.language ?? ""); } catch { loc = navigator.language ?? ""; }
    const two = loc.toLowerCase().slice(0, 2);
    sysLang = DICTS[two] ? two : "en";
}

function activeLang() {
    const l = settings.store.language;
    return !l || l === "system" ? sysLang : l;
}

function tx(s: string, vars?: Record<string, string | number>): string {
    let out = s;
    const lang = activeLang();
    if (lang !== "en") {
        const d = dictCache[lang] ?? (dictCache[lang] = DICTS[lang]?.() ?? {});
        out = d[s] ?? s;
    }
    if (vars) for (const k in vars) out = out.split(`{${k}}`).join(String(vars[k]));
    return out;
}

function log(...args: unknown[]) {
    if (settings.store.enableLogs) console.log("[VoiceSuite]", ...args);
}

function notify(msg: string, type: "default" | "success" | "critical" = "message") {
    if (settings.store.showToasts) showToast({ text: msg, variant: type });
}

function toastNow(msg: string) {
    showToast({ text: msg, variant: "success" });
}

function fail(msg: string) {
    showToast({ text: msg, variant: "critical" });
}

function subscribe(fn: () => void) {
    listeners.add(fn);
    return () => { listeners.delete(fn); };
}

function emitNow() {
    emitQueued = false;
    for (const fn of listeners) fn();
}

function emit() {
    if (emitQueued) return;
    emitQueued = true;
    queueMicrotask(emitNow);
}

function delayed(fn: () => void, ms: number) {
    const t = setTimeout(() => { timers.delete(t); if (pluginActive) fn(); }, ms);
    timers.add(t);
}

function selfInvisible() {
    if (!settings.store.pauseWhenInvisible) return false;
    try {
        const me = UserStore.getCurrentUser()?.id;
        return !!me && PresenceStore.getStatus(me) === "invisible";
    } catch {
        return false;
    }
}

function autoState(): AutoState {
    if (!settings.store.enabled) return "off";
    if (Date.now() < pausedUntil || selfInvisible()) return "paused";
    return "on";
}

const isActive = () => autoState() === "on";

function resumeNow(silent = false) {
    pausedUntil = 0;
    if (pauseTimer) { clearTimeout(pauseTimer); timers.delete(pauseTimer); pauseTimer = null; }
    emit();
    if (!silent) notify(tx("Automation resumed"), "success");
}

function pauseFor(min: number) {
    const m = Math.min(10080, Math.max(1, Math.floor(min) || 1));
    resumeNow(true);
    pausedUntil = Date.now() + m * 60000;
    const t = setTimeout(() => {
        timers.delete(t);
        pauseTimer = null;
        pausedUntil = 0;
        emit();
        notify(tx("Automation resumed"), "success");
    }, m * 60000);
    pauseTimer = t;
    timers.add(t);
    emit();
    notify(tx("Automation paused for {m} min", { m }));
}

function setEnabled(v: boolean) {
    settings.store.enabled = v;
    if (v) resumeNow(true);
    emit();
    notify(tx(v ? "Automation resumed" : "Automation paused"), v ? "success" : "message");
}

const emptyActions = (): Actions => ({
    fakeMute: 0, fakeDeafen: 0, fakeCamera: 0, fakeStream: 0,
    mute: 0, deafen: 0, camera: 0, crash: 0, safeCam: 0, panic: false, stream: 0,
    disconnect: false, joinGuildId: "", joinChannelId: "", toast: false
});

const newRule = (): Rule => ({
    id: uid(), name: tx("New rule"), enabled: true, trigger: "user_join",
    guildIds: [], channelIds: [], whoAnyone: false, whoOwner: true, whoFriends: false,
    perms: ["ADMINISTRATOR"], roleIds: [], userIds: [], ignoreIds: [], ignoreBots: true, scanOnJoin: true,
    requireCamOn: false, requireStreaming: false, minUsers: 0, once: false,
    delay: 0, cooldown: 2, revertAfter: 0, hoursOn: false, hourFrom: 22, hourTo: 6, days: [],
    actions: { ...emptyActions(), camera: 2 }
});

const toIds = (v: unknown): string[] => {
    if (Array.isArray(v)) return v.filter((x): x is string => typeof x === "string" && ID_RE.test(x));
    if (typeof v === "string") return v.split(/[\s,;]+/).filter(x => ID_RE.test(x));
    return [];
};

function migrateActions(x: any): Actions {
    const act: any = { ...emptyActions(), ...(x ?? {}) };
    if (x?.cameraOff) act.camera = 2;
    delete act.cameraOff;
    return act;
}

const clampInt = (v: unknown, min: number, max: number, def: number) => Math.min(max, Math.max(min, Math.floor(Number(v ?? def) || 0)));

function normalize(r: any): Rule {
    const base = newRule();
    const out: Rule = {
        ...base, ...r,
        perms: Array.isArray(r.perms) ? r.perms.filter((p: unknown) => typeof p === "string") : base.perms,
        guildIds: toIds(r.guildIds ?? r.guildId), channelIds: toIds(r.channelIds ?? r.channelId),
        roleIds: toIds(r.roleIds), userIds: toIds(r.userIds), ignoreIds: toIds(r.ignoreIds),
        delay: clampInt(r.delay, 0, 86400, 0), cooldown: clampInt(r.cooldown, 0, 86400, 2),
        revertAfter: clampInt(r.revertAfter, 0, 86400, 0), minUsers: clampInt(r.minUsers, 0, 999, 0),
        hourFrom: clampInt(r.hourFrom, 0, 23, 22), hourTo: clampInt(r.hourTo, 0, 23, 6),
        days: Array.isArray(r.days) ? [...new Set((r.days as unknown[]).map(Number).filter(d => Number.isInteger(d) && d >= 0 && d <= 6))] : [],
        actions: migrateActions(r.actions)
    };
    delete (out as any).guildId;
    delete (out as any).channelId;
    return out;
}

const PRESETS: { name: string; desc: string; make: () => Rule; }[] = [
    { name: "Hide camera from staff", desc: "Camera off when owner, admin or mod joins.", make: () => ({ ...newRule(), name: tx("Hide camera from staff"), perms: STAFF_PERMS }) },
    { name: "Panic leave", desc: "Disconnect when staff joins.", make: () => ({ ...newRule(), name: tx("Panic leave"), perms: STAFF_PERMS, actions: { ...emptyActions(), disconnect: true } }) },
    { name: "Stop share near staff", desc: "Stop your screenshare when staff joins.", make: () => ({ ...newRule(), name: tx("Stop share near staff"), perms: STAFF_PERMS, actions: { ...emptyActions(), stream: 2 } }) },
    { name: "Ghost join", desc: "Fake mute and deafen on every join.", make: () => ({ ...newRule(), name: tx("Ghost join"), trigger: "self_join", actions: { ...emptyActions(), fakeMute: 1, fakeDeafen: 1 } }) },
    { name: "Camera off on join", desc: "Turns your camera off whenever you join.", make: () => ({ ...newRule(), name: tx("Camera off on join"), trigger: "self_join", actions: { ...emptyActions(), camera: 2 } }) },
    { name: "Auto share on join", desc: "Starts your screenshare after joining.", make: () => ({ ...newRule(), name: tx("Auto share on join"), trigger: "self_join", delay: 3, actions: { ...emptyActions(), stream: 1 } }) },
    { name: "Stealth join", desc: "Manual: fake mute + deafen, then join a channel you pick.", make: () => ({ ...newRule(), name: tx("Stealth join"), trigger: "manual", actions: { ...emptyActions(), fakeMute: 1, fakeDeafen: 1 } }) },
    { name: "Reset on leave", desc: "Clears every fake state when you leave voice.", make: () => ({ ...newRule(), name: tx("Reset on leave"), trigger: "self_leave", actions: { ...emptyActions(), fakeMute: 2, fakeDeafen: 2, fakeCamera: 2 } }) },
];

function compileRule(rule: Rule): Compiled {
    const bits = PermissionsBits as unknown as Record<string, bigint>;
    return {
        rule,
        users: new Set(rule.userIds),
        ignore: new Set(rule.ignoreIds),
        roles: new Set(rule.roleIds),
        perms: rule.perms.map(p => bits[p]).filter(b => typeof b === "bigint")
    };
}

function rebuild() {
    compiled = rules.filter(r => r.enabled).map(compileRule);
}

function flush() {
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
    void DataStore.set(STORE_KEY, rules);
}

function commit() {
    rebuild();
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(flush, 400);
    emit();
}

function hasActiveStream() {
    return ApplicationStreamingStore?.getCurrentUserActiveStream?.() != null;
}

function isFakeStreamOn() {
    return isFakeStreamActive && hasActiveStream();
}

function sendFakeStreamState() {
    try {
        const channelId = SelectedChannelStore?.getVoiceChannelId?.();
        if (!channelId) return;
        const socket = GatewaySocket?.getSocket?.();
        if (!socket) return;
        const guildId = ChannelStore?.getChannel?.(channelId)?.guild_id ?? null;
        if (isFakeStreamActive) {
            socket.send(18, {
                type: guildId ? "guild" : "call",
                guild_id: guildId,
                channel_id: channelId,
                preferred_region: null
            });
        } else {
            const currentUserId = UserStore?.getCurrentUser()?.id;
            if (!currentUserId) return;
            const streamKey = guildId
                ? `guild:${guildId}:${channelId}:${currentUserId}`
                : `call:${channelId}:${currentUserId}`;
            socket.send(19, { stream_key: streamKey });
        }
    } catch { }
}

function setFakeStream(on: boolean) {
    if (on && hasActiveStream() && !isFakeStreamActive) return;
    isFakeStreamActive = on;
    sendFakeStreamState();
    emit();
    notify(tx(on ? "Fake stream on" : "Fake stream off"), on ? "success" : "message");
}

function onGoLiveSource(e?: { settings?: { desktopSettings?: { sourceId?: string; }; }; }) {
    if (e?.settings?.desktopSettings?.sourceId) isFakeStreamActive = false;
}

function streamKeyFor(guildId: string | null | undefined, channelId: string, owner: string) {
    return guildId ? `guild:${guildId}:${channelId}:${owner}` : `call:${channelId}:${owner}`;
}

function currentStreamKey(): string | null {
    const me = UserStore.getCurrentUser()?.id;
    const st: any = ApplicationStreamingStore?.getCurrentUserActiveStream?.();
    if (st) return streamKeyFor(st.guildId, st.channelId, st.ownerId ?? me ?? "");
    const ch = SelectedChannelStore.getVoiceChannelId();
    if (!ch || !me) return null;
    return streamKeyFor(ChannelStore.getChannel(ch)?.guild_id, ch, me);
}

function stopRealOnly(): boolean {
    if (isFakeStreamActive || !hasActiveStream()) return false;
    const key = currentStreamKey();
    if (!key) return false;
    try {
        FluxDispatcher.dispatch({ type: "STREAM_STOP", streamKey: key } as any);
        FluxDispatcher.dispatch({ type: "STREAM_DELETE", streamKey: key } as any);
    } catch { }
    delayed(() => {
        if (hasActiveStream() && !isFakeStreamActive) {
            try { GatewaySocket?.getSocket?.()?.send(19, { stream_key: key }); } catch { }
        }
        emit();
    }, 700);
    emit();
    notify(tx("Screenshare stopped"));
    return true;
}

function stopAnyStream() {
    if (isFakeStreamActive) setFakeStream(false);
    else stopRealOnly();
}

async function loadSources() {
    const dn = (window as any).DiscordNative?.desktopCapture;
    if (!dn?.getDesktopCaptureSources) return;
    try {
        const res: any[] = await dn.getDesktopCaptureSources({ types: ["screen", "window"], thumbnailSize: { width: 1, height: 1 } });
        sourceList = (res ?? []).map(x => ({ id: String(x.id), name: String(x.name), type: String(x.id).startsWith("screen") ? "screen" : "window" }));
        emit();
    } catch { }
}

function pickSource(id: string) {
    const found = sourceList.find(x => x.id === id);
    srcChoice = id && found ? { id: found.id, name: found.name } : id ? srcChoice : null;
    if (srcChoice) void DataStore.set(SRC_KEY, srcChoice);
    else void DataStore.del(SRC_KEY);
    emit();
}

async function resolveSource() {
    if (srcChoice) return srcChoice;
    const dn = (window as any).DiscordNative?.desktopCapture;
    if (!dn?.getDesktopCaptureSources) return null;
    const res: any[] = await dn.getDesktopCaptureSources({ types: ["screen"], thumbnailSize: { width: 1, height: 1 } });
    const first = res?.[0];
    return first ? { id: String(first.id), name: String(first.name) } : null;
}

async function startRealStream() {
    const channelId = SelectedChannelStore.getVoiceChannelId();
    if (!channelId) { fail(tx("Join a voice channel first")); return; }
    if (hasActiveStream()) return;
    try {
        const src = await resolveSource();
        if (!src) { fail(tx("No screen source found")); return; }
        isFakeStreamActive = false;
        streamStart(ChannelStore.getChannel(channelId)?.guild_id ?? null, channelId, {
            pid: null, sourceId: src.id, sourceName: src.name, audioSourceId: null,
            sound: true, previewDisabled: true
        });
        delayed(() => { if (!hasActiveStream()) fail(tx("Screenshare did not start")); emit(); }, 3500);
        emit();
    } catch {
        fail(tx("Could not start the screenshare"));
    }
}

const hooked = new Map<any, { own: boolean; orig: any; }>();

function applyFakeToPayload(d: any) {
    if (!d || typeof d !== "object") return;
    patchSeen = true;
    hookWarn = false;
    if (fake.selfMute) d.self_mute = true;
    if (fake.selfDeaf) d.self_deaf = true;
    if (fake.selfVideo) d.self_video = true;
    if (extWrapped.size) {
        const cur = syncExternal();
        if (cur.mute && !extMask.mute) d.self_mute = true;
        if (cur.deaf && !extMask.deaf) d.self_deaf = true;
        if (cur.video && !extMask.video) d.self_video = true;
    }
}

function ensureHook() {
    wrapExternals();
    try {
        const sock = GatewaySocket?.getSocket?.();
        if (!sock || hooked.has(sock) || typeof sock.send !== "function") return;
        const own = Object.prototype.hasOwnProperty.call(sock, "send");
        const orig = sock.send;
        sock.send = function (this: any, op: number, d: any, ...rest: any[]) {
            if (op === 4) applyFakeToPayload(d);
            return orig.call(this, op, d, ...rest);
        };
        hooked.set(sock, { own, orig });
        if (hooked.size > 3) hooked.delete(hooked.keys().next().value);
    } catch { }
}

function unhook() {
    for (const [sock, h] of hooked) {
        try { if (h.own) sock.send = h.orig; else delete sock.send; } catch { }
    }
    hooked.clear();
}

let fakeSaveTimer: ReturnType<typeof setTimeout> | null = null;

function persistFakes() {
    if (!settings.store.keepFakes) return;
    if (fakeSaveTimer) clearTimeout(fakeSaveTimer);
    fakeSaveTimer = setTimeout(() => {
        fakeSaveTimer = null;
        void DataStore.set(FAKE_KEY, { m: fake._selfMute, d: fake.selfDeaf, v: fake.selfVideo });
    }, 600);
}

function pushState() {
    persistFakes();
    if (Date.now() - extDriveAt < 50) return;
    if (!SelectedChannelStore.getVoiceChannelId()) return;
    ensureHook();
    let deaf = false;
    try { deaf = !!(MediaEngineStore as any).isSelfDeaf?.(); } catch { }
    let state: any = null;
    try { state = NotificationSettingsStore.getState(); } catch { }
    const sounds: string[] | undefined = state?.disabledSounds;
    const names = deaf ? ["deafen", "undeafen"] : ["mute", "unmute"];
    const toDisable = sounds ? names.filter(n => !sounds.includes(n)) : [];
    if (sounds) sounds.push(...toDisable);
    try {
        if (deaf) {
            MediaEngineActions.toggleSelfDeaf();
            MediaEngineActions.toggleSelfDeaf();
        } else {
            MediaEngineActions.toggleSelfMute();
            MediaEngineActions.toggleSelfMute();
        }
    } catch { }
    if (sounds) state.disabledSounds = sounds.filter((i: string) => !toDisable.includes(i));
    if (!patchSeen) {
        delayed(() => {
            if (!patchSeen && SelectedChannelStore.getVoiceChannelId()) { hookWarn = true; emit(); }
        }, 1500);
    }
}

type FakeKey = "selfMute" | "selfDeaf" | "selfVideo";
const FAKE_FLAG: Record<FakeKey, "mute" | "deaf" | "video"> = { selfMute: "mute", selfDeaf: "deaf", selfVideo: "video" };
const extWrapped = new Map<string, { plugin: any; orig: any; }>();
const extMask = { mute: false, deaf: false, video: false };
let extLast = { mute: false, deaf: false, video: false };

function readExternal() {
    const r = { mute: false, deaf: false, video: false };
    for (const { plugin, orig } of extWrapped.values()) {
        try {
            const pr: any = { selfMute: false, selfDeaf: false, selfVideo: false };
            orig.call(plugin, pr);
            if (pr.selfMute) r.mute = true;
            if (pr.selfDeaf) r.deaf = true;
            if (pr.selfVideo) r.video = true;
        } catch { }
    }
    return r;
}

function syncExternal() {
    const cur = readExternal();
    let changed = false;
    if (cur.mute !== extLast.mute) { extMask.mute = false; fake.selfMute = cur.mute; changed = true; }
    if (cur.deaf !== extLast.deaf) { extMask.deaf = false; fake.selfDeaf = cur.deaf; changed = true; }
    if (cur.video !== extLast.video) { extMask.video = false; fake.selfVideo = cur.video; changed = true; }
    extLast = cur;
    if (changed) emit();
    return cur;
}

function wrapExternals() {
    if (!settings.store.collaborate) return;
    let P: any;
    try { P = (Vencord as any).Plugins; } catch { return; }
    for (const name of conflictingPlugins()) {
        try {
            const plugin = P.plugins[name];
            if (!plugin || extWrapped.has(name) || typeof plugin.modifyVoiceState !== "function") continue;
            const orig = plugin.modifyVoiceState;
            plugin.modifyVoiceState = function (this: any, e: any) {
                const before = { selfMute: e?.selfMute, selfDeaf: e?.selfDeaf, selfVideo: e?.selfVideo };
                const out = orig.call(this, e);
                syncExternal();
                const o = out ?? e;
                if (o) {
                    if (extMask.mute) o.selfMute = before.selfMute;
                    if (extMask.deaf) o.selfDeaf = before.selfDeaf;
                    if (extMask.video) o.selfVideo = before.selfVideo;
                }
                return out;
            };
            extWrapped.set(name, { plugin, orig });
            extLast = readExternal();
        } catch { }
    }
}

function unwrapExternals() {
    for (const { plugin, orig } of extWrapped.values()) {
        try { plugin.modifyVoiceState = orig; } catch { }
    }
    extWrapped.clear();
    extMask.mute = extMask.deaf = extMask.video = false;
    extLast = { mute: false, deaf: false, video: false };
}

function effectiveFake() {
    const ext = readExternal();
    return {
        selfMute: fake.selfMute || (ext.mute && !extMask.mute),
        selfDeaf: fake.selfDeaf || (ext.deaf && !extMask.deaf),
        selfVideo: fake.selfVideo || (ext.video && !extMask.video)
    };
}

const EXT_IDS = { mute: "fake-mute", deaf: "fake-deafen", video: "fake-video" } as const;
let extDriveAt = 0;

function extItems(plugin: any) {
    const out: Record<string, any> = {};
    try {
        for (const nav of ["audio-device-context", "video-device-context"]) {
            const fn = plugin.contextMenus?.[nav];
            if (typeof fn !== "function") continue;
            const children: any[] = [];
            fn(children, { renderInputDevices: true, renderOutputDevices: true });
            for (const c of children) if (c?.props?.id) out[c.props.id] = c.props;
        }
    } catch { }
    return out;
}

function driveExternal(flag: "mute" | "deaf" | "video", on: boolean) {
    let did = false;
    for (const { plugin } of extWrapped.values()) {
        try {
            const it = extItems(plugin)[EXT_IDS[flag]];
            if (it && typeof it.action === "function" && !!it.checked !== on) {
                it.action();
                did = true;
            }
        } catch { }
    }
    if (did) {
        extDriveAt = Date.now();
        extLast = readExternal();
    }
    return did;
}

function applyFake(key: FakeKey, on: boolean) {
    const flag = FAKE_FLAG[key];
    fake[key] = on;
    extMask[flag] = false;
    driveExternal(flag, on);
    if (!on && readExternal()[flag]) extMask[flag] = true;
}

function setFake(key: FakeKey, value: boolean) {
    applyFake(key, value);
    emit();
    pushState();
    const msg = key === "selfMute" ? (value ? "Fake mute on" : "Fake mute off") : key === "selfDeaf" ? (value ? "Fake deafen on" : "Fake deafen off") : (value ? "Fake camera on" : "Fake camera off");
    notify(tx(msg), value ? "success" : "message");
}

function setFakeCombo(m: boolean, d: boolean, v: boolean) {
    applyFake("selfMute", m);
    applyFake("selfDeaf", d);
    applyFake("selfVideo", v);
    emit();
    pushState();
    notify(tx(m || d || v ? "Fake states applied" : "Fake states cleared"), "success");
}

function resetFakes() {
    applyFake("selfMute", false);
    applyFake("selfDeaf", false);
    applyFake("selfVideo", false);
    if (isFakeStreamActive) { isFakeStreamActive = false; sendFakeStreamState(); }
    emit();
    pushState();
    notify(tx("All fake states reset"), "success");
}

function toggleRealMute() {
    try { MediaEngineActions.toggleSelfMute(); } catch { }
    emit();
    notify(tx("Mute toggled"));
}

function toggleRealDeaf() {
    try { MediaEngineActions.toggleSelfDeaf(); } catch { }
    emit();
    notify(tx("Deafen toggled"));
}

declare const MediaStreamTrackProcessor: any;
declare const MediaStreamTrackGenerator: any;

const VideoDeviceActions = findByPropsLazy("setVideoDevice");

let crashed = false;
let previousDevice: string | null = null;
let fallbackUsed = false;
let lastSwitchAt = 0;
let camGuardUntil = 0;
let originalGetUserMedia: any = null;
let capRestorers: (() => void)[] = [];
const wrappedTracks = new WeakSet<object>();
const sentTracks = new Set<object>();

function setRealMute(on: boolean): boolean {
    try {
        if ((MediaEngineStore as any).isSelfMute() === on) return false;
        MediaEngineActions.toggleSelfMute();
        return true;
    } catch {
        return false;
    }
}

function setRealDeaf(on: boolean): boolean {
    try {
        if ((MediaEngineStore as any).isSelfDeaf() === on) return false;
        MediaEngineActions.toggleSelfDeaf();
        return true;
    } catch {
        return false;
    }
}

function realState() {
    try {
        const m: any = MediaEngineStore;
        return { mute: !!m.isSelfMute?.(), deaf: !!m.isSelfDeaf?.(), cam: !!m.isVideoEnabled?.() };
    } catch {
        return { mute: false, deaf: false, cam: false };
    }
}

const camDevices = (): any[] => {
    try { return Object.values<any>((MediaEngineStore as any).getVideoDevices?.() ?? {}); } catch { return []; }
};

function setCamera(on: boolean) {
    const inVoice = !!SelectedChannelStore.getVoiceChannelId();
    if (realState().cam === on || (on && !inVoice)) return;
    try {
        camGuardUntil = Date.now() + 1200;
        FluxDispatcher.dispatch({ type: "MEDIA_ENGINE_SET_VIDEO_ENABLED", enabled: on });
        emit();
        notify(tx(on ? "Camera turned on" : "Camera turned off"));
    } catch { }
}

function wrapStream(stream: MediaStream): MediaStream {
    const [track] = stream.getVideoTracks();
    if (!track || (track.getSettings() as any).displaySurface) return stream;
    const processor = new MediaStreamTrackProcessor({ track });
    const generator = new MediaStreamTrackGenerator({ kind: "video" });
    wrappedTracks.add(generator);

    let last: VideoFrame | null = null;

    processor.readable
        .pipeThrough(new TransformStream<VideoFrame, VideoFrame>({
            transform(frame, controller) {
                if (!crashed) {
                    last?.close();
                    last = frame.clone();
                    controller.enqueue(frame);
                    return;
                }
                const ts = frame.timestamp;
                if (!last) {
                    last = frame.clone();
                    controller.enqueue(frame);
                    return;
                }
                frame.close();
                controller.enqueue(new VideoFrame(last, { timestamp: ts }));
            },
            flush() {
                last?.close();
                last = null;
            }
        }))
        .pipeTo(generator.writable)
        .catch(() => { });

    const stop = generator.stop.bind(generator);
    generator.stop = () => {
        if (sentTracks.delete(generator)) emit();
        track.stop();
        stop();
    };
    const cloneTrack = generator.clone?.bind(generator);
    if (cloneTrack) {
        generator.clone = () => {
            const copy = cloneTrack();
            wrappedTracks.add(copy);
            return copy;
        };
    }
    return new MediaStream([generator, ...stream.getAudioTracks()]);
}

function hookProto(proto: any, key: string) {
    const original = proto?.[key];
    if (typeof original !== "function") return;
    proto[key] = function (this: any, ...args: any[]) {
        const t = args[0];
        if (t && typeof t === "object" && wrappedTracks.has(t) && !sentTracks.has(t)) {
            sentTracks.add(t);
            emit();
        }
        return original.apply(this, args);
    };
    capRestorers.push(() => { proto[key] = original; });
}

function installCapture() {
    if (originalGetUserMedia || typeof MediaStreamTrackProcessor === "undefined") return;
    const md = navigator.mediaDevices as any;
    originalGetUserMedia = md.getUserMedia;
    md.getUserMedia = async function (constraints?: MediaStreamConstraints) {
        const stream = await originalGetUserMedia.call(md, constraints);
        const video = constraints?.video;
        if (!settings.store.cameraHook || !video || (typeof video === "object" && (video as any).mandatory)) return stream;
        try { return wrapStream(stream); } catch { return stream; }
    };
    hookProto(window.RTCPeerConnection?.prototype, "addTrack");
    hookProto(window.RTCPeerConnection?.prototype, "addTransceiver");
    hookProto(window.RTCRtpSender?.prototype, "replaceTrack");
}

function uninstallCapture() {
    if (!originalGetUserMedia) return;
    delete (navigator.mediaDevices as any).getUserMedia;
    originalGetUserMedia = null;
    capRestorers.forEach(fn => fn());
    capRestorers = [];
    sentTracks.clear();
}

function pickSafeDevice(current: string | undefined) {
    const needle = (settings.store.safeCamera || "virtual").trim().toLowerCase();
    return camDevices().find(d => d.id !== current && (d.id === needle || d.name?.toLowerCase().includes(needle)));
}

function switchCamera(): boolean {
    const current = (MediaEngineStore as any).getVideoDeviceId?.();
    const target = pickSafeDevice(current);
    if (!target) { fail(tx("Safe camera not found. Pick one in Settings")); return false; }
    try {
        previousDevice = current ?? "";
        lastSwitchAt = Date.now();
        VideoDeviceActions.setVideoDevice(target.id);
    } catch {
        previousDevice = null;
        return false;
    }
    emit();
    notify(tx("Switched to the safe camera"));
    return true;
}

function restoreCamera() {
    const id = previousDevice;
    previousDevice = null;
    fallbackUsed = false;
    if (id) {
        lastSwitchAt = Date.now();
        try { VideoDeviceActions.setVideoDevice(id); } catch { }
        notify(tx("Camera restored"));
    }
    emit();
}

function toggleSafeCamera() {
    if (previousDevice !== null) restoreCamera();
    else switchCamera();
}

function crashCamera(on: boolean) {
    crashed = on;
    if (on) {
        if (SelectedChannelStore.getVoiceChannelId() && realState().cam) {
            if (sentTracks.size > 0) notify(tx("Camera hidden"), "success");
            else if (settings.store.cameraFallback && previousDevice === null && switchCamera()) fallbackUsed = true;
            else if (!settings.store.cameraHook) fail(tx("Turn on Camera hooking in Settings to hide the camera"));
        }
    } else if (fallbackUsed && previousDevice !== null) restoreCamera();
    emit();
}

function onVideoToggle() {
    if (!settings.store.autoReleaseCrash || !crashed) return;
    const now = Date.now();
    if (now < camGuardUntil || now - lastSwitchAt < 1500) return;
    crashCamera(false);
}

function disconnectVoice() {
    try { ChannelActions?.selectVoiceChannel?.(null); } catch { }
    notify(tx("Disconnected from voice"));
}

function panicSummary() {
    const st = settings.store;
    const p: string[] = [];
    if (st.panicCamera === "off") p.push(tx("camera off"));
    else if (st.panicCamera === "hide") p.push(tx("hide camera"));
    if (st.panicShare) p.push(tx("stop screenshare"));
    if (st.panicMute) p.push(tx("mute mic"));
    if (st.panicDeafen) p.push(tx("deafen"));
    if (st.panicLeave) p.push(tx("leave voice"));
    return p.length ? p.join(", ") : tx("nothing yet (set it in Settings)");
}

function panic() {
    const st = settings.store;
    if (st.panicCamera === "hide") crashCamera(true);
    else if (st.panicCamera === "off") setCamera(false);
    if (st.panicShare) stopAnyStream();
    if (st.panicMute) setRealMute(true);
    if (st.panicDeafen) setRealDeaf(true);
    if (st.panicLeave) disconnectVoice();
    emit();
    notify(tx("Panic profile executed"), "success");
}

function joinVoice(channelId: string) {
    try {
        if (SelectedChannelStore.getVoiceChannelId() === channelId) return;
        joinPending = true;
        ChannelActions?.selectVoiceChannel?.(channelId);
    } catch { }
}

function memberHasPerm(gid: string, userId: string, wanted: bigint[]) {
    const member = GuildMemberStore.getMember(gid, userId);
    if (!member) return false;
    const roles = GuildRoleStore.getRolesSnapshot(gid);
    let p: bigint = roles[gid]?.permissions ?? 0n;
    for (const id of member.roles) p |= roles[id]?.permissions ?? 0n;
    if (p & PermissionsBits.ADMINISTRATOR) return true;
    for (const b of wanted) if (p & b) return true;
    return false;
}

function matchWho(c: Compiled, gid: string, userId: string) {
    const r = c.rule;
    if (c.ignore.has(userId)) return false;
    if (r.ignoreBots && UserStore.getUser(userId)?.bot) return false;
    if (r.whoAnyone || c.users.has(userId)) return true;
    if (r.whoFriends && (RelationshipStore as any).isFriend?.(userId)) return true;
    if (!gid) return false;
    if (r.whoOwner && GuildStore.getGuild(gid)?.ownerId === userId) return true;
    if (c.roles.size) {
        const m = GuildMemberStore.getMember(gid, userId);
        if (m?.roles?.some((id: string) => c.roles.has(id))) return true;
    }
    return c.perms.length > 0 && memberHasPerm(gid, userId, c.perms);
}

function inScope(r: Rule, channelId: string) {
    if (!r.guildIds.length && !r.channelIds.length) return true;
    if (r.channelIds.includes(channelId)) return true;
    if (!r.guildIds.length) return false;
    const g = ChannelStore.getChannel(channelId)?.guild_id;
    return !!g && r.guildIds.includes(g);
}

function conditionsOk(r: Rule, channelId: string) {
    if (r.days.length && !r.days.includes(new Date().getDay())) return false;
    if (r.hoursOn) {
        const h = new Date().getHours();
        const ok = r.hourFrom <= r.hourTo ? h >= r.hourFrom && h < r.hourTo : h >= r.hourFrom || h < r.hourTo;
        if (!ok) return false;
    }
    if (r.requireCamOn && !(MediaEngineStore as any).isVideoEnabled?.()) return false;
    if (r.requireStreaming && !hasActiveStream()) return false;
    if (r.minUsers > 0 && channelId && Object.keys(VoiceStateStore.getVoiceStatesForChannel(channelId) ?? {}).length < r.minUsers) return false;
    return true;
}

function record(r: Rule, userId?: string) {
    if (!settings.store.showActivity) return;
    const s = stats.get(r.id) ?? { n: 0, t: 0 };
    s.n++;
    s.t = Date.now();
    stats.set(r.id, s);
    const who = userId ? UserStore.getUser(userId)?.username : undefined;
    activity.unshift({ t: s.t, text: who ? `${r.name} · ${who}` : r.name });
    if (activity.length > 30) activity.length = 30;
}

function runRule(r: Rule, userId?: string) {
    const a = r.actions;
    const snap = { m: fake._selfMute, d: fake.selfDeaf, v: fake.selfVideo, s: isFakeStreamActive };
    const wasFake = isFakeStreamActive;
    let dirty = false;
    let realToggled = false;
    let stopIssued = false;

    const offs = () => {
        if (a.panic) panic();
        if (a.fakeMute === 2) { applyFake("selfMute", false); dirty = true; }
        if (a.fakeDeafen === 2) { applyFake("selfDeaf", false); dirty = true; }
        if (a.fakeCamera === 2) { applyFake("selfVideo", false); dirty = true; }
        if (a.fakeStream === 2) setFakeStream(false);
        if (a.mute === 2 && setRealMute(false)) realToggled = true;
        if (a.deafen === 2 && setRealDeaf(false)) realToggled = true;
        if (a.camera === 2) setCamera(false);
        if (a.crash === 2) crashCamera(false);
        if (a.safeCam === 2 && previousDevice !== null) restoreCamera();
        if (a.stream === 2) stopIssued = stopRealOnly();
    };

    const ons = () => {
        if (a.fakeMute === 1) { applyFake("selfMute", true); dirty = true; }
        if (a.fakeDeafen === 1) { applyFake("selfDeaf", true); dirty = true; }
        if (a.fakeCamera === 1) { applyFake("selfVideo", true); dirty = true; }
        if (a.fakeStream === 1) {
            if (stopIssued) delayed(() => setFakeStream(true), 900);
            else setFakeStream(true);
        }
        if (a.deafen === 1 && setRealDeaf(true)) realToggled = true;
        if (a.mute === 1 && setRealMute(true)) realToggled = true;
        if (a.crash === 1) crashCamera(true);
        if (a.safeCam === 1 && previousDevice === null) switchCamera();
        if (a.camera === 1) setCamera(true);
        if (a.joinChannelId) joinVoice(a.joinChannelId);
        if (a.stream === 1) {
            if (joinPending) delayed(startRealStream, 2500);
            else if (wasFake && a.fakeStream === 2) delayed(startRealStream, 900);
            else void startRealStream();
        }
    };

    if (a.disconnect) disconnectVoice();
    else if (settings.store.stopFirst) { offs(); ons(); }
    else { ons(); offs(); }

    if (dirty) {
        if (realToggled) persistFakes();
        else pushState();
    }
    if (a.toast) {
        const who = userId ? UserStore.getUser(userId)?.username : null;
        toastNow(who ? `${r.name}: ${who}` : r.name);
    }
    if (r.revertAfter > 0 && (a.fakeMute || a.fakeDeafen || a.fakeCamera || a.fakeStream || a.stream === 1 || a.crash === 1 || a.safeCam === 1)) {
        delayed(() => {
            if (a.fakeMute) { fake._selfMute = snap.m; extMask.mute = false; }
            if (a.fakeDeafen) { fake.selfDeaf = snap.d; extMask.deaf = false; }
            if (a.fakeCamera) { fake.selfVideo = snap.v; extMask.video = false; }
            if (a.fakeStream) setFakeStream(snap.s);
            if (a.stream === 1) stopRealOnly();
            if (a.crash === 1) crashCamera(false);
            if (a.safeCam === 1 && previousDevice !== null) restoreCamera();
            pushState();
            emit();
            notify(tx("{name}: reverted", { name: r.name }));
        }, r.revertAfter * 1000);
    }
    record(r, userId);
    log("rule", r.name);
    emit();
}

function schedule(c: Compiled, channelId: string, userId: string) {
    const r = c.rule;
    if (r.once && ran.has(r.id)) return;
    const now = Date.now();
    if (now - (lastRun.get(r.id) ?? 0) < r.cooldown * 1000) return;
    if (!conditionsOk(r, channelId)) return;
    lastRun.set(r.id, now);
    if (r.once) ran.add(r.id);
    if (r.delay > 0) delayed(() => runRule(r, userId), r.delay * 1000);
    else runRule(r, userId);
}

function fireTrigger(kind: Trigger, channelId: string, userId: string) {
    const gid = ChannelStore.getChannel(channelId)?.guild_id ?? "";
    const isUser = kind === "user_join" || kind === "user_leave";
    for (const c of compiled) {
        if (c.rule.trigger !== kind || !inScope(c.rule, channelId)) continue;
        if (isUser && !matchWho(c, gid, userId)) continue;
        schedule(c, channelId, userId);
    }
}

function scanPresent(channelId: string, me: string) {
    const gid = ChannelStore.getChannel(channelId)?.guild_id ?? "";
    const present = Object.values(VoiceStateStore.getVoiceStatesForChannel(channelId) ?? {}) as { userId: string; }[];
    if (!present.length) return;
    for (const c of compiled) {
        if (c.rule.trigger !== "user_join" || !c.rule.scanOnJoin || !inScope(c.rule, channelId)) continue;
        for (const s of present) {
            if (s.userId === me || !matchWho(c, gid, s.userId)) continue;
            schedule(c, channelId, s.userId);
            break;
        }
    }
}

function onVoiceStates(voiceStates: VoiceState[]) {
    if (!pluginActive) return;
    const me = UserStore.getCurrentUser()?.id;
    if (!me) return;
    const active = compiled.length > 0 && isActive();
    const myChannel = SelectedChannelStore.getVoiceChannelId();
    for (const s of voiceStates) {
        const { userId, channelId, oldChannelId } = s;
        if (userId === me) {
            const next = channelId ?? null;
            if (next === trackedChannel) continue;
            const prev = trackedChannel;
            trackedChannel = next;
            if (prev) {
                if (!next && !joinPending) isFakeStreamActive = false;
                if (!next && settings.store.resetFakesOnLeave) {
                    applyFake("selfMute", false);
                    applyFake("selfDeaf", false);
                    applyFake("selfVideo", false);
                }
                if (active) fireTrigger("self_leave", prev, me);
            }
            if (next) {
                joinPending = false;
                ensureHook();
                if (isFakeStreamActive) delayed(() => { if (isFakeStreamActive) sendFakeStreamState(); }, 1500);
                if (active) {
                    fireTrigger("self_join", next, me);
                    scanPresent(next, me);
                }
            }
            emit();
            continue;
        }
        if (!active || !myChannel) continue;
        if (channelId === myChannel && oldChannelId !== myChannel) fireTrigger("user_join", myChannel, userId);
        else if (oldChannelId === myChannel && channelId !== myChannel) fireTrigger("user_leave", myChannel, userId);
    }
}

function onStream(kind: "stream_start" | "stream_stop", streamKey?: string) {
    if (!pluginActive || !streamKey || !compiled.length || !isActive()) return;
    const me = UserStore.getCurrentUser()?.id;
    if (!me || !streamKey.endsWith(`:${me}`)) return;
    const ch = SelectedChannelStore.getVoiceChannelId() ?? trackedChannel;
    if (ch) fireTrigger(kind, ch, me);
    emit();
}

function applyAction(a: Actions, key: keyof Actions, value: Actions[keyof Actions]) {
    (a as unknown as Record<string, unknown>)[key] = value;
    if (!value) return;
    if (key === "disconnect") {
        const t = a.toast;
        Object.assign(a, emptyActions(), { disconnect: true, toast: t });
    } else if (key === "joinChannelId") a.disconnect = false;
}

function enforceTrigger(r: Rule) {
    const a = r.actions;
    if (r.trigger === "stream_start" || r.trigger === "stream_stop") { a.stream = 0; a.fakeStream = 0; }
    if (r.trigger !== "self_leave") return;
    a.disconnect = false; a.joinChannelId = ""; a.joinGuildId = "";
    a.mute = 0; a.deafen = 0; a.camera = 0; a.crash = 0; a.safeCam = 0; a.panic = false; a.fakeStream = 0; a.stream = 0;
}

function actionList(r: Rule) {
    const a = r.actions;
    const p: string[] = [];
    if (a.disconnect) p.push(tx("disconnect from voice"));
    if (a.joinChannelId) p.push(tx("join #{name}", { name: chName(a.joinChannelId) }));
    if (a.fakeMute) p.push(tx(a.fakeMute === 1 ? "fake mute on" : "fake mute off"));
    if (a.fakeDeafen) p.push(tx(a.fakeDeafen === 1 ? "fake deafen on" : "fake deafen off"));
    if (a.fakeCamera) p.push(tx(a.fakeCamera === 1 ? "fake camera on" : "fake camera off"));
    if (a.fakeStream) p.push(tx(a.fakeStream === 1 ? "fake stream on" : "fake stream off"));
    if (a.mute) p.push(tx(a.mute === 1 ? "mute me" : "unmute me"));
    if (a.deafen) p.push(tx(a.deafen === 1 ? "deafen me" : "undeafen me"));
    if (a.camera) p.push(tx(a.camera === 1 ? "turn my camera on" : "turn my camera off"));
    if (a.crash) p.push(tx(a.crash === 1 ? "hide my camera" : "show my camera again"));
    if (a.safeCam) p.push(tx(a.safeCam === 1 ? "switch to my safe camera" : "restore my camera"));
    if (a.panic) p.push(tx("run my Panic profile"));
    if (a.stream) p.push(tx(a.stream === 1 ? "start my screenshare" : "stop my screenshare"));
    if (a.toast) p.push(tx("show a toast"));
    return p;
}

function placePhrase(r: Rule) {
    const p = [...r.channelIds.map(id => `#${chName(id)}`), ...r.guildIds.map(gName)];
    if (!p.length) return tx("any voice channel");
    return p.length <= 3 ? p.join(", ") : tx("{n} chosen places", { n: p.length });
}

function whoPhrase(r: Rule) {
    if (r.whoAnyone) return tx("anyone");
    const p: string[] = [];
    if (r.whoOwner) p.push(tx("the server owner"));
    if (r.whoFriends) p.push(tx("a friend"));
    if (r.perms.length) p.push(r.perms.length <= 2 ? tx("a member with {perms}", { perms: r.perms.map(permName).join(tx(" or ")) }) : tx("a member with one of {n} permissions", { n: r.perms.length }));
    if (r.roleIds.length) p.push(r.roleIds.length > 1 ? tx("a member with one of {n} chosen roles", { n: r.roleIds.length }) : tx("a member with the chosen role"));
    if (r.userIds.length) p.push(r.userIds.length <= 2 ? r.userIds.map(id => UserStore.getUser(id)?.username ?? id).join(tx(" or ")) : tx("one of {n} chosen users", { n: r.userIds.length }));
    return p.length ? p.join(tx(", or ")) : tx("nobody (no filter selected)");
}

function describe(r: Rule) {
    const scoped = r.channelIds.length || r.guildIds.length;
    const place = placePhrase(r);
    const where = scoped ? tx(" (only in {place})", { place }) : "";
    let when: string;
    if (r.trigger === "self_join") when = tx("When I join {place}", { place });
    else if (r.trigger === "self_leave") when = tx("When I leave {place}", { place });
    else if (r.trigger === "user_join") when = tx("When {who} joins my channel{where}", { who: whoPhrase(r), where });
    else if (r.trigger === "user_leave") when = tx("When {who} leaves my channel{where}", { who: whoPhrase(r), where });
    else if (r.trigger === "stream_start") when = tx("When my screenshare starts{where}", { where });
    else if (r.trigger === "stream_stop") when = tx("When my screenshare stops{where}", { where });
    else if (r.trigger === "startup") when = tx("When the plugin starts");
    else when = tx("When I press Run");
    const acts = actionList(r);
    const hrs = (r.hoursOn ? tx(" (only {a}:00-{b}:00)", { a: r.hourFrom, b: r.hourTo }) : "") + (r.days.length ? tx(r.days.length > 1 ? " ({n} chosen days)" : " ({n} chosen day)", { n: r.days.length }) : "");
    const after = r.delay > 0 ? tx(" wait {n}s, then", { n: r.delay }) : "";
    const body = acts.length ? acts.join(", ") : tx("do nothing yet");
    const undo = r.revertAfter > 0 ? tx(", and undo after {n}s", { n: r.revertAfter }) : "";
    return `${when}${hrs},${after} ${body}${undo}.`;
}

function pairNotes(a: Actions) {
    const w: string[] = [];
    const i: string[] = [];
    const pair = (name: string, shown: string, f: Tri, rl: Tri) => {
        const v = { name: tx(name), shown: tx(shown) };
        if (f === 1 && rl === 1) w.push(tx("{name}: fake On and real On are both set. The real one already shows you {shown}, the fake adds nothing.", v));
        else if (f === 2 && rl === 1) w.push(tx("{name}: a fake Off cannot hide a real On. Others still see you {shown}.", v));
        else if (f === 1 && rl === 2) i.push(tx("{name}: others will see you {shown} (fake) while you really are not.", v));
    };
    pair("Microphone", "muted", a.fakeMute, a.mute);
    pair("Headset", "deafened", a.fakeDeafen, a.deafen);
    pair("Camera", "with the camera on", a.fakeCamera, a.camera);
    if (a.deafen === 1 && a.mute === 2) w.push(tx("Deafen with unmute: Discord keeps you muted while you are deafened."));
    if (a.crash === 1 && a.camera === 2) w.push(tx("Hide camera with camera off: there is no video to hide."));
    if (a.crash === 1 && a.safeCam === 1) w.push(tx("Hide camera and safe camera swap together: pick one of them."));
    if (a.crash === 1 && !settings.store.cameraHook && !settings.store.cameraFallback) w.push(tx("Hide camera needs Camera hooking or the safe camera fallback (Settings, Camera shield)."));
    if (a.safeCam === 1 && !settings.store.safeCamera) w.push(tx("No safe camera chosen in Settings: it will look for a camera named virtual."));
    if (a.fakeStream === 1 && a.stream === 1) w.push(tx("Stream: fake stream On and real screenshare Start together. Only one stream can run, the real one is skipped."));
    const first = settings.store.stopFirst;
    if (a.fakeStream === 1 && a.stream === 2) i.push(tx(first ? "Stream: the real screenshare stops first, then the fake stream starts. Final result: only the fake stream is on." : "Stream: On/Start runs first, so the fake stream cannot start while the real one is running. Final result: no stream."));
    if (a.fakeStream === 2 && a.stream === 1) i.push(tx(first ? "Stream: the fake stream stops first, then the real screenshare starts. Final result: the real screenshare is on." : "Stream: the real screenshare is blocked by the fake stream, then the fake stops. Final result: no stream."));
    return { w, i };
}

function warnings(r: Rule) {
    const w: string[] = [];
    const a = r.actions;
    const user = r.trigger === "user_join" || r.trigger === "user_leave";
    if (!actionList(r).length) w.push(tx("No action selected yet."));
    if (user && !r.whoAnyone && !r.whoOwner && !r.whoFriends && !r.perms.length && !r.roleIds.length && !r.userIds.length) w.push(tx("No person filter is set, nobody will match."));
    if (a.joinChannelId && r.trigger === "self_join" && r.channelIds.includes(a.joinChannelId)) w.push(tx("This rule joins the same channel it reacts to."));
    if (r.hoursOn && r.hourFrom === r.hourTo) w.push(tx("Hours: start and end are equal, the rule never runs."));
    if (r.roleIds.length && !r.guildIds.length) w.push(tx("Roles belong to one server: add that server in Where."));
    w.push(...pairNotes(a).w);
    return w;
}

function infos(r: Rule) {
    return pairNotes(r.actions).i;
}

function previewMatches(r: Rule): string[] | null {
    const cur = SelectedChannelStore.getVoiceChannelId();
    const me = UserStore.getCurrentUser()?.id;
    if (!cur || !me) return null;
    const c = compileRule(r);
    const gid = ChannelStore.getChannel(cur)?.guild_id ?? "";
    return (Object.values(VoiceStateStore.getVoiceStatesForChannel(cur) ?? {}) as { userId: string; }[])
        .filter(x => x.userId !== me && matchWho(c, gid, x.userId))
        .map(x => UserStore.getUser(x.userId)?.username ?? x.userId);
}

function ago(t: number) {
    const s = Math.max(0, Math.round((Date.now() - t) / 1000));
    if (s < 60) return tx("{n}s ago", { n: s });
    if (s < 3600) return tx("{n}m ago", { n: Math.floor(s / 60) });
    return tx("{n}h ago", { n: Math.floor(s / 3600) });
}

function guildOpts(): [string, string][] {
    const now = Date.now();
    if (guildCache && now - guildCache.t < 4000) return guildCache.list;
    const list = Object.values(GuildStore.getGuilds()).sort((a, b) => a.name.localeCompare(b.name)).map(g => opt(g.id, g.name));
    guildCache = { t: now, list };
    return list;
}

function vocalChannels(gid: string): [string, string][] {
    const chans: any[] = (GuildChannelStore.getChannels(gid) as any)?.VOCAL ?? [];
    return chans.map(x => opt(x.channel.id, x.channel.name));
}

function findRole(id: string, guildIds: string[]) {
    const gids = guildIds.length ? guildIds : Object.keys(GuildStore.getGuilds());
    for (const g of gids) {
        const r: any = GuildRoleStore.getRolesSnapshot(g)?.[id];
        if (r) return { name: r.name as string, color: (r.colorString as string | undefined) ?? null, guild: g };
    }
    return null;
}

let conflictCache: { t: number; names: string[]; } | null = null;

function knownFakeEnabled(): boolean {
    try {
        const plugins = (Settings as any).plugins ?? {};
        return Object.keys(KNOWN_FAKE).some(n => plugins[n]?.enabled ?? KNOWN_FAKE[n]);
    } catch {
        return false;
    }
}

function conflictingPlugins(): string[] {
    if (!settings.store.collaborate) return [];
    const now = Date.now();
    if (conflictCache && now - conflictCache.t < 5000) return conflictCache.names;
    let names: string[] = [];
    try {
        const P = (Vencord as any).Plugins;
        names = Object.keys(P.plugins).filter(n => n !== "Voice Suite" && /fake.*(voice|mute|deaf|stream|cam)/i.test(n.replace(/\s/g, "")) && (P.plugins[n]?.started || P.isPluginEnabled?.(n)));
    } catch { }
    conflictCache = { t: now, names };
    return names;
}

function exportBackup() {
    const data = {
        app: "VoiceSuite", version: 2, exportedAt: new Date().toISOString(),
        settings: Object.fromEntries([...BACKUP_KEYS, ...BACKUP_STR].map(k => [k, settings.store[k]])),
        rules,
        keybinds
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: `voice-suite-${new Date().toISOString().slice(0, 10)}.json` });
    a.click();
    URL.revokeObjectURL(a.href);
}

function importBackup(mode: "add" | "replace"): Promise<string> {
    return new Promise(resolve => {
        const inp = Object.assign(document.createElement("input"), { type: "file", accept: ".json,application/json" });
        inp.onchange = async () => {
            const file = inp.files?.[0];
            if (!file) { resolve(""); return; }
            try {
                const parsed = JSON.parse(await file.text());
                const list: unknown = Array.isArray(parsed) ? parsed : parsed?.rules;
                if (!Array.isArray(list)) throw new Error("invalid");
                const imported = list.filter(x => x && typeof x === "object").map(x => ({ ...normalize(x), id: uid() }));
                if (mode === "replace") rules = imported;
                else rules.push(...imported);
                if (Array.isArray(parsed?.keybinds)) {
                    const kbs = parsed.keybinds.filter((x: any) => x && typeof x === "object").map((x: any) => ({ ...normalizeKb(x), id: uid() }));
                    if (mode === "replace") keybinds = kbs;
                    else keybinds.push(...kbs);
                    commitKb();
                }
                const s = parsed?.settings;
                if (s && typeof s === "object") {
                    for (const k of BACKUP_KEYS) if (typeof s[k] === "boolean") settings.store[k] = s[k];
                    for (const k of BACKUP_STR) if (typeof s[k] === "string") settings.store[k] = s[k];
                }
                commit();
                flush();
                resolve(tx(mode === "replace" ? "Imported {n} rule(s) (replaced)" : "Imported {n} rule(s) (added)", { n: imported.length }));
            } catch {
                resolve(tx("Import failed: invalid file"));
            }
        };
        inp.click();
    });
}

function Glyph({ state, className, width = 24, height = 24, color }: { state: AutoState; className?: string; width?: number | string; height?: number | string; color?: string; }) {
    const c = color ?? "currentColor";
    const badge = state === "on" ? K.green : state === "paused" ? K.amber : K.red;
    return (
        <svg className={className} width={width} height={height} viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path fill={c} fillRule="evenodd" clipRule="evenodd" d="M12 2.5c-4.4 0-7.5 3.3-7.5 7.7V20c0 .9 1 1.3 1.6.7l1.4-1.4c.4-.4 1-.4 1.4 0l1.2 1.2c.5.5 1.3.5 1.8 0l1.2-1.2c.4-.4 1-.4 1.4 0l1.4 1.4c.6.6 1.6.2 1.6-.7V10.2c0-4.4-3.1-7.7-7.5-7.7ZM9 8.2a1.4 1.4 0 1 0 0 2.8 1.4 1.4 0 0 0 0-2.8ZM15 8.2a1.4 1.4 0 1 0 0 2.8 1.4 1.4 0 0 0 0-2.8ZM8.6 13.4h1.2v2.6H8.6ZM11.4 12.6h1.2v4.2h-1.2ZM14.2 13.4h1.2v2.6h-1.2Z" />
            <circle cx="18.7" cy="18.7" r="4.9" fill={badge} />
            {state === "on" && <path d="M16.5 18.8l1.6 1.6 3-3.4" stroke="#052e16" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />}
            {state === "paused" && <path d="M17.6 16.4v4.6M20 16.4v4.6" stroke="#3a2600" strokeWidth="1.9" strokeLinecap="round" />}
            {state === "off" && <path d="M16.2 18.7h5" stroke="#3b0a0a" strokeWidth="2.1" strokeLinecap="round" />}
        </svg>
    );
}

type IconProps = { className?: string; width?: number | string; height?: number | string; color?: string; };
const IconOn = (p: IconProps) => <Glyph state="on" {...p} />;
const IconPaused = (p: IconProps) => <Glyph state="paused" {...p} />;
const IconOff = (p: IconProps) => <Glyph state="off" {...p} />;
const ICONS = { on: IconOn, paused: IconPaused, off: IconOff };

function openSuite() {
    if (!pluginActive) return;
    resolveSystemLang();
    wrapExternals();
    if (modalKey) { try { closeModal(modalKey); } catch { } }
    modalKey = openModal(props => <SuiteModal modalProps={props} />);
}

function useSuiteState(key: "showHeaderButton" | "showUserAreaButton"): AutoState | null {
    const s = settings.use([key, "enabled"]);
    const [, bump] = React.useReducer((x: number) => x + 1, 0);
    React.useEffect(() => subscribe(bump as () => void), []);
    if (!pluginActive || !s[key]) return null;
    return autoState();
}

function SuiteHeaderButton() {
    const st = useSuiteState("showHeaderButton");
    if (!st) return null;
    const tip = tx(st === "on" ? "Voice Suite: automation ON" : st === "paused" ? "Voice Suite: automation paused" : "Voice Suite: automation OFF");
    return <HeaderBarButton icon={ICONS[st]} tooltip={tip} onClick={openSuite} />;
}

function SuiteUserAreaButton() {
    const st = useSuiteState("showUserAreaButton");
    if (!st) return null;
    const tip = tx(st === "on" ? "Voice Suite: automation ON" : st === "paused" ? "Voice Suite: automation paused" : "Voice Suite: automation OFF");
    return <UserAreaButton tooltipText={tip} icon={<Glyph state={st} width={20} height={20} />} onClick={openSuite} />;
}

function Chip({ label, active, color = K.accent, disabled, onClick, title, big, tint }: { label: string; active?: boolean; color?: string; disabled?: boolean; onClick?: () => void; title?: string; big?: boolean; tint?: boolean; }) {
    return (
        <div role="button" title={title} onClick={() => { if (!disabled && onClick) onClick(); }}
            style={{
                padding: big ? "6px 13px" : "3px 9px", borderRadius: big ? 8 : 6, fontSize: big ? 13 : 11, fontWeight: 700, lineHeight: big ? "18px" : "16px",
                cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.35 : 1, userSelect: "none", whiteSpace: "nowrap",
                border: `1px solid ${active ? color : tint ? `${color}44` : K.line}`,
                background: active ? color : tint ? `${color}0e` : K.card2,
                color: active ? "#ffffff" : tint ? color : K.sub
            }}>
            {label}
        </div>
    );
}

function QChip(p: React.ComponentProps<typeof Chip>) {
    return <Chip big {...p} />;
}

function Toggle({ value, onChange, disabled }: { value: boolean; onChange: (v: boolean) => void; disabled?: boolean; }) {
    return (
        <div role="switch" aria-checked={value} onClick={() => { if (!disabled) onChange(!value); }}
            style={{
                width: 34, height: 18, borderRadius: 9, flexShrink: 0, position: "relative", userSelect: "none",
                cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.4 : 1,
                background: value ? K.deep : K.line, border: `1px solid ${value ? K.accent : K.line}`
            }}>
            <div style={{ position: "absolute", top: 2, left: value ? 18 : 2, width: 12, height: 12, borderRadius: 6, background: value ? "#fff" : K.mute }} />
        </div>
    );
}

function Sec({ n, title, hint, color = K.accent, children }: { n?: number; title: string; hint?: string; color?: string; children: React.ReactNode; }) {
    return (
        <div style={{ background: K.card, border: `1px solid ${K.soft}`, borderRadius: 9, padding: "8px 11px", marginBottom: 7 }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 7, marginBottom: 5 }}>
                {n !== undefined && <span style={{ fontSize: 11, fontWeight: 900, color }}>{n}</span>}
                <span style={{ fontSize: 12, fontWeight: 800, color }}>{title}</span>
                {hint && <span style={{ fontSize: 10, color: K.mute }}>{hint}</span>}
            </div>
            {children}
        </div>
    );
}

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode; }) {
    return (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "3px 0" }}>
            <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: K.text }}>{label}</div>
                {hint && <div style={{ fontSize: 10, color: K.mute }}>{hint}</div>}
            </div>
            <div style={{ display: "flex", gap: 5, alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end" }}>{children}</div>
        </div>
    );
}

function Cell({ label, children, full }: { label: string; children: React.ReactNode; full?: boolean; }) {
    return (
        <div style={{ gridColumn: full ? "1 / -1" : undefined, padding: "3px 0" }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: K.sub, marginBottom: 3 }}>{label}</div>
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap", alignItems: "center" }}>{children}</div>
        </div>
    );
}

function TriCell({ label, value, onChange, disabled, on = "On", off = "Off" }: { label: string; value: Tri; onChange: (v: Tri) => void; disabled?: boolean; on?: string; off?: string; }) {
    return (
        <Cell label={label}>
            <Chip label={tx("–")} title={tx("Do nothing")} active={value === 0} color={K.mute} disabled={disabled} onClick={() => onChange(0)} />
            <Chip label={tx(on)} active={value === 1} color={K.green} disabled={disabled} onClick={() => onChange(1)} />
            <Chip label={tx(off)} active={value === 2} color={K.red} disabled={disabled} onClick={() => onChange(2)} />
        </Cell>
    );
}

function Grid2({ children }: { children: React.ReactNode; }) {
    return <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", columnGap: 16 }}>{children}</div>;
}

function Tag({ children, color = K.mute }: { children: React.ReactNode; color?: string; }) {
    return <span style={{ fontSize: 11, fontWeight: 900, letterSpacing: 0.8, color, width: 58, flexShrink: 0 }}>{children}</span>;
}

function Field({ value, onChange, onEnter, onBlur, placeholder, width, disabled, mono, center }: { value: string; onChange: (v: string) => void; onEnter?: () => void; onBlur?: () => void; placeholder?: string; width?: number | string; disabled?: boolean; mono?: boolean; center?: boolean; }) {
    const [focus, setFocus] = React.useState(false);
    return (
        <div style={{ width: width ?? "100%", boxSizing: "border-box", background: K.input, border: `1px solid ${focus ? K.accent : K.line}`, borderRadius: 6, opacity: disabled ? 0.4 : 1 }}>
            <input value={value} disabled={disabled} placeholder={placeholder} spellCheck={false}
                onChange={e => onChange(e.target.value)}
                onFocus={() => setFocus(true)}
                onBlur={() => { setFocus(false); if (onBlur) onBlur(); }}
                onKeyDown={e => { if (e.key === "Enter" && onEnter) onEnter(); }}
                style={{ width: "100%", boxSizing: "border-box", background: "transparent", border: "none", outline: "none", color: K.text, fontSize: 12, padding: "4px 8px", fontFamily: mono ? "monospace" : "inherit", textAlign: center ? "center" : "left" }} />
        </div>
    );
}

function TextField({ value, onCommit, placeholder, width, mono, center, disabled }: { value: string; onCommit: (v: string) => void; placeholder?: string; width?: number | string; mono?: boolean; center?: boolean; disabled?: boolean; }) {
    const [v, setV] = React.useState(value);
    const vr = React.useRef(value);
    const lr = React.useRef(value);
    const cb = React.useRef(onCommit);
    vr.current = v;
    cb.current = onCommit;
    React.useEffect(() => { if (value !== lr.current) { lr.current = value; setV(value); } }, [value]);
    const done = () => {
        const x = vr.current;
        if (x === lr.current) return;
        lr.current = x;
        cb.current(x);
    };
    React.useEffect(() => done, []);
    return <Field value={v} onChange={setV} onEnter={done} onBlur={done} placeholder={placeholder} width={width} mono={mono} center={center} disabled={disabled} />;
}

function NumField({ value, onCommit, min = 0, max = 1000000, width = 60 }: { value: number; onCommit: (v: number) => void; min?: number; max?: number; width?: number; }) {
    return <TextField value={String(value)} width={width} center onCommit={s => onCommit(clampInt(s, min, max, min))} />;
}

function Mini({ label, children }: { label: string; children: React.ReactNode; }) {
    return (
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: 11, color: K.sub, fontWeight: 700 }}>{label}</span>
            {children}
        </div>
    );
}

function Dropdown({ value, options, onChange, disabled, width = 220, placeholder = "Select…" }: { value: string; options: [string, string][]; onChange: (v: string) => void; disabled?: boolean; width?: number | string; placeholder?: string; }) {
    const [open, setOpen] = React.useState(false);
    const [q, setQ] = React.useState("");
    const cur = options.find(o => o[0] === value);
    const list = open && q ? options.filter(o => o[1].toLowerCase().includes(q.toLowerCase())) : options;
    return (
        <div style={{ width, opacity: disabled ? 0.4 : 1 }}>
            <div role="button" onClick={() => { if (!disabled) setOpen(!open); }}
                style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 6, padding: "4px 8px", background: K.input, border: `1px solid ${open ? K.accent : K.line}`, borderRadius: 6, cursor: disabled ? "not-allowed" : "pointer", userSelect: "none", fontSize: 12, color: cur && cur[0] ? K.text : K.mute }}>
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{cur ? cur[1] : tx(placeholder)}</span>
                <span style={{ fontSize: 8, color: K.mute }}>{open ? "▲" : "▼"}</span>
            </div>
            {open && (
                <div style={{ marginTop: 2, background: K.card3, border: `1px solid ${K.line}`, borderRadius: 6, maxHeight: 200, overflowY: "auto" }}>
                    {options.length > 8 && <div style={{ padding: 4 }}><Field value={q} onChange={setQ} placeholder={tx("Filter…")} /></div>}
                    {list.length === 0 && <div style={{ padding: "5px 8px", fontSize: 12, color: K.mute }}>{tx("Nothing found")}</div>}
                    {list.map(([v, l]) => (
                        <div key={v || "__none"} role="button" onClick={() => { onChange(v); setOpen(false); setQ(""); }}
                            style={{ padding: "4px 8px", fontSize: 12, cursor: "pointer", userSelect: "none", color: v === value ? K.accent : K.text, background: v === value ? K.card2 : "transparent", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {l}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

function ScopePicker({ guildIds, channelIds, onChange }: { guildIds: string[]; channelIds: string[]; onChange: (g: string[], c: string[]) => void; }) {
    const [pg, setPg] = React.useState("");
    const guilds = guildOpts();
    const addGuild = guilds.filter(o => !guildIds.includes(o[0]));
    const chans = pg ? vocalChannels(pg).filter(o => !channelIds.includes(o[0])) : [];
    const useCurrent = () => {
        const id = SelectedChannelStore.getVoiceChannelId();
        const ch = id ? ChannelStore.getChannel(id) : null;
        if (ch && !channelIds.includes(ch.id)) onChange(guildIds, [...channelIds, ch.id]);
    };
    return (
        <div>
            <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginBottom: 6, alignItems: "center" }}>
                {!guildIds.length && !channelIds.length && <span style={{ fontSize: 12, color: K.green, fontWeight: 700 }}>{tx("Everywhere (any server, any voice channel)")}</span>}
                {guildIds.map(id => <Chip key={`g${id}`} label={tx("Server: {name} ✕", { name: gName(id) })} color={K.blue} active onClick={() => onChange(guildIds.filter(x => x !== id), channelIds)} />)}
                {channelIds.map(id => {
                    const gid = ChannelStore.getChannel(id)?.guild_id;
                    return <Chip key={`c${id}`} label={`#${chName(id)}${gid ? ` · ${gName(gid)}` : ""} ✕`} color={K.green} active onClick={() => onChange(guildIds, channelIds.filter(x => x !== id))} />;
                })}
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "flex-start" }}>
                <Dropdown width={210} value="" options={addGuild} disabled={!addGuild.length} placeholder={tx("+ Add a whole server…")} onChange={v => { if (v) onChange([...guildIds, v], channelIds); }} />
                <Dropdown width={190} value={pg} options={[opt("", tx("Pick a server for a channel…")), ...guilds]} placeholder={tx("Pick a server for a channel…")} onChange={setPg} />
                <Dropdown width={210} value="" options={chans} disabled={!pg || !chans.length} placeholder={tx(pg ? (chans.length ? "+ Add a voice channel…" : "No more channels") : "then pick a channel")} onChange={v => { if (v) onChange(guildIds, [...channelIds, v]); }} />
                <Chip label={tx("+ My current channel")} onClick={useCurrent} />
                {(guildIds.length > 0 || channelIds.length > 0) && <Chip label={tx("Clear")} color={K.red} onClick={() => onChange([], [])} />}
            </div>
        </div>
    );
}

function IdList({ ids, onChange, kind, guildIds = [], color, label, hint }: { ids: string[]; onChange: (v: string[]) => void; kind: "user" | "role"; guildIds?: string[]; color: string; label: string; hint: string; }) {
    const [draft, setDraft] = React.useState("");
    const [warn, setWarn] = React.useState("");
    const [editIdx, setEditIdx] = React.useState<number | null>(null);
    const [editVal, setEditVal] = React.useState("");
    const [confirm, setConfirm] = React.useState(false);

    const add = () => {
        const tokens = draft.split(/[\s,;]+/).filter(Boolean);
        if (!tokens.length) return;
        const valid = tokens.filter(t => ID_RE.test(t) && !ids.includes(t));
        const bad = tokens.filter(t => !ID_RE.test(t)).length;
        if (valid.length) onChange([...new Set([...ids, ...valid])]);
        setDraft("");
        setWarn(bad ? tx("{n} invalid ID ignored (17-20 digits)", { n: bad }) : "");
    };

    const saveEdit = (i: number) => {
        const v = editVal.trim();
        setEditIdx(null);
        if (!ID_RE.test(v) || v === ids[i] || ids.includes(v)) return;
        const n = [...ids];
        n[i] = v;
        onChange(n);
    };

    const me = UserStore.getCurrentUser()?.id;
    const cur = SelectedChannelStore.getVoiceChannelId();
    let quick: [string, string][] = [];
    if (kind === "user" && cur) {
        quick = (Object.values(VoiceStateStore.getVoiceStatesForChannel(cur) ?? {}) as { userId: string; }[])
            .filter(s => s.userId !== me && !ids.includes(s.userId))
            .map(s => opt(s.userId, UserStore.getUser(s.userId)?.username ?? s.userId));
    } else if (kind === "role") {
        for (const g of guildIds) {
            const rs = (Object.values(GuildRoleStore.getRolesSnapshot(g) ?? {}) as any[])
                .filter(r => r.id !== g && !ids.includes(r.id))
                .sort((a, b) => b.position - a.position);
            for (const r of rs) quick.push(opt(r.id, guildIds.length > 1 ? `${r.name} · ${gName(g)}` : r.name));
        }
    }
    const quickHint = kind === "user"
        ? tx(quick.length ? "+ Pick from my current call…" : cur ? "Nobody else in my call" : "Join a call to pick people")
        : tx(guildIds.length ? (quick.length ? "+ Pick a role…" : "No more roles") : "Add a server in Where to pick roles");

    return (
        <div style={{ border: `1px solid ${K.soft}`, borderRadius: 8, padding: "6px 8px", background: K.card3, marginTop: 5 }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginBottom: 4 }}>
                <span style={{ fontSize: 11, fontWeight: 800, color }}>{label}</span>
                <span style={{ fontSize: 10, padding: "0 6px", borderRadius: 6, background: K.card2, color: K.sub, fontWeight: 800 }}>{ids.length}</span>
                <span style={{ fontSize: 10, color: K.mute, flex: 1 }}>{hint}</span>
                {ids.length > 0 && !confirm && <Chip label={tx("Clear")} color={K.red} onClick={() => setConfirm(true)} />}
                {confirm && (
                    <>
                        <Chip label={tx("Remove all")} color={K.red} active onClick={() => { setConfirm(false); onChange([]); }} />
                        <Chip label={tx("No")} color={K.mute} onClick={() => setConfirm(false)} />
                    </>
                )}
            </div>
            {ids.length > 0 && (
                <div style={{ maxHeight: 130, overflowY: "auto", marginBottom: 4 }}>
                    {ids.map((id, i) => {
                        const u = kind === "user" ? UserStore.getUser(id) : null;
                        const role = kind === "role" ? findRole(id, guildIds) : null;
                        const name = kind === "user" ? (u ? u.username : null) : (role ? role.name : null);
                        return (
                            <div key={id} style={{ display: "flex", alignItems: "center", gap: 6, padding: "2px 6px", marginBottom: 2, borderRadius: 6, background: K.card2 }}>
                                <div style={{ width: 7, height: 7, borderRadius: 4, background: role?.color || color, flexShrink: 0 }} />
                                {editIdx === i
                                    ? <div style={{ flex: 1 }}><Field value={editVal} mono onChange={setEditVal} onEnter={() => saveEdit(i)} onBlur={() => saveEdit(i)} /></div>
                                    : <div role="button" title={tx("Click to edit")} onClick={() => { setEditIdx(i); setEditVal(id); }} style={{ fontFamily: "monospace", fontSize: 11, color: K.sub, cursor: "text", userSelect: "text" }}>{id}</div>}
                                <div style={{ flex: 1, minWidth: 0, fontSize: 11, fontWeight: 700, color: name ? K.text : K.mute, fontStyle: name ? "normal" : "italic", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                    {name ?? tx(kind === "user" ? "unknown user" : "role not found")}
                                    {role && guildIds.length > 1 ? <span style={{ color: K.mute, fontWeight: 400 }}> · {gName(role.guild)}</span> : null}
                                </div>
                                <div role="button" onClick={() => onChange(ids.filter((_, j) => j !== i))} style={{ cursor: "pointer", color: K.red, fontSize: 12, fontWeight: 800, padding: "0 4px", userSelect: "none" }}>✕</div>
                            </div>
                        );
                    })}
                </div>
            )}
            <div style={{ display: "flex", gap: 5, alignItems: "center" }}>
                <Field value={draft} mono placeholder={tx("Paste IDs, then Enter")} onChange={setDraft} onEnter={add} />
                <Chip label={tx("Add")} color={color} active onClick={add} />
                <Dropdown value="" options={quick} disabled={!quick.length} placeholder={quickHint} width={230} onChange={v => { if (v) onChange([...ids, v]); }} />
            </div>
            {warn && <div style={{ fontSize: 10, color: K.amber, marginTop: 3 }}>⚠ {warn}</div>}
        </div>
    );
}

function OrderBar() {
    const first = settings.store.stopFirst;
    const pill = (c: string): React.CSSProperties => ({ fontSize: 10, fontWeight: 800, padding: "1px 7px", borderRadius: 6, color: c, border: `1px solid ${c}`, background: `${c}22` });
    const offs = <span style={pill(K.red)}>{tx("Off · Stop · Unmute · Undeafen · Camera off · Release · Panic")}</span>;
    const ons = <span style={pill(K.green)}>{tx("On · Start · Mute · Deafen · Crash · Camera on · Join")}</span>;
    return (
        <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", marginBottom: 6 }}>
            <span style={{ fontSize: 11, color: K.sub, fontWeight: 700 }}>{tx("Runs in this order:")}</span>
            <span style={{ fontSize: 10, fontWeight: 900, color: K.mute }}>1</span>
            {first ? offs : ons}
            <span style={{ fontSize: 10, fontWeight: 900, color: K.mute }}>2</span>
            {first ? ons : offs}
            <Chip label={tx("Swap order")} title={tx("Applies to every rule")} onClick={() => { settings.store.stopFirst = !settings.store.stopFirst; emit(); }} />
        </div>
    );
}

function RuleEditor({ rule, onBack }: { rule: Rule; onBack: () => void; }) {
    const a = rule.actions;
    const isUser = rule.trigger === "user_join" || rule.trigger === "user_leave";
    const scoped = rule.trigger !== "startup" && rule.trigger !== "manual";
    const noVoice = rule.trigger === "self_leave";
    const noStream = rule.trigger === "stream_start" || rule.trigger === "stream_stop";
    const lock = a.disconnect;
    const [note, setNote] = React.useState("");
    const warns = warnings(rule);
    const trig = TRIGGERS.find(t => t.id === rule.trigger)!;
    const set = (patch: Partial<Rule>) => { Object.assign(rule, patch); commit(); };
    const setA = (key: keyof Actions, value: Actions[keyof Actions]) => {
        const before = { ...rule.actions };
        applyAction(rule.actions, key, value);
        if (key === "disconnect" && value) setNote(tx("Disconnect cleared the other actions."));
        else if (key === "joinChannelId" && value && before.disconnect) setNote(tx("Join replaced Disconnect."));
        else setNote("");
        commit();
    };
    const togglePerm = (p: string) => set({ perms: rule.perms.includes(p) ? rule.perms.filter(x => x !== p) : [...rule.perms, p] });
    const srcName = srcChoice?.name ?? tx("primary screen");
    const matches = isUser ? previewMatches(rule) : null;
    const infoLines = infos(rule);
    const guilds = guildOpts();
    const joinChans = a.joinGuildId ? vocalChannels(a.joinGuildId) : [];
    let n = 1;

    return (
        <div>
            <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 7 }}>
                <Chip label={tx("‹ Rules")} onClick={onBack} />
                <div style={{ flex: 1 }}><TextField value={rule.name} placeholder={tx("Rule name")} onCommit={v => set({ name: v.slice(0, 40) || tx("Unnamed rule") })} /></div>
                <Toggle value={rule.enabled} onChange={v => set({ enabled: v })} />
                <Chip label={tx("▶ Run now")} color={K.green} onClick={() => runRule(rule)} />
            </div>

            <div style={{ background: K.card3, border: `1px solid ${K.accent}`, borderRadius: 8, padding: "7px 11px", marginBottom: 7 }}>
                <div style={{ fontSize: 12, color: K.text, lineHeight: 1.45 }}>{describe(rule)}</div>
                {warns.map(w => <div key={w} style={{ fontSize: 11, color: K.amber, marginTop: 3 }}>⚠ {w}</div>)}
                {infoLines.map(w => <div key={w} style={{ fontSize: 11, color: K.blue, marginTop: 3 }}>» {w}</div>)}
            </div>

            <Sec n={n++} title={tx("When")} color={trig.color} hint={tx(trig.desc)}>
                <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                    {TRIGGERS.map(t => (
                        <Chip key={t.id} label={tx(t.label)} color={t.color} active={rule.trigger === t.id} onClick={() => { rule.trigger = t.id; enforceTrigger(rule); commit(); }} />
                    ))}
                </div>
            </Sec>

            {scoped && (
                <Sec n={n++} title={tx("Where")} color={K.blue} hint={tx("Add several servers or channels. A rule runs in any of them.")}>
                    <ScopePicker guildIds={rule.guildIds} channelIds={rule.channelIds} onChange={(g, c) => set({ guildIds: g, channelIds: c })} />
                </Sec>
            )}

            {isUser && (
                <Sec n={n++} title={tx("Who")} color={K.amber} hint={tx("A person matches if ANY option fits.")}>
                    <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 5 }}>
                        <Chip label={tx("Anyone")} color={K.green} active={rule.whoAnyone} onClick={() => set({ whoAnyone: !rule.whoAnyone })} />
                        <Chip label={tx("Server owner")} color={K.amber} active={rule.whoOwner} disabled={rule.whoAnyone} onClick={() => set({ whoOwner: !rule.whoOwner })} />
                        <Chip label={tx("Friends")} color={K.amber} active={rule.whoFriends} disabled={rule.whoAnyone} onClick={() => set({ whoFriends: !rule.whoFriends })} />
                        <Chip label={tx("Ignore bots")} color={K.mute} active={rule.ignoreBots} onClick={() => set({ ignoreBots: !rule.ignoreBots })} />
                        {rule.trigger === "user_join" && <Chip label={tx("Check people already inside")} color={K.mute} active={rule.scanOnJoin} title={tx("Also evaluates the channel when you join it")} onClick={() => set({ scanOnJoin: !rule.scanOnJoin })} />}
                    </div>
                    <div style={{ fontSize: 10, color: K.mute, marginBottom: 3 }}>{tx("Members with ANY of these permissions (administrators always match)")}</div>
                    <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                        {PERMS.map(([id, label]) => <Chip key={id} label={label} color={K.amber} active={rule.perms.includes(id)} disabled={rule.whoAnyone} onClick={() => togglePerm(id)} />)}
                        <Chip label={tx("All staff")} color={K.pink} disabled={rule.whoAnyone} onClick={() => set({ perms: STAFF_PERMS })} />
                        <Chip label={tx("None")} color={K.mute} disabled={rule.whoAnyone} onClick={() => set({ perms: [] })} />
                    </div>
                    <IdList kind="role" ids={rule.roleIds} guildIds={rule.guildIds} color={K.amber} label={tx("Roles")} hint={tx("any of these roles")} onChange={v => set({ roleIds: v })} />
                    <IdList kind="user" ids={rule.userIds} color={K.green} label={tx("Specific users")} hint={tx("always match")} onChange={v => set({ userIds: v })} />
                    <IdList kind="user" ids={rule.ignoreIds} color={K.red} label={tx("Ignored users")} hint={tx("never match")} onChange={v => set({ ignoreIds: v })} />
                    <div style={{ fontSize: 11, color: matches && matches.length ? K.green : K.mute, marginTop: 5 }}>
                        {matches === null ? tx("Join a call to preview who matches.") : matches.length ? tx("Matching in my current call: {names}", { names: matches.join(", ") }) : tx("Nobody in my current call matches this filter.")}
                    </div>
                </Sec>
            )}

            <Sec n={n++} title={tx("Only if")} color={K.pink} hint={tx("Optional. The rule is skipped when a condition is not met.")}>
                <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 5 }}>
                    <Chip label={tx("My camera is on")} color={K.pink} active={rule.requireCamOn} onClick={() => set({ requireCamOn: !rule.requireCamOn })} />
                    <Chip label={tx("I am screensharing")} color={K.pink} active={rule.requireStreaming} onClick={() => set({ requireStreaming: !rule.requireStreaming })} />
                    <Chip label={tx("Once per session")} color={K.pink} active={rule.once} onClick={() => set({ once: !rule.once })} />
                    <Chip label={tx("Only during hours")} color={K.pink} active={rule.hoursOn} title={tx("Uses your computer clock. 22 to 6 works overnight.")} onClick={() => set({ hoursOn: !rule.hoursOn })} />
                </div>
                <div style={{ display: "flex", gap: 4, flexWrap: "wrap", alignItems: "center", marginBottom: 5 }}>
                    <span style={{ fontSize: 11, color: K.sub, fontWeight: 700, marginRight: 2 }}>{tx("Days (none = every day)")}</span>
                    {DAY_NAMES.map((d, i) => <Chip key={d} label={d} color={K.pink} active={rule.days.includes(i)} onClick={() => set({ days: rule.days.includes(i) ? rule.days.filter(x => x !== i) : [...rule.days, i] })} />)}
                </div>
                <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
                    <Mini label={tx("Min people in channel (0 = off)")}><NumField value={rule.minUsers} max={999} onCommit={v => set({ minUsers: v })} /></Mini>
                    {rule.hoursOn && <Mini label={tx("From hour")}><NumField value={rule.hourFrom} max={23} onCommit={v => set({ hourFrom: v })} /></Mini>}
                    {rule.hoursOn && <Mini label={tx("until")}><NumField value={rule.hourTo} max={23} onCommit={v => set({ hourTo: v })} /></Mini>}
                </div>
            </Sec>

            <Sec n={n++} title={tx("Timing")} color={K.sub} hint={tx("Seconds. 0 = off.")}>
                <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
                    <Mini label={tx("Wait before acting")}><NumField value={rule.delay} max={86400} onCommit={v => set({ delay: v })} /></Mini>
                    <Mini label={tx("Cooldown")}><NumField value={rule.cooldown} max={86400} onCommit={v => set({ cooldown: v })} /></Mini>
                    <Mini label={tx("Undo after")}><NumField value={rule.revertAfter} max={86400} onCommit={v => set({ revertAfter: v })} /></Mini>
                </div>
            </Sec>

            <Sec n={n++} title={tx("Then do")} color={K.green} hint={tx("Fake and real can be combined. Results and warnings are written at the top of the rule.")}>
                <OrderBar />
                {note && <div style={{ fontSize: 11, color: K.amber, marginBottom: 4 }}>» {note}</div>}
                <Grid2>
                    <TriCell label={tx("Fake mute")} value={a.fakeMute} disabled={lock} onChange={v => setA("fakeMute", v)} />
                    <TriCell label={tx("Real microphone")} value={a.mute} disabled={lock || noVoice} on="Mute" off="Unmute" onChange={v => setA("mute", v)} />
                    <TriCell label={tx("Fake deafen")} value={a.fakeDeafen} disabled={lock} onChange={v => setA("fakeDeafen", v)} />
                    <TriCell label={tx("Real headset")} value={a.deafen} disabled={lock || noVoice} on="Deafen" off="Undeafen" onChange={v => setA("deafen", v)} />
                    <TriCell label={tx("Fake camera")} value={a.fakeCamera} disabled={lock} onChange={v => setA("fakeCamera", v)} />
                    <TriCell label={tx("Real camera")} value={a.camera} disabled={lock || noVoice} on="Turn on" off="Turn off" onChange={v => setA("camera", v)} />
                    <TriCell label={tx("Fake stream")} value={a.fakeStream} disabled={lock || noVoice || noStream} onChange={v => setA("fakeStream", v)} />
                    <TriCell label={tx("Real screenshare ({name})", { name: srcName })} value={a.stream} disabled={lock || noVoice || noStream} on="Start" off="Stop" onChange={v => setA("stream", v)} />
                </Grid2>
                <Grid2>
                    <TriCell label={tx("Hide camera (Settings, Camera shield)")} value={a.crash} disabled={lock || noVoice} on="Hide" off="Show" onChange={v => setA("crash", v)} />
                    <TriCell label={tx("Safe camera swap")} value={a.safeCam} disabled={lock || noVoice} on="Switch" off="Restore" onChange={v => setA("safeCam", v)} />
                </Grid2>
                <Grid2>
                    <Cell label={tx("Voice channel")}>
                        <Chip label={tx("Disconnect")} color={K.red} active={a.disconnect} disabled={noVoice} onClick={() => setA("disconnect", !a.disconnect)} />
                        <Chip label={tx("Panic profile")} color={K.red} active={a.panic} disabled={lock || noVoice} title={`Runs: ${panicSummary()}`} onClick={() => setA("panic", !a.panic)} />
                        <Chip label={tx("Show toast")} color={K.blue} active={a.toast} title={tx("Always shows when this rule runs, even if Toasts is off in Settings")} onClick={() => setA("toast", !a.toast)} />
                    </Cell>
                    <Cell label={tx("Join a channel (fakes apply first)")}>
                        <Dropdown width={150} value={a.joinGuildId} options={[opt("", tx("Server…")), ...guilds]} disabled={lock || noVoice} placeholder={tx("Server…")} onChange={g => { a.joinGuildId = g; a.joinChannelId = ""; commit(); }} />
                        <Dropdown width={150} value={a.joinChannelId} options={[opt("", tx("No join")), ...joinChans]} disabled={lock || noVoice || !a.joinGuildId} placeholder={tx("No join")} onChange={c => setA("joinChannelId", c)} />
                    </Cell>
                </Grid2>
            </Sec>
        </div>
    );
}

function RulesList({ onEdit }: { onEdit: (id: string) => void; }) {
    const [confirmId, setConfirmId] = React.useState<string | null>(null);
    const [notice, setNotice] = React.useState("");
    const [q, setQ] = React.useState("");
    const [presets, setPresets] = React.useState(false);
    const nt = React.useRef<ReturnType<typeof setTimeout> | null>(null);

    React.useEffect(() => () => { if (nt.current) clearTimeout(nt.current); }, []);

    const flash = (msg: string) => {
        if (!msg) return;
        setNotice(msg);
        if (nt.current) clearTimeout(nt.current);
        nt.current = setTimeout(() => setNotice(tx("")), 5000);
    };
    const add = (r: Rule) => { rules.push(r); commit(); onEdit(r.id); };
    const copy = (r: Rule) => { rules.push(normalize({ ...r, id: uid(), name: `${r.name} copy` })); commit(); };
    const remove = (id: string) => { rules = rules.filter(r => r.id !== id); setConfirmId(null); commit(); };
    const move = (i: number, d: number) => {
        const j = i + d;
        if (j < 0 || j >= rules.length) return;
        [rules[i], rules[j]] = [rules[j], rules[i]];
        commit();
    };
    const setAll = (v: boolean) => { for (const r of rules) r.enabled = v; commit(); };
    const showStats = settings.store.showActivity;

    return (
        <div>
            <div style={{ display: "flex", gap: 5, flexWrap: "wrap", alignItems: "center", marginBottom: 7 }}>
                <Chip label={tx("+ New rule")} color={K.green} active onClick={() => add(newRule())} />
                <Chip label={tx(presets ? "Presets ▲" : "Presets ▼")} color={K.pink} active={presets} onClick={() => setPresets(!presets)} />
                <Chip label={tx("Export")} onClick={() => { exportBackup(); flash(tx("Backup downloaded")); }} />
                <Chip label={tx("Import")} title={tx("Add the rules of a backup file")} onClick={async () => flash(await importBackup("add"))} />
                <Chip label={tx("Import & replace")} color={K.amber} onClick={async () => flash(await importBackup("replace"))} />
                <Chip label={tx("All on")} color={K.green} onClick={() => setAll(true)} />
                <Chip label={tx("All off")} color={K.red} onClick={() => setAll(false)} />
                {notice && <span style={{ fontSize: 11, color: K.sub, fontWeight: 700 }}>{notice}</span>}
            </div>

            {(presets || rules.length === 0) && (
                <Sec title={tx("Presets")} color={K.pink} hint={tx("Click to add, then fine-tune.")}>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 5 }}>
                        {PRESETS.map(p => (
                            <div key={p.name} role="button" onClick={() => add(p.make())}
                                style={{ padding: "5px 9px", borderRadius: 7, cursor: "pointer", userSelect: "none", border: `1px solid ${K.soft}`, background: K.card2 }}>
                                <div style={{ fontSize: 12, fontWeight: 800, color: K.pink }}>+ {tx(p.name)}</div>
                                <div style={{ fontSize: 10, color: K.mute }}>{tx(p.desc)}</div>
                            </div>
                        ))}
                    </div>
                </Sec>
            )}

            {rules.length > 4 && <div style={{ marginBottom: 6 }}><Field value={q} onChange={setQ} placeholder={tx("Search rules…")} /></div>}

            {rules.map((r, i) => {
                if (q && !`${r.name} ${describe(r)}`.toLowerCase().includes(q.toLowerCase())) return null;
                const t = TRIGGERS.find(x => x.id === r.trigger)!;
                const st = showStats ? stats.get(r.id) : undefined;
                const warns = warnings(r);
                return (
                    <div key={r.id} style={{ background: K.card, border: `1px solid ${r.enabled ? K.line : K.soft}`, borderRadius: 9, padding: "7px 10px", marginBottom: 6, opacity: r.enabled ? 1 : 0.6 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                            <span style={{ fontSize: 13, fontWeight: 800, color: K.text, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.name}</span>
                            <span style={{ fontSize: 10, fontWeight: 800, padding: "1px 7px", borderRadius: 6, color: t.color, border: `1px solid ${t.color}`, background: `${t.color}22` }}>{tx(t.label)}</span>
                            <Toggle value={r.enabled} onChange={v => { r.enabled = v; commit(); }} />
                        </div>
                        <div style={{ fontSize: 11, color: K.sub, margin: "4px 0", lineHeight: 1.4 }}>{describe(r)}</div>
                        {(st || warns.length > 0) && (
                            <div style={{ fontSize: 10, color: warns.length ? K.amber : K.mute, marginBottom: 4 }}>
                                {warns.length > 0 ? `⚠ ${warns[0]}${warns.length > 1 ? tx(" (+{n} more)", { n: warns.length - 1 }) : ""}` : ""}
                                {st ? `${warns.length ? " · " : ""}${tx("Ran {n}× · last {when}", { n: st.n, when: ago(st.t) })}` : ""}
                            </div>
                        )}
                        <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                            <Chip label={tx("▲")} disabled={i === 0} onClick={() => move(i, -1)} />
                            <Chip label={tx("▼")} disabled={i === rules.length - 1} onClick={() => move(i, 1)} />
                            <Chip label={tx("Edit")} onClick={() => onEdit(r.id)} />
                            <Chip label={tx("Run")} color={K.green} onClick={() => runRule(r)} />
                            <Chip label={tx("Duplicate")} color={K.blue} onClick={() => copy(r)} />
                            {confirmId === r.id
                                ? <>
                                    <Chip label={tx("Confirm delete")} color={K.red} active onClick={() => remove(r.id)} />
                                    <Chip label={tx("Cancel")} color={K.mute} onClick={() => setConfirmId(null)} />
                                </>
                                : <Chip label={tx("Delete")} color={K.red} onClick={() => setConfirmId(r.id)} />}
                        </div>
                    </div>
                );
            })}
            {rules.length === 0 && <div style={{ textAlign: "center", color: K.mute, fontSize: 12, padding: "10px 0" }}>{tx("No rules yet. Pick a preset or press + New rule, then test it with Run now.")}</div>}
        </div>
    );
}

function QuickBar() {
    const cur = SelectedChannelStore.getVoiceChannelId();
    const streaming = hasActiveStream();
    const streamLocked = streaming && !isFakeStreamOn();
    const left = pausedUntil - Date.now();
    const paused = left > 0;
    const mins = clampInt(settings.store.pauseMinutes, 1, 10080, 15);
    const others = conflictingPlugins();
    const ch = cur ? ChannelStore.getChannel(cur) : null;
    const rs = realState();
    const eff = effectiveFake();
    return (
        <div style={{ background: K.card3, border: `1px solid ${K.soft}`, borderRadius: 9, padding: "7px 9px", marginBottom: 8, display: "flex", flexDirection: "column", gap: 7 }}>
            {hookWarn && (
                <div style={{ fontSize: 11, color: K.amber, border: `1px solid ${K.amber}`, borderRadius: 6, padding: "4px 8px" }}>
                    ⚠ {tx("Fake states from Voice Suite are not reaching Discord. Reload Discord. If it continues, tell me which fake plugins are enabled.")}
                </div>
            )}
            {others.length > 0 && (
                <div style={{ fontSize: 11, color: K.blue, border: `1px solid ${K.soft}`, borderRadius: 6, padding: "4px 8px" }}>
                    » {tx("Working together with {names}. The FAKE chips below show the combined state of all fake plugins: turning one off here turns it off for them too.", { names: others.join(", ") })}
                </div>
            )}
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <Tag color={K.green}>{tx("NOW")}</Tag>
                <span style={{ fontSize: 12, color: cur ? K.green : K.mute, fontWeight: 700 }}>
                    {cur ? `#${ch?.name ?? cur}${ch?.guild_id ? ` · ${gName(ch.guild_id)}` : ""}` : tx("Not in a voice channel")}
                    {streaming ? " · " + tx(isFakeStreamOn() ? "fake stream" : "screensharing") : ""}
                </span>
            </div>
            <div style={{ display: "flex", gap: 5, alignItems: "center", flexWrap: "wrap" }}>
                <Tag color={K.pink}>{tx("FAKE")}</Tag>
                <QChip label={tx("Mute")} color={K.pink} active={eff.selfMute} onClick={() => setFake("selfMute", !eff.selfMute)} />
                <QChip label={tx("Deafen")} color={K.accent} active={eff.selfDeaf} onClick={() => setFake("selfDeaf", !eff.selfDeaf)} />
                <QChip label={tx("Camera")} color={K.blue} active={eff.selfVideo} onClick={() => setFake("selfVideo", !eff.selfVideo)} />
                <QChip label={tx("Stream")} color={K.cyan} active={isFakeStreamOn()} disabled={streamLocked || !cur} onClick={() => setFakeStream(!isFakeStreamOn())} />
                <QChip label={tx("Ghost")} title={tx("Fake mute + deafen")} color={K.amber} onClick={() => setFakeCombo(true, true, false)} />
                <QChip label={tx("Reset")} color={K.red} onClick={resetFakes} />
            </div>
            <div style={{ display: "flex", gap: 5, alignItems: "center", flexWrap: "wrap" }}>
                <Tag color={K.cyan}>{tx("REAL")}</Tag>
                <QChip label={rs.mute ? tx("Muted") : tx("Mute")} color={K.red} active={rs.mute} disabled={!cur} onClick={toggleRealMute} />
                <QChip label={rs.deaf ? tx("Deafened") : tx("Deafen")} color={K.orange} active={rs.deaf} disabled={!cur} onClick={toggleRealDeaf} />
                <QChip label={tx("Cam on")} color={K.green} disabled={!cur || rs.cam} onClick={() => setCamera(true)} />
                <QChip label={tx("Cam off")} color={K.amber} disabled={!cur || !rs.cam} onClick={() => setCamera(false)} />
                <QChip label={tx("▶ Share")} color={K.cyan} disabled={!cur || streaming} title={tx("Starts a screenshare of the source chosen in Settings")} onClick={startRealStream} />
                <QChip label={tx("■ Stop share")} color={K.red} disabled={!streaming} onClick={stopAnyStream} />
                <QChip label={tx("Leave")} color={K.pink} disabled={!cur} onClick={() => { disconnectVoice(); emit(); }} />
            </div>
            <div style={{ display: "flex", gap: 5, alignItems: "center", flexWrap: "wrap" }}>
                <Tag color={K.orange}>{tx("SHIELD")}</Tag>
                <QChip label={tx("Hide camera")} color={K.blue} active={crashed} title={tx("Shows a frozen frame instead of your camera (Settings, Camera shield)")} onClick={() => crashCamera(!crashed)} />
                <QChip label={tx("Safe camera")} color={K.green} active={previousDevice !== null} title={tx("Swaps to your safe camera, click again to restore")} onClick={toggleSafeCamera} />
                <QChip label={tx("Panic")} color={K.red} title={`Runs: ${panicSummary()}`} onClick={panic} />
            </div>
            <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                <Tag color={K.amber}>{tx("PAUSE")}</Tag>
                {paused
                    ? <>
                        <span style={{ fontSize: 12, color: K.amber, fontWeight: 700 }}>{tx("Automation paused · {n} min left", { n: Math.ceil(left / 60000) })}</span>
                        <QChip label={tx("Resume now")} color={K.green} active onClick={() => resumeNow()} />
                    </>
                    : <>
                        <span style={{ fontSize: 11, color: K.mute }}>{tx("Stop all rules for")}</span>
                        <NumField value={mins} min={1} max={10080} width={54} onCommit={v => { settings.store.pauseMinutes = v; emit(); }} />
                        <span style={{ fontSize: 11, color: K.mute }}>{tx("min")}</span>
                        <QChip label={tx("Pause")} color={K.amber} onClick={() => pauseFor(mins)} />
                    </>}
            </div>
        </div>
    );
}

function ActivityTab() {
    return (
        <Sec title={tx("Recent activity")} color={K.blue} hint={tx("Last 30 rule runs this session.")}>
            <div style={{ marginBottom: 5 }}>
                <Chip label={tx("Clear")} color={K.red} disabled={!activity.length} onClick={() => { activity.length = 0; stats.clear(); emit(); }} />
            </div>
            {activity.length === 0 && <div style={{ fontSize: 12, color: K.mute, fontStyle: "italic" }}>{tx("Nothing has run yet.")}</div>}
            {activity.map((x, i) => (
                <div key={`${x.t}_${i}`} style={{ display: "flex", gap: 8, padding: "3px 7px", marginBottom: 2, borderRadius: 6, background: K.card2 }}>
                    <span style={{ fontSize: 11, color: K.mute, width: 58, flexShrink: 0 }}>{ago(x.t)}</span>
                    <span style={{ fontSize: 12, color: K.text, fontWeight: 700 }}>{x.text}</span>
                </div>
            ))}
        </Sec>
    );
}

const SETTING_GROUPS: { title: string; color: string; rows: { key: BoolKey; label: string; hint: string; }[]; }[] = [
    {
        title: "Automation", color: K.accent, rows: [
            { key: "enabled", label: "Automation enabled", hint: "Master switch for every rule." },
            { key: "pauseWhenInvisible", label: "Pause while Invisible", hint: "Rules do nothing while your status is Invisible." },
            { key: "resetFakesOnLeave", label: "Reset fake states when I leave voice", hint: "Starts every call clean." },
            { key: "autoMute", label: "Auto mute when fake deafened", hint: "Fake deafen also fake mutes you." },
            { key: "stopFirst", label: "Stop/Off before On/Start", hint: "When a rule has both, Stop and Off run first. Turn off to run On/Start first." },
            { key: "keepFakes", label: "Remember fake states", hint: "Restores fake mute, deafen and camera after a restart." },
            { key: "collaborate", label: "Work with other fake plugins", hint: "Applies and mirrors FakeVoiceState and FakeMuteAndDeafen. Their buttons keep working." },
        ]
    },
    {
        title: "Interface", color: K.blue, rows: [
            { key: "showHeaderButton", label: "Header bar button", hint: "Icon shows ON, paused or OFF." },
            { key: "showUserAreaButton", label: "User area button", hint: "Bottom-left button. Off by default." },
            { key: "showActivity", label: "Activity tab and run counters", hint: "Records recent rule runs. Off by default." },
        ]
    },
    {
        title: "Notifications", color: K.amber, rows: [
            { key: "showToasts", label: "Toasts", hint: "Off by default." },
            { key: "enableLogs", label: "Console logs", hint: "Off by default." },
        ]
    },
];

function SettingsTab() {
    const [confirmReset, setConfirmReset] = React.useState(false);
    const [notice, setNotice] = React.useState("");
    React.useEffect(() => { if (!sourceList.length) void loadSources(); }, []);
    const srcOpts = [opt("", tx("Primary screen (automatic)")), ...sourceList.map(x => opt(x.id, `${tx(x.type === "screen" ? "Screen" : "Window")}: ${x.name}`))];
    if (srcChoice && !sourceList.some(x => x.id === srcChoice!.id)) srcOpts.push(opt(srcChoice.id, srcChoice.name));
    const devs = camDevices();
    return (
        <div>
            <Sec title={tx("Language")} color={K.accent}>
                <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                    <Chip label={tx("System (Discord language)")} active={settings.store.language === "system"} onClick={() => { settings.store.language = "system"; resolveSystemLang(); emit(); }} />
                    {LANGS.map(([id, name]) => <Chip key={id} label={name} active={settings.store.language === id} onClick={() => { settings.store.language = id; emit(); }} />)}
                </div>
            </Sec>
            {SETTING_GROUPS.map(g => (
                <Sec key={g.title} title={tx(g.title)} color={g.color}>
                    {g.rows.map(s => (
                        <Row key={s.key} label={tx(s.label)} hint={tx(s.hint)}>
                            <Toggle value={settings.store[s.key]} onChange={v => { settings.store[s.key] = v; emit(); }} />
                        </Row>
                    ))}
                </Sec>
            ))}
            <Sec title={tx("Screenshare source")} color={K.cyan} hint={tx("Used when a rule or button starts a screenshare.")}>
                <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", marginBottom: 4 }}>
                    <Dropdown width={330} value={srcChoice?.id ?? ""} options={srcOpts} onChange={pickSource} />
                    <Chip label={tx("Refresh list")} onClick={() => { void loadSources(); }} />
                </div>
            </Sec>
            <Sec title={tx("Camera shield")} color={K.pink} hint={tx("Hide your camera: shows a frozen frame instead of live video.")}>
                <Row label={tx("Camera hooking (advanced)")} hint={tx("Needed to hide the camera. Applies the next time your camera starts. Off means zero overhead.")}>
                    <Toggle value={!!settings.store.cameraHook} onChange={v => { settings.store.cameraHook = v; emit(); }} />
                </Row>
                <Cell label={tx("Safe camera")}>
                    <Dropdown width={320} value={settings.store.safeCamera} options={[opt("", tx("Automatic (a camera named virtual)")), ...devs.map(d => opt(String(d.name), String(d.name)))]} onChange={v => { settings.store.safeCamera = v; emit(); }} />
                </Cell>
                <Row label={tx("Safe camera fallback")} hint={tx("If the camera cannot be hooked, Hide swaps to the safe camera.")}>
                    <Toggle value={!!settings.store.cameraFallback} onChange={v => { settings.store.cameraFallback = v; emit(); }} />
                </Row>
                <Row label={tx("Release crash when the camera changes")} hint={tx("Turning the camera on or off, or changing channel, ends the hide.")}>
                    <Toggle value={!!settings.store.autoReleaseCrash} onChange={v => { settings.store.autoReleaseCrash = v; emit(); }} />
                </Row>
            </Sec>
            <Sec title={tx("Panic profile")} color={K.red} hint={tx("What the Panic chip, toolbox entry and the rule action do.")}>
                <Cell label={tx("Camera")}>
                    {([["none", "Leave it"], ["off", "Turn off"], ["hide", "Hide it"]] as [string, string][]).map(([id, label]) => <Chip key={id} label={tx(label)} color={K.red} active={settings.store.panicCamera === id} onClick={() => { settings.store.panicCamera = id; emit(); }} />)}
                </Cell>
                <Row label={tx("Stop the screenshare")}><Toggle value={!!settings.store.panicShare} onChange={v => { settings.store.panicShare = v; emit(); }} /></Row>
                <Row label={tx("Mute the microphone")}><Toggle value={!!settings.store.panicMute} onChange={v => { settings.store.panicMute = v; emit(); }} /></Row>
                <Row label={tx("Deafen the headset")}><Toggle value={!!settings.store.panicDeafen} onChange={v => { settings.store.panicDeafen = v; emit(); }} /></Row>
                <Row label={tx("Leave the voice channel")}><Toggle value={!!settings.store.panicLeave} onChange={v => { settings.store.panicLeave = v; emit(); }} /></Row>
                <div style={{ fontSize: 11, color: K.sub, marginTop: 4 }}>{tx("Panic runs: {what}", { what: panicSummary() })}</div>
            </Sec>
            <Sec title={tx("Backup")} color={K.green} hint={tx("JSON file with every rule and setting.")}>
                <div style={{ display: "flex", gap: 5, flexWrap: "wrap", alignItems: "center" }}>
                    <Chip label={tx("Export")} onClick={() => { exportBackup(); setNotice(tx("Backup downloaded")); }} />
                    <Chip label={tx("Import")} onClick={async () => { const m = await importBackup("add"); if (m) setNotice(m); }} />
                    <Chip label={tx("Import & replace")} color={K.amber} onClick={async () => { const m = await importBackup("replace"); if (m) setNotice(m); }} />
                    {notice && <span style={{ fontSize: 11, color: K.sub, fontWeight: 700 }}>{notice}</span>}
                </div>
            </Sec>
            <Sec title={tx("Reset all data")} color={K.red} hint={tx("Deletes every rule and the saved screenshare source.")}>
                {confirmReset
                    ? <div style={{ display: "flex", gap: 5, alignItems: "center" }}>
                        <span style={{ fontSize: 11, color: K.red }}>{tx("Delete ALL rules?")}</span>
                        <Chip label={tx("Yes, delete")} color={K.red} active onClick={() => { rules = []; keybinds = []; commitKb(); srcChoice = null; ran.clear(); stats.clear(); activity.length = 0; void DataStore.del(SRC_KEY); commit(); flush(); setConfirmReset(false); }} />
                        <Chip label={tx("Cancel")} color={K.mute} onClick={() => setConfirmReset(false)} />
                    </div>
                    : <Chip label={tx("Reset all")} color={K.red} onClick={() => setConfirmReset(true)} />}
            </Sec>
        </div>
    );
}

const HELP: [string, string][] = [
    ["Rules", "Each rule says WHEN it runs, WHERE, for WHO, under which conditions, and WHAT to do. The framed sentence at the top of the editor rewrites it in plain words and lists warnings."],
    ["Fake vs real", "Fake states change only what others see. Real states change your actual mute, deafen, camera and screenshare. You can combine them: others see a state as ON if either the fake or the real one is on, and a fake Off cannot hide a real On."],
    ["Where", "Add as many servers and voice channels as you want. A rule runs in any of them. Empty means everywhere."],
    ["Real screenshare", "Start shares your primary screen automatically, or the screen or window you choose in Settings. Stop ends the active stream. No manual sharing needed first."],
    ["Pause", "Pause stops all rules for the minutes you choose, then resumes by itself. Pause while Invisible is optional and off by default."],
    ["IDs", "Paste one or many IDs, then Enter. Click an ID to edit it. Names are resolved automatically."],
    ["Order of actions", "A rule runs every Off, Stop, Unmute, Undeafen, Camera off, Release and Panic first, then every On, Start, Mute, Deafen, Crash, Camera on and Join. Example: real screenshare Stop plus fake stream On stops the real one, then starts the fake one. Swap the order from the rule or from Settings."],
    ["Camera shield", "Hide camera shows a frozen frame instead of your camera, Safe camera swaps to another camera. Camera hooking is off by default and only needed to hide the camera."],
    ["Panic profile", "Panic runs the actions you chose in Settings in one click. Use it from the Shield row, the toolbox, or as a rule action, for example when staff joins."],
    ["Toasts", "Show toast on a rule always shows when that rule runs. The global Toasts setting only controls toasts for buttons and toolbox actions. Errors always show."],
    ["Other fake plugins", "Voice Suite adds no buttons to Discord menus and works together with FakeVoiceState and similar plugins. The FAKE chips show the combined state of all of them, and turning one off in Voice Suite turns it off for the others too. Their own menu buttons keep working."],
    ["Global keybinds", "Keybinds work even when Discord is not focused. Each one runs an action: automation on or off, pause, a rule, a fake or real state, Panic and more. Toggle means the same key reverses it, Activate only means it never reverses. Everything is off by default. If another Discord client uses the same key, the first one owns it and the others follow it."],
    ["Performance", "No polling. Rules react to voice events only and the panel refreshes only when something changes."],
];

function HelpTab() {
    return (
        <div>
            {HELP.map(([ht, hd]) => (
                <Sec key={ht} title={tx(ht)} color={K.accent}>
                    <div style={{ fontSize: 12, color: K.sub, lineHeight: 1.5 }}>{tx(hd)}</div>
                </Sec>
            ))}
        </div>
    );
}

type KbAction = "automation" | "pause" | "ruleToggle" | "ruleRun" | "fakeMute" | "fakeDeafen" | "fakeCamera" | "fakeStream" | "ghost" | "resetFakes" | "mute" | "deafen" | "camera" | "share" | "crash" | "safeCam" | "panic" | "leave" | "open";
type KbMode = "toggle" | "on" | "off";

interface Keybind {
    id: string;
    name: string;
    enabled: boolean;
    accel: string;
    action: KbAction;
    mode: KbMode;
    ruleId: string;
}

const KB_KEY = "VoiceSuite_keybinds_v1";

const KB_ACTIONS: [KbAction, string, boolean][] = [
    ["automation", "Automation on/off", true],
    ["pause", "Pause automation", true],
    ["ruleToggle", "Enable or disable a rule", true],
    ["ruleRun", "Run a rule", false],
    ["fakeMute", "Fake mute", true],
    ["fakeDeafen", "Fake deafen", true],
    ["fakeCamera", "Fake camera", true],
    ["fakeStream", "Fake stream", true],
    ["ghost", "Ghost (fake mute + deafen)", true],
    ["resetFakes", "Reset all fake states", false],
    ["mute", "Real mute", true],
    ["deafen", "Real deafen", true],
    ["camera", "Real camera", true],
    ["share", "Real screenshare", true],
    ["crash", "Hide camera", true],
    ["safeCam", "Safe camera", true],
    ["panic", "Panic profile", false],
    ["leave", "Leave voice", false],
    ["open", "Open Voice Suite", false],
];

const KB_MODES: [KbMode, string, string][] = [
    ["toggle", "Toggle", "The same key switches it on and off."],
    ["on", "Activate only", "The key always turns it on and never reverses it."],
    ["off", "Deactivate only", "The key always turns it off."],
];

const KB_PRESETS: { name: string; action: KbAction; mode: KbMode; }[] = [
    { name: "Toggle automation", action: "automation", mode: "toggle" },
    { name: "Pause automation", action: "pause", mode: "toggle" },
    { name: "Panic", action: "panic", mode: "toggle" },
    { name: "Fake mute", action: "fakeMute", mode: "toggle" },
    { name: "Fake deafen", action: "fakeDeafen", mode: "toggle" },
    { name: "Fake camera", action: "fakeCamera", mode: "toggle" },
    { name: "Ghost", action: "ghost", mode: "toggle" },
    { name: "Real mute", action: "mute", mode: "toggle" },
    { name: "Real deafen", action: "deafen", mode: "toggle" },
    { name: "Screenshare", action: "share", mode: "toggle" },
    { name: "Reset fakes", action: "resetFakes", mode: "toggle" },
    { name: "Open Voice Suite", action: "open", mode: "toggle" },
];

let keybinds: Keybind[] = [];
let kbStatus: Record<string, string> = {};
let kbSyncTimer: ReturnType<typeof setTimeout> | null = null;
let kbSaveTimer: ReturnType<typeof setTimeout> | null = null;
let recordingId: string | null = null;
let kbAccelMap = new Map<string, Keybind[]>();

function normalizeKb(x: any): Keybind {
    const action = KB_ACTIONS.some(a => a[0] === x?.action) ? x.action as KbAction : "automation";
    const mode: KbMode = x?.mode === "on" || x?.mode === "off" ? x.mode : "toggle";
    return {
        id: typeof x?.id === "string" ? x.id : uid(),
        name: typeof x?.name === "string" && x.name ? x.name.slice(0, 40) : "Keybind",
        enabled: !!x?.enabled,
        accel: typeof x?.accel === "string" ? x.accel : "",
        action, mode,
        ruleId: typeof x?.ruleId === "string" ? x.ruleId : ""
    };
}

function nativeKb(): any {
    try {
        const h = (VencordNative as any).pluginHelpers;
        if (!h) return null;
        return h.VoiceSuite ?? h[Object.keys(h).find(k => /voice\s*suite/i.test(k)) ?? ""] ?? null;
    } catch {
        return null;
    }
}

async function syncKeybinds() {
    if (!pluginActive) return;
    const wanted = settings.store.keybindsEnabled
        ? [...new Set(keybinds.filter(k => k.enabled && k.accel).map(k => k.accel))]
        : [];
    for (const acc of nativeAccels()) if (!wanted.includes(acc)) dropNative(acc);
    const needRelay: string[] = [];
    for (const acc of wanted) {
        if (hasNative(acc)) continue;
        if (tryNative(acc, handleKeybind)) continue;
        needRelay.push(acc);
    }
    const status: Record<string, string> = {};
    const nat = nativeKb();
    if (nat) {
        const electronAccels = [...new Set(needRelay.map(toElectron))];
        try {
            if (electronAccels.length) {
                const raw = await nat.registerKeybinds(electronAccels);
                for (const acc of needRelay) {
                    const st = raw[toElectron(acc)];
                    if (st) status[acc] = st;
                }
            } else {
                await nat.unregisterKeybinds();
            }
        } catch { }
    }
    for (const acc of wanted) if (hasNative(acc)) status[acc] = "owned";
    kbStatus = status;
    emit();
}

function scheduleKbSync() {
    if (kbSyncTimer) clearTimeout(kbSyncTimer);
    kbSyncTimer = setTimeout(() => { kbSyncTimer = null; if (pluginActive) void syncKeybinds(); }, 200);
}

function commitKb() {
    if (kbSaveTimer) clearTimeout(kbSaveTimer);
    kbSaveTimer = setTimeout(() => { kbSaveTimer = null; void DataStore.set(KB_KEY, keybinds); }, 400);
    rebuildAccelMap();
    emit();
    scheduleKbSync();
}

function stopRecording(resync: boolean) {
    cancelRecording();
    const was = recordingId !== null;
    recordingId = null;
    if (resync && was) { emit(); scheduleKbSync(); }
}

async function startRecording(k: Keybind) {
    if (recordingId === k.id) return;
    stopRecording(false);
    const myId = k.id;
    recordingId = myId;
    kbStatus = {};
    dropAllNative();
    try { void nativeKb()?.unregisterKeybinds(); } catch { }
    emit();
    const acc = await recordAccelerator();
    if (recordingId !== myId) return;
    recordingId = null;
    if (acc) {
        k.accel = acc;
        commitKb();
    } else {
        emit();
        scheduleKbSync();
    }
}

function stopKeybinds() {
    stopRecording(false);
    if (kbSyncTimer) { clearTimeout(kbSyncTimer); kbSyncTimer = null; }
    if (kbSaveTimer) { clearTimeout(kbSaveTimer); kbSaveTimer = null; void DataStore.set(KB_KEY, keybinds); }
    dropAllNative();
    try { void nativeKb()?.unregisterKeybinds(); } catch { }
    keybinds = [];
    kbStatus = {};
    kbAccelMap = new Map();
}

const decide = (cur: boolean, mode: KbMode) => mode === "toggle" ? !cur : mode === "on";

function execKeybind(k: Keybind) {
    const eff = effectiveFake();
    const rule = rules.find(r => r.id === k.ruleId);
    switch (k.action) {
        case "automation": setEnabled(decide(!!settings.store.enabled, k.mode)); break;
        case "pause": {
            const paused = pausedUntil > Date.now();
            const want = decide(paused, k.mode);
            if (want && !paused) pauseFor(clampInt(settings.store.pauseMinutes, 1, 10080, 15));
            else if (!want && paused) resumeNow();
            break;
        }
        case "ruleToggle":
            if (!rule) { fail(tx("Rule not found")); break; }
            rule.enabled = decide(rule.enabled, k.mode);
            commit();
            notify(tx(rule.enabled ? "Rule enabled: {name}" : "Rule disabled: {name}", { name: rule.name }));
            break;
        case "ruleRun":
            if (rule) runRule(rule);
            else fail(tx("Rule not found"));
            break;
        case "fakeMute": setFake("selfMute", decide(eff.selfMute, k.mode)); break;
        case "fakeDeafen": setFake("selfDeaf", decide(eff.selfDeaf, k.mode)); break;
        case "fakeCamera": setFake("selfVideo", decide(eff.selfVideo, k.mode)); break;
        case "fakeStream": setFakeStream(decide(isFakeStreamOn(), k.mode)); break;
        case "ghost": {
            const on = decide(eff.selfMute && eff.selfDeaf, k.mode);
            setFakeCombo(on, on, eff.selfVideo);
            break;
        }
        case "resetFakes": resetFakes(); break;
        case "mute": setRealMute(decide(realState().mute, k.mode)); emit(); break;
        case "deafen": setRealDeaf(decide(realState().deaf, k.mode)); emit(); break;
        case "camera": setCamera(decide(realState().cam, k.mode)); break;
        case "share": {
            const on = hasActiveStream();
            const want = decide(on, k.mode);
            if (want && !on) void startRealStream();
            else if (!want && on) stopAnyStream();
            break;
        }
        case "crash": crashCamera(decide(crashed, k.mode)); break;
        case "safeCam": {
            const want = decide(previousDevice !== null, k.mode);
            if (want && previousDevice === null) switchCamera();
            else if (!want && previousDevice !== null) restoreCamera();
            break;
        }
        case "panic": panic(); break;
        case "leave": disconnectVoice(); emit(); break;
        case "open": openSuite(); break;
    }
}

function rebuildAccelMap() {
    const m = new Map<string, Keybind[]>();
    const add = (accel: string, k: Keybind) => {
        const arr = m.get(accel) ?? [];
        if (!arr.includes(k)) arr.push(k);
        m.set(accel, arr);
    };
    for (const k of keybinds) {
        if (!k.enabled || !k.accel) continue;
        add(k.accel, k);
        const e = toElectron(k.accel);
        if (e !== k.accel) add(e, k);
    }
    kbAccelMap = m;
}

function handleKeybind(accel: string) {
    if (!pluginActive || !settings.store.keybindsEnabled) return;
    const matches = kbAccelMap.get(accel);
    if (!matches) return;
    for (const k of matches) execKeybind(k);
}

function KeybindsTab() {
    const [confirmId, setConfirmId] = React.useState<string | null>(null);
    const nat = nativeKb();
    const counts = new Map<string, number>();
    for (const k of keybinds) if (k.enabled && k.accel) counts.set(k.accel, (counts.get(k.accel) ?? 0) + 1);
    const ruleOpts = rules.map(r => opt(r.id, r.name));
    const master = !!settings.store.keybindsEnabled;

    const add = (name: string, action: KbAction, mode: KbMode) => {
        keybinds.push({ id: uid(), name: tx(name), enabled: false, accel: "", action, mode, ruleId: "" });
        commitKb();
    };

    return (
        <div>
            <Sec title={tx("Global keybinds")} color={K.accent} hint={tx("Work even when Discord is not focused. Everything is off by default.")}>
                <Row label={tx("Enable keybinds")} hint={tx("Master switch. Nothing is registered while it is off.")}>
                    <Toggle value={master} onChange={v => { settings.store.keybindsEnabled = v; emit(); scheduleKbSync(); }} />
                </Row>
                {!nat && <div style={{ fontSize: 11, color: K.amber, marginTop: 4 }}>⚠ {tx("Native helper not found. Keep the plugin folder named VoiceSuite and restart Discord.")}</div>}
                <div style={{ fontSize: 11, color: K.mute, marginTop: 4 }}>{tx("If another Discord client uses the same key, both react: the first one owns the key and the others follow it.")}</div>
            </Sec>

            <Sec title={tx("Quick add")} color={K.pink} hint={tx("Adds a disabled keybind. Record its key, then turn it on.")}>
                <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                    {KB_PRESETS.map(p => <Chip key={p.name} label={tx(p.name)} color={K.pink} onClick={() => add(p.name, p.action, p.mode)} />)}
                    <Chip label={tx("+ Rule keybind")} color={K.green} onClick={() => add("Rule", "ruleToggle", "toggle")} />
                </div>
            </Sec>

            {keybinds.length === 0 && <div style={{ textAlign: "center", color: K.mute, fontSize: 12, padding: "10px 0" }}>{tx("No keybinds yet. Use Quick add above.")}</div>}

            {keybinds.map(k => {
                const act = KB_ACTIONS.find(a => a[0] === k.action) ?? KB_ACTIONS[0];
                const isRule = k.action === "ruleToggle" || k.action === "ruleRun";
                const rec = recordingId === k.id;
                const dup = k.accel ? counts.get(k.accel) ?? 0 : 0;
                let state = tx("Off");
                let color = K.mute;
                if (master && k.enabled) {
                    const st = k.accel ? kbStatus[k.accel] : undefined;
                    if (!k.accel) { state = tx("No key set"); color = K.amber; }
                    else if (st === "owned") { state = tx("Active (this client owns the key)"); color = K.green; }
                    else if (st === "linked") { state = tx("Active (following another client)"); color = K.blue; }
                    else if (st === "failed") { state = tx("Could not register this key"); color = K.red; }
                    else { state = tx("Not registered yet"); color = K.mute; }
                }
                return (
                    <div key={k.id} style={{ background: K.card, border: `1px solid ${k.enabled ? K.line : K.soft}`, borderRadius: 9, padding: "8px 10px", marginBottom: 6, opacity: k.enabled ? 1 : 0.75 }}>
                        <div style={{ display: "flex", gap: 7, alignItems: "center", marginBottom: 6 }}>
                            <div style={{ flex: 1 }}><TextField value={k.name} placeholder={tx("Keybind name")} onCommit={v => { k.name = v.slice(0, 40) || tx("Keybind"); commitKb(); }} /></div>
                            <Toggle value={k.enabled} onChange={v => { k.enabled = v; commitKb(); }} />
                        </div>
                        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "flex-start", marginBottom: 6 }}>
                            <Dropdown width={240} value={k.action} options={KB_ACTIONS.map(a => opt(a[0], tx(a[1])))} onChange={v => { k.action = v as KbAction; commitKb(); }} />
                            {isRule && <Dropdown width={210} value={k.ruleId} options={ruleOpts} disabled={!ruleOpts.length} placeholder={tx("Pick a rule…")} onChange={v => { k.ruleId = v; commitKb(); }} />}
                        </div>
                        {act[2] && (
                            <div style={{ marginBottom: 6 }}>
                                <div style={{ display: "flex", gap: 4, flexWrap: "wrap", alignItems: "center" }}>
                                    {KB_MODES.map(([id, label]) => <Chip key={id} label={tx(label)} color={K.accent} active={k.mode === id} onClick={() => { k.mode = id; commitKb(); }} />)}
                                </div>
                                <div style={{ fontSize: 10, color: K.mute, marginTop: 3 }}>{tx(KB_MODES.find(m => m[0] === k.mode)![2])}</div>
                            </div>
                        )}
                        <div style={{ display: "flex", gap: 5, flexWrap: "wrap", alignItems: "center" }}>
                            <span style={{ fontFamily: "monospace", fontSize: 12, fontWeight: 800, color: rec ? K.amber : K.text, background: K.input, border: `1px solid ${rec ? K.amber : K.line}`, borderRadius: 6, padding: "3px 9px", minWidth: 70, textAlign: "center" }}>
                                {rec ? tx("Press keys… (Esc to cancel)") : k.accel || "-"}
                            </span>
                            <Chip label={tx("Record")} color={K.amber} active={rec} onClick={() => { if (rec) stopRecording(true); else void startRecording(k); }} />
                            <Chip label={tx("Clear key")} color={K.mute} disabled={!k.accel} onClick={() => { k.accel = ""; commitKb(); }} />
                            <span style={{ fontSize: 11, color, fontWeight: 700 }}>{state}</span>
                            {dup > 1 && <span style={{ fontSize: 11, color: K.amber }}>⚠ {tx("Same key used by {n} keybinds", { n: dup })}</span>}
                            <div style={{ flex: 1 }} />
                            {confirmId === k.id
                                ? <>
                                    <Chip label={tx("Confirm delete")} color={K.red} active onClick={() => { keybinds = keybinds.filter(x => x.id !== k.id); setConfirmId(null); commitKb(); }} />
                                    <Chip label={tx("Cancel")} color={K.mute} onClick={() => setConfirmId(null)} />
                                </>
                                : <Chip label={tx("Delete")} color={K.red} onClick={() => setConfirmId(k.id)} />}
                        </div>
                    </div>
                );
            })}
        </div>
    );
}

function SuiteModal({ modalProps }: { modalProps: ModalProps; }) {
    const forceUpdate = useForceUpdater();
    const [tab, setTab] = React.useState<TabId>("rules");
    const [editId, setEditId] = React.useState<string | null>(null);

    React.useEffect(() => subscribe(forceUpdate), []);

    const st = autoState();
    const editing = editId ? rules.find(r => r.id === editId) ?? null : null;
    const tabs: [TabId, string, string][] = [["rules", "Rules", K.green], ["keybinds", "Keybinds", K.amber]];
    if (settings.store.showActivity) tabs.push(["activity", "Activity", K.blue]);
    tabs.push(["settings", "Settings", K.cyan], ["help", "Help", K.pink]);
    const cur = tabs.some(t => t[0] === tab) ? tab : "rules";
    const stLabel = tx(st === "on" ? "AUTOMATION ON" : st === "paused" ? "PAUSED" : "AUTOMATION OFF");
    const stColor = st === "on" ? K.green : st === "paused" ? K.amber : K.red;

    return (
        <ModalRoot {...modalProps} size={ModalSize.LARGE}>
            <ModalHeader>
                <div style={{ display: "flex", alignItems: "center", gap: 9, width: "100%" }}>
                    <div style={{ color: K.accent, display: "flex" }}><Glyph state={st} width={26} height={26} /></div>
                    <div style={{ flex: 1, fontSize: 18, fontWeight: 900, color: K.accent }}>Voice Suite</div>
                    <span style={{ fontSize: 11, color: stColor, fontWeight: 800 }}>{stLabel}</span>
                    <Toggle value={settings.store.enabled} onChange={setEnabled} />
                </div>
            </ModalHeader>
            <ModalContent style={{ background: K.bg, padding: "10px 14px", maxHeight: "68vh", overflowY: "auto" }}>
                <QuickBar />
                <div style={{ display: "flex", gap: 6, marginBottom: 9, flexWrap: "wrap" }}>
                    {tabs.map(([id, label, col]) => (
                        <Chip key={id} big tint color={col} label={tx(label)} active={cur === id} onClick={() => { setTab(id); setEditId(null); }} />
                    ))}
                </div>
                {cur === "rules" && (editing
                    ? <RuleEditor rule={editing} onBack={() => setEditId(null)} />
                    : <RulesList onEdit={setEditId} />)}
                {cur === "keybinds" && <KeybindsTab />}
                {cur === "activity" && <ActivityTab />}
                {cur === "settings" && <SettingsTab />}
                {cur === "help" && <HelpTab />}
            </ModalContent>
            <ModalFooter>
                <div style={{ display: "flex", alignItems: "center", gap: 10, width: "100%" }}>
                    <span style={{ flex: 1, fontSize: 11, color: K.mute }}>
                        {tx(rules.length === 1 ? "{n} rule · {a} active" : "{n} rules · {a} active", { n: rules.length, a: compiled.length })}
                    </span>
                    <Chip label={tx("Close")} onClick={modalProps.onClose} />
                </div>
            </ModalFooter>
        </ModalRoot>
    );
}

export default definePlugin({
    name: "Voice Suite",
    description: "Voice automation suite with built-in fake voice state. Build rules for several servers and channels that react when you join or leave voice, when your screenshare starts or stops, or when anyone, the owner, friends, roles, permissions or chosen users join or leave your call. Actions: fake or real mute, deafen, camera and screenshare, hide camera, disconnect, or join a channel already fake. Delays, cooldowns, undo timers, hours, custom pause, presets and file backup included.",
    authors: [{ name: "zfrancesck1", id: 456195985404592149n }],
    tags: ["Voice", "Privacy", "Utility"],
    enabledByDefault: false,
    settings,
    dependencies: ["UserAreaAPI"],

    headerBarButton: {
        icon: IconOn,
        render: SuiteHeaderButton,
        priority: 5
    },

    toolboxActions: {
        "Open Voice Suite"() {
            openSuite();
        },
    },

    flux: {
        VOICE_STATE_UPDATES({ voiceStates }: { voiceStates: VoiceState[]; }) {
            onVoiceStates(voiceStates);
        },
        MEDIA_ENGINE_SET_GO_LIVE_SOURCE: onGoLiveSource,
        STREAM_CREATE({ streamKey }: { streamKey?: string; }) {
            onStream("stream_start", streamKey);
        },
        STREAM_DELETE({ streamKey }: { streamKey?: string; }) {
            onStream("stream_stop", streamKey);
        },
        I18N_LOAD_SUCCESS() {
            resolveSystemLang();
            emit();
        },
        CONNECTION_OPEN() {
            ensureHook();
        },
        MEDIA_ENGINE_SET_VIDEO_ENABLED: onVideoToggle,
        VOICE_CHANNEL_SELECT: onVideoToggle,
        SELF_PRESENCE_STORE_UPDATE() {
            if (settings.store.pauseWhenInvisible) emit();
        }
    },

    onKeybind(accel: string) {
        handleKeybind(accel);
    },

    modifyVoiceState(e: any) {
        patchSeen = true;
        hookWarn = false;
        for (const key of StateKeys) {
            e[key] = fake[key] || e[key];
        }
        return e;
    },

    patches: [
        {
            find: "voiceServerPing(){",
            predicate: () => !((Settings as any).plugins?.["Voice Suite"]?.collaborate !== false && knownFakeEnabled()),
            replacement: [
                {
                    match: /voiceStateUpdate\((\w+)\){/,
                    replace: "voiceStateUpdate($1){$1=$self.modifyVoiceState($1);"
                }
            ]
        }
    ],

    async start() {
        pluginActive = true;
        resolveSystemLang();
        const stored = (await DataStore.get<any[]>(STORE_KEY)) ?? (await DataStore.get<any[]>(OLD_STORE));
        rules = Array.isArray(stored) ? stored.map(normalize) : [];
        const kbStored = await DataStore.get<any[]>(KB_KEY);
        keybinds = Array.isArray(kbStored) ? kbStored.map(normalizeKb) : [];
        rebuildAccelMap();
        const rawSrc: any = (await DataStore.get(SRC_KEY)) ?? (await DataStore.get(OLD_SRC)) ?? null;
        const sid = rawSrc?.id ?? rawSrc?.desktopSettings?.sourceId;
        srcChoice = sid ? { id: String(sid), name: String(rawSrc?.name ?? rawSrc?.desktopSettings?.sourceName ?? sid) } : null;
        if (!pluginActive) return;
        // Migration: rimuove vecchia impostazione crashMode se presente
        if ((settings.store as any).crashMode) delete (settings.store as any).crashMode;
        // Migration: panicCamera "crash" -> "hide"
        if ((settings.store as any).panicCamera === "crash") settings.store.panicCamera = "hide";
        rebuild();
        patchSeen = false;
        hookWarn = false;
        ensureHook();
        wrapExternals();
        if (settings.store.keybindsEnabled) scheduleKbSync();
        if (settings.store.cameraHook) installCapture();
        if (settings.store.keepFakes) {
            const f: any = await DataStore.get(FAKE_KEY);
            if (f && pluginActive) { fake._selfMute = !!f.m; fake.selfDeaf = !!f.d; fake.selfVideo = !!f.v; }
        }
        trackedChannel = SelectedChannelStore.getVoiceChannelId() ?? null;
        joinPending = false;
        try { Vencord.Api.UserArea.removeUserAreaButton("voice-suite"); } catch { }
        Vencord.Api.UserArea.addUserAreaButton("voice-suite", () => <SuiteUserAreaButton />);
        delayed(() => {
            if (!isActive()) return;
            const me = UserStore.getCurrentUser()?.id;
            for (const c of compiled) if (c.rule.trigger === "startup") schedule(c, trackedChannel ?? "", me ?? "");
            if (trackedChannel && me) scanPresent(trackedChannel, me);
        }, 2500);
    },

    stop() {
        pluginActive = false;
        pausedUntil = 0;
        pauseTimer = null;
        for (const t of timers) clearTimeout(t);
        timers.clear();
        flush();
        unhook();
        unwrapExternals();
        stopKeybinds();
        uninstallCapture();
        if (previousDevice !== null) restoreCamera();
        crashed = false;
        if (fakeSaveTimer) { clearTimeout(fakeSaveTimer); fakeSaveTimer = null; }
        conflictCache = null;
        if (modalKey) { try { closeModal(modalKey); } catch { } modalKey = null; }
        try { Vencord.Api.UserArea.removeUserAreaButton("voice-suite"); } catch { }
        if (isFakeStreamOn()) {
            isFakeStreamActive = false;
            sendFakeStreamState();
        }
        isFakeStreamActive = false;
        fake.selfMute = false;
        fake.selfDeaf = false;
        fake.selfVideo = false;
        emitNow();
        listeners.clear();
        rules = [];
        compiled = [];
        lastRun.clear();
        ran.clear();
        stats.clear();
        activity.length = 0;
        srcChoice = null;
        sourceList = [];
        trackedChannel = null;
        joinPending = false;
        guildCache = null;
    },
});