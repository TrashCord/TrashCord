import { get as dsGet, del as dsDel, set as dsSet } from "@api/DataStore";
import { definePluginSettings } from "@api/Settings";
import { NavContextMenuPatchCallback } from "@api/ContextMenu";
import { Button } from "@components/Button";
import definePlugin, { OptionType, PluginNative } from "@utils/types";
import { Menu, Toasts } from "@webpack/common";
import { useEffect, useReducer } from "@webpack/common";

const Native = VencordNative.pluginHelpers["Pangram AI Checker"] as PluginNative<typeof import("./native")>;

interface ScoreResult {
    label: string;
    pct: number | null;
    pending?: boolean;
}

const STORE_KEY = "Pangram_scores";
const scores = new Map<string, ScoreResult>();
const listeners = new Set<() => void>();
const inflight = new Set<string>();
const queue: { id: string; text: string; manual: boolean; }[] = [];
let persistTimer: ReturnType<typeof setTimeout> | null = null;

function notify() {
    for (const fn of listeners) fn();
}

function persistScores() {
    if (persistTimer) return;
    persistTimer = setTimeout(() => {
        persistTimer = null;
        const obj: Record<string, ScoreResult> = {};
        for (const [k, v] of scores) if (!v.pending) obj[k] = v;
        dsSet(STORE_KEY, obj);
    }, 2000);
}

async function loadScores() {
    const saved = await dsGet<Record<string, ScoreResult>>(STORE_KEY);
    if (saved) for (const [k, v] of Object.entries(saved)) scores.set(k, v);
}

function setScore(id: string, result: ScoreResult) {
    scores.set(id, result);
    if (!result.pending) persistScores();
    notify();
}

function wordCount(s: string): number {
    const t = s.trim();
    return t ? t.split(/\s+/).length : 0;
}

async function scorePangram(text: string, apiKey: string): Promise<ScoreResult> {
    const res = await Native.scorePangram(text, apiKey);
    if ("error" in res) throw new Error(res.error);
    return { label: res.label!, pct: res.pct! };
}

async function scoreCustom(text: string, url: string): Promise<ScoreResult> {
    const res = await Native.scoreCustom(text, url);
    if ("error" in res) throw new Error(res.error);
    return { label: res.label!, pct: res.pct! };
}

function processQueue() {
    while (inflight.size < 3 && queue.length > 0) {
        const item = queue.shift()!;
        if (scores.has(item.id) && !scores.get(item.id)!.pending) continue;
        runScore(item.id, item.text, item.manual);
    }
}

async function runScore(id: string, text: string, manual: boolean) {
    inflight.add(id);
    try {
        const s = settings.store;
        if (s.scorer === "pangram" && !s.apiKey)
            throw new Error("No API key — set it in plugin settings");
        const result = s.scorer === "custom"
            ? await scoreCustom(text, s.customUrl)
            : await scorePangram(text, s.apiKey);
        setScore(id, result);
        if (manual) {
            const emoji = result.label === "AI" ? "\u{1F916} " : result.label === "Human" ? "\u{1F9D1} " : "";
            Toasts.show({
                message: `${emoji}${result.label}${result.pct != null ? ` · ${result.pct}% AI` : ""}`,
                type: result.label === "AI" ? Toasts.Type.FAILURE : result.label === "Human" ? Toasts.Type.SUCCESS : Toasts.Type.MESSAGE,
                id: Toasts.genId(),
            });
        }
    } catch (e: any) {
        console.error("[Pangram]", e);
        setScore(id, { label: "?", pct: null });
        if (manual)
            Toasts.show({ message: `Pangram: ${e.message}`, type: Toasts.Type.FAILURE, id: Toasts.genId() });
    } finally {
        inflight.delete(id);
        processQueue();
    }
}

function enqueueScore(id: string, text: string, manual: boolean) {
    if (scores.get(id)?.pending) return;
    setScore(id, { label: "?", pct: null, pending: true });
    if (inflight.size >= 3) queue.push({ id, text, manual });
    else runScore(id, text, manual);
}

const settings = definePluginSettings({
    scorer: {
        description: "",
        type: OptionType.SELECT,
        options: [
            { label: "Pangram API", value: "pangram", default: true },
            { label: "Custom Endpoint", value: "custom" },
        ],
    },
    apiKey: {
        description: "Pangram API Key",
        type: OptionType.STRING,
        default: "",
        disabled: () => settings.store.scorer !== "pangram",
    },
    customUrl: {
        description: "Custom scorer URL — any endpoint that accepts POST {text} and returns {label, score}",
        type: OptionType.STRING,
        default: "",
        disabled: () => settings.store.scorer !== "custom",
    },
    minWords: {
        description: "Minimum word count for auto-scan",
        type: OptionType.SLIDER,
        default: 50,
        markers: [50, 100, 150, 200],
        stickToMarkers: false,
    },
    autoMode: {
        description: "Automatically scan all messages above threshold",
        type: OptionType.BOOLEAN,
        default: false,
    },
    skipBots: {
        description: "Skip bot messages",
        type: OptionType.BOOLEAN,
        default: true,
    },
    clearCache: {
        description: "Clear all cached scores",
        type: OptionType.COMPONENT,
        component: () => {
            const [count, setCount] = useReducer(() => scores.size, scores.size);
            useEffect(() => { listeners.add(setCount); return () => { listeners.delete(setCount); }; }, []);
            return <Button size="small" variant="secondary" onClick={() => {
                scores.clear();
                dsDel(STORE_KEY);
                notify();
                Toasts.show({ message: "Cache cleared", type: Toasts.Type.SUCCESS, id: Toasts.genId() });
            }}>
                Clear Cache ({count} entries)
            </Button>;
        },
    },
});

const messageContextMenuPatch: NavContextMenuPatchCallback = (children, props: any) => {
    const message = props?.message;
    if (!message) return;
    const text: string = message.content || "";
    const tooShort = wordCount(text) < 50;
    const existing = scores.get(message.id);

    children.push(
        <Menu.MenuSeparator key="pangram-sep" />,
        <Menu.MenuItem
            id="pangram-check"
            key="pangram-check"
            label={
                tooShort ? "Check for AI (too short)"
                    : existing?.pending ? "Checking for AI…"
                        : existing && existing.label !== "?" ? `Re-check for AI (${existing.label})`
                            : "Check for AI"
            }
            disabled={tooShort || existing?.pending}
            action={() => {
                scores.delete(message.id);
                enqueueScore(message.id, text, true);
            }}
        />,
    );
};

const COLORS: Record<string, { bg: string; color: string; }> = {
    AI: { bg: "#fdd8d8", color: "#a00000" },
    Human: { bg: "#d8f0d8", color: "#006600" },
    Mixed: { bg: "#fdeecb", color: "#946200" },
};
const GRAY = { bg: "#e8e8e8", color: "#555" };

function PangramBadge({ message }: { message: any; }) {
    const [, forceUpdate] = useReducer((x: number) => x + 1, 0);
    useEffect(() => { listeners.add(forceUpdate); return () => { listeners.delete(forceUpdate); }; }, []);

    useEffect(() => {
        if (!settings.store.autoMode) return;
        if (settings.store.skipBots && message.author?.bot) return;
        if (wordCount(message.content || "") < settings.store.minWords) return;
        if (scores.has(message.id)) return;
        enqueueScore(message.id, message.content, false);
    }, [message.id]);

    const result = scores.get(message.id);
    if (!result) return null;

    const c = COLORS[result.label] || GRAY;
    const emoji = result.pending ? "⏳ " : result.label === "AI" ? "\u{1F916} " : result.label === "Human" ? "\u{1F9D1} " : "";
    const text = result.pending
        ? "⏳ Checking for AI…"
        : `${emoji}${result.label}${result.pct != null ? ` · ${result.pct}% AI` : ""}`;

    return (
        <span style={{
            display: "inline-block", width: "fit-content", marginTop: 4,
            padding: "0 6px", borderRadius: 9, fontSize: 11, fontWeight: 700,
            background: c.bg, color: c.color, lineHeight: "18px",
        }}>
            {text}
        </span>
    );
}

export default definePlugin({
    name: "Pangram AI Checker",
    description: "Detect AI-generated messages. Right-click any message to check.",
    authors: [{ name: "djh_000", id: 269640387566501889n }],
    tags: ["Chat", "Utility"],
    enabledByDefault: false,
    settings,
    contextMenus: {
        "message": messageContextMenuPatch,
    },

    renderMessageAccessory(props: any) {
        return <PangramBadge message={props.message} />;
    },

    flux: {
        MESSAGE_CREATE({ message }: any) {
            if (!settings.store.autoMode) return;
            if (settings.store.skipBots && message.author?.bot) return;
            if (wordCount(message.content || "") < settings.store.minWords) return;
            if (scores.has(message.id)) return;
            enqueueScore(message.id, message.content, false);
        },
    },

    async start() {
        await loadScores();
    },
    stop() {
        if (persistTimer) { clearTimeout(persistTimer); persistTimer = null; }
        const obj: Record<string, ScoreResult> = {};
        for (const [k, v] of scores) if (!v.pending) obj[k] = v;
        dsSet(STORE_KEY, obj);
        scores.clear();
        queue.length = 0;
        inflight.clear();
        listeners.clear();
    },
});
