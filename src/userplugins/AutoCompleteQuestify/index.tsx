import { definePluginSettings } from "@api/Settings";
import definePlugin, { OptionType } from "@utils/types";
import { FluxDispatcher, QuestStore, RestAPI, showToast, Toasts } from "@webpack/common";
import type { Quest } from "@vencord/discord-types";
import { QuestTargetedContent } from "@vencord/discord-types/enums";

type QuestifyExposed = {
    processQuestForAutoComplete(quest: Quest, opts?: { force?: boolean; source?: string; }): boolean;
    canAutoCompleteQuest(quest: Quest): boolean;
    getActiveAutoCompletes(): readonly { questId: string; status: "queued" | "running"; }[];
    hasEnabledAutoCompleteQuestTypes(): boolean;
    rerenderQuests(): void;
};

function getQuestify(): QuestifyExposed | null {
    const g = globalThis as any;
    return (g.Vencord ?? g.Equicord)?.Plugins?.plugins?.Questify ?? null;
}

function snakeToCamel(o: any): any {
    if (Array.isArray(o)) return o.map(snakeToCamel);
    if (o && typeof o === "object") return Object.fromEntries(
        Object.entries(o).map(([k, v]) => [
            k.replace(/_([a-z])/g, (_: string, c: string) => c.toUpperCase()),
            snakeToCamel(v),
        ])
    );
    return o;
}

const settings = definePluginSettings({
    forceOverride: {
        type: OptionType.BOOLEAN,
        description: "Force-restart quests manually stopped this session. OFF = respects manual stops. ON = re-triggers on every event.",
        default: false,
    },
    autoEnroll: {
        type: OptionType.BOOLEAN,
        description: "Auto-enroll in unenrolled quests. Handles the full Complete → Complete Now chain automatically.",
        default: true,
    },
    requireEnabledTypes: {
        type: OptionType.BOOLEAN,
        description: "Skip if no auto-complete types are enabled in Questify Dangerous Settings.",
        default: true,
    },
    notifyOnTrigger: {
        type: OptionType.BOOLEAN,
        description: "Show a toast when auto-complete is triggered for a quest.",
        default: false,
    },
    excludedIds: {
        type: OptionType.STRING,
        description: "Quest IDs to never auto-complete, comma-separated. Get IDs via Questify right-click → Copy Quest ID.",
        default: "",
    },
});

function excluded(): Set<string> {
    const v: string = settings.store.excludedIds ?? "";
    return new Set(v.split(",").map((x: string) => x.trim()).filter(Boolean));
}

async function enroll(questId: string): Promise<boolean> {
    try {
        FluxDispatcher.dispatch({ type: "QUESTS_ENROLL_BEGIN", questId });
        const res = await RestAPI.post({
            url: `/quests/${questId}/enroll`,
            body: { location: QuestTargetedContent.QUEST_HOME_DESKTOP },
        });
        FluxDispatcher.dispatch({
            type: "QUESTS_ENROLL_SUCCESS",
            enrolledQuestUserStatus: snakeToCamel(res.body),
        });
        return true;
    } catch {
        FluxDispatcher.dispatch({ type: "QUESTS_ENROLL_FAILURE", questId });
        return false;
    }
}

let running = false;
let pending = false;
let warnedNoQuestify = false;

async function doRun(): Promise<void> {
    const qc = getQuestify();
    if (!qc) {
        if (!warnedNoQuestify) {
            warnedNoQuestify = true;
            showToast("AutoCompleteQuestify: Questify not found or not enabled!", Toasts.Type.FAILURE);
        }
        return;
    }
    warnedNoQuestify = false;

    if (settings.store.requireEnabledTypes && !qc.hasEnabledAutoCompleteQuestTypes?.()) return;

    const ex = excluded();
    const force: boolean = settings.store.forceOverride;
    const doEnroll: boolean = settings.store.autoEnroll;
    const notify: boolean = settings.store.notifyOnTrigger;

    const activeIds = new Set(
        (qc.getActiveAutoCompletes?.() ?? []).map(e => e.questId)
    );
    const quests = Array.from((QuestStore.quests as Map<string, Quest>).values());

    const hasNew = quests.some(
        q => !ex.has(q.id) && !activeIds.has(q.id) && qc.canAutoCompleteQuest(q)
    );
    if (!hasNew) return;

    let anyTriggered = false;

    for (const q of quests) {
        if (ex.has(q.id) || activeIds.has(q.id)) continue;
        if (!qc.canAutoCompleteQuest(q)) continue;

        if (!q.userStatus?.enrolledAt) {
            if (!doEnroll) continue;
            if (!await enroll(q.id)) continue;
        }

        const ok = qc.processQuestForAutoComplete(q, { force, source: "auto" });
        if (!ok) continue;

        anyTriggered = true;
        if (notify) {
            showToast(
                `AutoCompleteQuestify → ${q.config?.messages?.questName ?? q.id}`,
                Toasts.Type.SUCCESS,
            );
        }
    }

    if (anyTriggered) qc.rerenderQuests?.();
}

async function run(): Promise<void> {
    if (running) { pending = true; return; }
    do {
        pending = false;
        running = true;
        try { await doRun(); } catch { }
        running = false;
    } while (pending);
}

function schedule(): void { void run(); }

const onFetch         = () => schedule();
const onEnroll        = () => schedule();
const onHeartbeatFail = () => schedule();

export default definePlugin({
    name: "AutoCompleteQuestify",
    description: "Auto-triggers Questify auto-complete in background for all eligible quests. Requires Questify with quest types enabled in Dangerous Settings.",
    authors: [{ name: "zfrancesck1", id: 456195985404592149n }],
    tags: ["Utility", "Fun", "Quests"],
    enabledByDefault: false,
    settings,

    start() {
        FluxDispatcher.subscribe("QUESTS_FETCH_CURRENT_QUESTS_SUCCESS", onFetch);
        FluxDispatcher.subscribe("QUESTS_ENROLL_SUCCESS", onEnroll);
        FluxDispatcher.subscribe("QUESTS_SEND_HEARTBEAT_FAILURE", onHeartbeatFail);
        schedule();
    },

    stop() {
        FluxDispatcher.unsubscribe("QUESTS_FETCH_CURRENT_QUESTS_SUCCESS", onFetch);
        FluxDispatcher.unsubscribe("QUESTS_ENROLL_SUCCESS", onEnroll);
        FluxDispatcher.unsubscribe("QUESTS_SEND_HEARTBEAT_FAILURE", onHeartbeatFail);
        warnedNoQuestify = false;
        running = false;
        pending = false;
    },
});