import { HeaderBarButton } from "@api/HeaderBar";
import { definePluginSettings } from "@api/Settings";
import { getUserSettingLazy } from "@api/UserSettings";
import ErrorBoundary from "@components/ErrorBoundary";
import { Heading } from "@components/Heading";
import { Margins } from "@components/margins";
import { Paragraph } from "@components/Paragraph";
import { openPluginModal } from "@components/settings";
import definePlugin, { OptionType, type PluginNative } from "@utils/types";
import { findByCodeLazy } from "@webpack";
import { ApplicationStreamingSettingsStore, ApplicationStreamingStore, ChannelStore, ContextMenuApi, Menu, PermissionsBits, PermissionStore, SearchableSelect, SelectedChannelStore, showToast, useEffect, useState, useStateFromStores, UserStore, VoiceActions } from "@webpack/common";
import { bindKeybind, IDS, recordAccelerator, unbindKeybind } from "./keybind";

const Native = VencordNative.pluginHelpers.FastScreenshare as PluginNative<typeof import("./native")>;
const startStream = findByCodeLazy('type:"STREAM_START"');
const stopStream = findByCodeLazy('type:"STREAM_STOP"');
const StreamPreviewSettings = getUserSettingLazy("voiceAndVideo", "disableStreamPreviews")!;

type Slot = "main" | "backup";
type Source = { id: string; name: string; type: "screen" | "window"; };
type IconProps = { className?: string; width?: number | string; height?: number | string; color?: string; };

const MONITOR = "M3 4h18a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-6.5l.8 2H17a1 1 0 1 1 0 2H7a1 1 0 1 1 0-2h1.7l.8-2H3a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM3 6v10h18V6H3z";
const DANGER = "var(--status-danger, #f23f43)";

const ui = {
    row: { display: "flex", alignItems: "center", gap: 10, marginBottom: 8 },
    label: { flex: 1, fontWeight: 600, color: "var(--text-strong, var(--header-primary))" },
    key: { padding: "2px 8px", borderRadius: 4, color: "var(--text-default, var(--text-normal))", background: "var(--background-base-lower, var(--background-secondary))" },
    button: { padding: "4px 14px", border: 0, borderRadius: 6, cursor: "pointer", fontWeight: 500, color: "#fff", background: "var(--brand-500, #5865f2)" },
    sub: { marginTop: 4, fontSize: 12, color: "var(--text-subtle, var(--text-muted))" }
};

let onBackup = false;
let lastFire = 0;

function notify(message: string, type: string) {
    if (settings.store.toasts) showToast({ text: message, variant: type });
}

function fail(message: string) {
    notify(message, "failure");
}

function isStreaming() {
    return ApplicationStreamingStore.getCurrentUserActiveStream() != null;
}

function spammer(): any {
    try {
        return (Vencord.Plugins.plugins as any).ScreenshareSpammer;
    } catch {
        return undefined;
    }
}

function isSpamActive() {
    return spammer()?.isSpamming === true;
}

function useSpamActive() {
    const [, tick] = useState(0);
    useEffect(() => spammer()?.subscribe?.(() => tick(n => n + 1)), []);
    return isSpamActive();
}

async function loadSources(withWindows: boolean): Promise<Source[]> {
    try {
        const res: any[] = await DiscordNative.desktopCapture.getDesktopCaptureSources({
            types: withWindows ? ["screen", "window"] : ["screen"],
            thumbnailSize: { width: 1, height: 1 }
        });
        const all: Source[] = (res ?? []).map(x => ({
            id: String(x.id),
            name: String(x.name),
            type: String(x.id).startsWith("screen") ? "screen" : "window"
        }));
        return [...all.filter(s => s.type === "screen"), ...all.filter(s => s.type === "window")];
    } catch {
        return [];
    }
}

async function resolve(saved: Source | null, fallback: boolean) {
    const list = await loadSources(saved?.type === "window");
    const found = saved ? list.find(s => s.id === saved.id) ?? list.find(s => s.name === saved.name) : undefined;
    return found ?? (fallback ? list[0] ?? null : null);
}

function useSources() {
    const [sources, setSources] = useState<Source[] | null>(null);
    useEffect(() => {
        let alive = true;
        loadSources(true).then(list => { if (alive) setSources(list); });
        return () => { alive = false; };
    }, []);
    return sources;
}

function quality() {
    const s: any = ApplicationStreamingSettingsStore.getState();
    return { preset: s.preset ?? 2, resolution: s.resolution ?? 720, frameRate: s.fps > 0 ? s.fps : 60 };
}

function play(src: Source) {
    const channelId = SelectedChannelStore.getVoiceChannelId();
    if (!channelId) return fail("Join a voice channel first");

    const channel = ChannelStore.getChannel(channelId);
    if (!channel || channel.type === 13) return fail("Streaming is not available in this channel");
    if (!channel.isDM() && !channel.isGroupDM() && !PermissionStore.can(PermissionsBits.STREAM, channel)) {
        return fail("You do not have permission to stream here");
    }

    const sound = ApplicationStreamingSettingsStore.getState().soundshareEnabled;

    if (isStreaming()) {
        VoiceActions.setGoLiveSource({
            desktopSettings: { sourceId: src.id, type: src.type, sound },
            qualityOptions: quality(),
            context: "stream"
        });
        return;
    }

    startStream(channel.guild_id ?? null, channelId, {
        pid: null,
        sourceId: src.id,
        sourceName: src.name,
        audioSourceId: src.name,
        sound,
        previewDisabled: StreamPreviewSettings.getSetting()
    });
}

function stopCurrent() {
    const s: any = ApplicationStreamingStore.getCurrentUserActiveStream();
    if (!s) return;
    stopStream(s.guildId ? `guild:${s.guildId}:${s.channelId}:${s.ownerId}` : `call:${s.channelId}:${s.ownerId}`);
}

async function startMain() {
    const src = await resolve(settings.store.mainSource, true);
    if (!src) return fail("No screen source found");
    play(src);
}

function toggle() {
    if (isStreaming()) stopCurrent();
    else void startMain();
}

function mainKey() {
    if (!isStreaming()) void startMain();
    else if (settings.store.keybindStops) stopCurrent();
}

function playSound(toBackup: boolean) {
    if (!settings.store.backupSound) return;
    try {
        const ctx = new AudioContext({ sinkId: "communications" } as any);
        const run = () => {
            const t = ctx.currentTime;
            const [a, b] = toBackup ? [620, 930] : [930, 620];
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = "triangle";
            osc.frequency.setValueAtTime(a, t);
            osc.frequency.setValueAtTime(b, t + 0.09);
            gain.gain.setValueAtTime(0.0001, t);
            gain.gain.exponentialRampToValueAtTime(0.07, t + 0.012);
            gain.gain.setValueAtTime(0.07, t + 0.15);
            gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start(t);
            osc.stop(t + 0.21);
            osc.onended = () => ctx.close();
        };
        if (ctx.state === "suspended") ctx.resume().then(run).catch(() => ctx.close());
        else run();
    } catch { }
}

async function swap() {
    if (!isStreaming()) return;
    const toBackup = !onBackup;
    const src = toBackup
        ? await resolve(settings.store.backupSource, false)
        : await resolve(settings.store.mainSource, true);
    if (!src) return fail("Backup source not found. Pick one in the settings");
    onBackup = toBackup;
    playSound(toBackup);
    play(src);
}

function pickMain(src: Source) {
    settings.store.mainSource = src;
    onBackup = false;
    play(src);
}

function pickBackup(src: Source) {
    settings.store.backupSource = src;
}

const ids = { main: IDS.fssMain, backup: IDS.fssBackup } as const;
const relay = (slot: Slot) => ({ register: (a: string) => Native.register(slot, a), unregister: () => Native.register(slot, "") });

async function bind(slot: Slot, accelerator: string) {
    if (!(await bindKeybind(ids[slot], accelerator, () => plugin.onKeybind(slot), relay(slot))))
        fail("Keybind unavailable, pick another one");
}

function unbindAll() {
    void unbindKeybind(IDS.fssMain, relay("main"));
    void unbindKeybind(IDS.fssBackup, relay("backup"));
}

function syncKeys() {
    const { keybindEnabled, keybind, backupEnabled, backupKeybind } = settings.store;
    void bind("main", keybindEnabled ? keybind : "");
    void bind("backup", backupEnabled ? backupKeybind : "");
}

function scheduleSync() {
    queueMicrotask(syncKeys);
}

async function recordKeybind(slot: Slot) {
    unbindAll();
    notify("Press a key combo (Esc to cancel)", "clock");
    const acc = await recordAccelerator();
    if (!acc) { syncKeys(); return; }
    if (slot === "main") settings.store.keybind = acc;
    else settings.store.backupKeybind = acc;
    syncKeys();
    notify(`Keybind set to ${acc}`, "success");
}

function IconIdle({ className, width = 24, height = 24, color }: IconProps) {
    const fill = color ?? "currentColor";
    return (
        <svg className={className} width={width} height={height} viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path fill={fill} fillRule="evenodd" clipRule="evenodd" d={MONITOR} />
            <path fill={fill} d="M10 8.2v5.6a.6.6 0 0 0 .9.5l4.6-2.8a.6.6 0 0 0 0-1l-4.6-2.8a.6.6 0 0 0-.9.5z" />
        </svg>
    );
}

function IconLive({ className, width = 24, height = 24, color }: IconProps) {
    return (
        <svg className={className} width={width} height={height} viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path fill={color ?? "currentColor"} fillRule="evenodd" clipRule="evenodd" d={MONITOR} />
            <rect x="9" y="8" width="6" height="6" rx="1.2" fill={DANGER} />
        </svg>
    );
}

function sourceItems(list: Source[], prefix: string, pick: (s: Source) => void) {
    return list.map(s => (
        <Menu.MenuItem
            key={s.id}
            id={`${prefix}-${s.id}`}
            label={s.name}
            action={() => pick(s)}
        />
    ));
}

function SourceMenu() {
    const sources = useSources();
    const { backupEnabled, keybind, backupKeybind } = settings.use(["backupEnabled", "keybind", "backupKeybind"]);
    const streaming = isStreaming();
    const screens = sources?.filter(s => s.type === "screen") ?? [];
    const windows = sources?.filter(s => s.type === "window") ?? [];

    return (
        <Menu.Menu navId="fast-screenshare-menu" onClose={ContextMenuApi.closeContextMenu} aria-label="FastScreenshare">
            {streaming && <Menu.MenuItem id="fss-stop" label="Stop Stream" color="danger" action={stopCurrent} />}
            {streaming && backupEnabled && (
                <Menu.MenuItem id="fss-swap" label={onBackup ? "Back to Main Stream" : "Switch to Backup Stream"} action={() => void swap()} />
            )}
            <Menu.MenuGroup label="Screens">
                {sources
                    ? sourceItems(screens, "fss-m", pickMain)
                    : <Menu.MenuItem id="fss-loading" label="Loading..." disabled />}
            </Menu.MenuGroup>
            {windows.length > 0 && (
                <Menu.MenuItem id="fss-windows" label="Windows">
                    {sourceItems(windows, "fss-m", pickMain)}
                </Menu.MenuItem>
            )}
            {backupEnabled && sources && (
                <Menu.MenuItem id="fss-backup" label="Backup Source">
                    {sourceItems(sources, "fss-b", pickBackup)}
                </Menu.MenuItem>
            )}
            <Menu.MenuSeparator />
            <Menu.MenuItem id="fss-keybind" label={`Set Keybind (${keybind})`} action={() => recordKeybind("main")} />
            {backupEnabled && (
                <Menu.MenuItem id="fss-backup-keybind" label={`Set Backup Keybind (${backupKeybind})`} action={() => recordKeybind("backup")} />
            )}
            <Menu.MenuItem id="fss-settings" label="FastScreenshare Settings" action={() => openPluginModal(plugin)} />
        </Menu.Menu>
    );
}

function HeaderButton() {
    const { showButton, showWhileStreaming } = settings.use(["showButton", "showWhileStreaming"]);
    const streaming = useStateFromStores([ApplicationStreamingStore], isStreaming);
    const spamming = useSpamActive();

    if (!showButton || spamming || (streaming && !showWhileStreaming)) return null;

    return (
        <div style={{ display: "contents" }} onContextMenu={e => ContextMenuApi.openContextMenu(e, () => <SourceMenu />)}>
            <HeaderBarButton
                icon={streaming ? IconLive : IconIdle}
                tooltip={streaming ? "Stop Stream (right-click for sources)" : "Start Stream (right-click for sources)"}
                onClick={toggle}
            />
        </div>
    );
}

const HeaderButtonSafe = ErrorBoundary.wrap(HeaderButton, { noop: true });

function SourcePicker({ slot }: { slot: Slot; }) {
    const { mainSource, backupSource } = settings.use(["mainSource", "backupSource"]);
    const sources = useSources() ?? [];
    const current = slot === "main" ? mainSource : backupSource;
    const options = sources.map(s => ({ label: `${s.type === "screen" ? "Screen" : "Window"}: ${s.name}`, value: s.id }));
    if (current && !sources.some(s => s.id === current.id)) options.unshift({ label: current.name, value: current.id });

    return (
        <section>
            <Heading>{slot === "main" ? "Main source" : "Backup source"}</Heading>
            <Paragraph className={Margins.bottom8}>
                {slot === "main"
                    ? "Started by the button and the keybind. Falls back to the primary screen"
                    : "The source the backup keybind swaps to and back from"}
            </Paragraph>
            <SearchableSelect
                placeholder={slot === "main" ? "Primary screen (automatic)" : "Select a backup source"}
                maxVisibleItems={5}
                options={options}
                value={current?.id}
                onChange={(id: string) => {
                    const s = sources.find(x => x.id === id);
                    if (!s) return;
                    if (slot === "main") settings.store.mainSource = s;
                    else settings.store.backupSource = s;
                }}
                closeOnSelect
            />
        </section>
    );
}

function KeybindRow({ slot }: { slot: Slot; }) {
    const { keybind, backupKeybind } = settings.use(["keybind", "backupKeybind"]);
    return (
        <div>
            <div style={ui.row}>
                <div style={ui.label}>{slot === "main" ? "Keybind" : "Backup keybind"}</div>
                <code style={ui.key}>{slot === "main" ? keybind : backupKeybind}</code>
                <button type="button" style={ui.button} onClick={() => recordKeybind(slot)}>Record</button>
            </div>
            <div style={ui.sub}>
                Global keybind accelerator. Use 'Set Keybind' in the right-click menu to record it by pressing keys, or type one manually (e.g. Control+F3). Default only, empty = off. Windows official client: native, key passes through. CustomDiscordClient/macOS/Linux: TCP, key is captured (avoid in-game keys).
            </div>
        </div>
    );
}

function MainPicker() {
    return <SourcePicker slot="main" />;
}

function BackupPicker() {
    return <SourcePicker slot="backup" />;
}

function MainKeybind() {
    return <KeybindRow slot="main" />;
}

function BackupKeybind() {
    return <KeybindRow slot="backup" />;
}

export const settings = definePluginSettings({
    showButton: {
        type: OptionType.BOOLEAN,
        description: "Show the button in the header bar next to the toolbox",
        default: true
    },
    showWhileStreaming: {
        type: OptionType.BOOLEAN,
        description: "Keep the button visible while streaming (left click stops the stream)",
        default: true
    },
    mainPicker: {
        type: OptionType.COMPONENT,
        component: MainPicker
    },
    mainSource: {
        type: OptionType.CUSTOM,
        default: null as Source | null
    },
    keybindEnabled: {
        type: OptionType.BOOLEAN,
        description: "Start the stream with a global keybind (works even when Discord is not focused)",
        default: false,
        onChange: scheduleSync
    },
    keybindRecorder: {
        type: OptionType.COMPONENT,
        component: MainKeybind
    },
    keybind: {
        type: OptionType.STRING,
        description: "Use 'Set Keybind' in the right-click menu, or type it (e.g. Control+F3). Empty = off. Windows official client: native, key passes through. CustomDiscordClient/macOS/Linux: TCP, key is captured (avoid in-game keys).",
        default: "F9",
        hidden: true
    },
    keybindStops: {
        type: OptionType.BOOLEAN,
        description: "Use the same keybind to stop the stream",
        default: false
    },
    backupEnabled: {
        type: OptionType.BOOLEAN,
        description: "Enable the backup stream: a second keybind swaps to another source and back",
        default: false,
        onChange: scheduleSync
    },
    backupPicker: {
        type: OptionType.COMPONENT,
        component: BackupPicker,
        hidden() { return !this.store.backupEnabled; }
    },
    backupSource: {
        type: OptionType.CUSTOM,
        default: null as Source | null
    },
    backupKeybindRecorder: {
        type: OptionType.COMPONENT,
        component: BackupKeybind,
        hidden() { return !this.store.backupEnabled; }
    },
    backupKeybind: {
        type: OptionType.STRING,
        description: "Backup keybind accelerator",
        default: "Shift+F9",
        hidden: true
    },
    backupSound: {
        type: OptionType.BOOLEAN,
        description: "Play a sound when swapping to the backup stream and back",
        default: true,
        hidden() { return !this.store.backupEnabled; }
    },
    toasts: {
        type: OptionType.BOOLEAN,
        description: "Show toast notifications",
        default: false
    }
});

const plugin = definePlugin({
    name: "FastScreenshare",
    description: "Start your screenshare in one click or one keybind, pick any screen or window from a right-click menu, and swap to a backup source instantly.",
    authors: [{ name: "zfrancesck1", id: 456195985404592149n }],
    tags: ["Voice", "Media", "Utility"],
    enabledByDefault: false,
    searchTerms: ["InstantScreenshare", "QuickStream", "ScreenshareKeybind", "BackupStream"],
    settings,

    headerBarButton: {
        icon: IconIdle,
        render: HeaderButtonSafe,
        priority: 5
    },

    toolboxActions: {
        "Open FastScreenshare"() {
            openPluginModal(plugin);
        }
    },

    flux: {
        STREAM_DELETE({ streamKey }: { streamKey?: string; }) {
            if (isSpamActive()) return;
            if (streamKey?.endsWith(`:${UserStore.getCurrentUser()?.id}`)) onBackup = false;
        }
    },

    start() {
        syncKeys();
    },

    stop() {
        onBackup = false;
        unbindAll();
    },

    onKeybind(slot: Slot) {
        if (isSpamActive()) return;
        const now = Date.now();
        if (now - lastFire < 300) return;
        lastFire = now;
        if (slot === "backup") void swap();
        else mainKey();
    }
});

export default plugin;
