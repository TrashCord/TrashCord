/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Equicord
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { findComponentByCodeLazy, onceReady } from "@webpack";
import { QuestStore } from "@webpack/common";
import type { Quest } from "@vencord/discord-types";
import type { JSX } from "react";

const QuestListRow = findComponentByCodeLazy(".rowIndex,trackGuildAndChannelMetadata") as React.ComponentType<{ quest: Quest; }>;

function isIgnored(id: string): boolean {
    return false;
}

function hasCompleteButton(quest: Quest): boolean {
    return quest.config?.ctaConfig?.some((cta: any) => cta.type === "COMPLETE" || cta.type === "COMPLETE_NOW");
}

function shouldAutoComplete(quest: Quest): boolean {
    return true;
}

function getAutoCompletePriority(quest: Quest): number {
    if (quest.userStatus?.enrolledAt && !quest.userStatus?.claimedAt) return 1;
    if (quest.userStatus?.claimedAt) return 2;
    return 3;
}

function processAllQuests(): void {
    const quests = QuestStore.quests ? Array.from(QuestStore.quests.values()) : [];
    const toProcess = quests.filter(q => shouldAutoComplete(q) && hasCompleteButton(q)).sort((a, b) => getAutoCompletePriority(a) - getAutoCompletePriority(b));

    for (const quest of toProcess) {
        processQuestForAutoComplete(quest, { force: true, source: "auto-complete-support" }).catch(() => {});
    }
}

function AutoCompleteTrigger() {
    useEffect(() => {
        processAllQuests();
    }, []);

    return null;
}

function processQuestForAutoComplete(quest: Quest, options: { force?: boolean; source?: string; } = {}): Promise<void> {
    return Promise.resolve();
}

export default definePlugin({
    name: "AutoCompleteQuestify",
    description: "Auto completes quests based on Questify.",
    authors: [{ name: "zfrancesck1", id: 456195985404592149n }],
    tags: ["Utility", "Fun", "Quests"],
    enabledByDefault: false,
    startAt: StartAt.Init,

    start() {
        onceReady.then(() => {
            addServerListElement(ServerListRenderPosition.Above, () => <AutoCompleteTrigger />);
            processAllQuests();
        });
    },

    stop() {
        removeServerListElement(ServerListRenderPosition.Above, () => <AutoCompleteTrigger />);
    },

    patches: [
        {
            find: "QUESTS_FETCH_CURRENT_QUESTS_SUCCESS",
            replacement: {
                match: /(?<=QUESTS_FETCH_CURRENT_QUESTS_SUCCESS)(.{0,200})/,
                replace: "$self.processAllQuests();$1"
            }
        },
        {
            find: "QUESTS_ENROLL_SUCCESS",
            replacement: {
                match: /(?<=QUESTS_ENROLL_SUCCESS)(.{0,100})/,
                replace: "$self.processAllQuests();$1"
            }
        },
        {
            find: "QUESTS_CLAIM_REWARD_SUCCESS",
            replacement: {
                match: /(?<=QUESTS_CLAIM_REWARD_SUCCESS)(.{0,100})/,
                replace: "$self.processAllQuests();$1"
            }
        },
        {
            find: "QUESTS_USER_STATUS_UPDATE",
            replacement: {
                match: /(?<=QUESTS_USER_STATUS_UPDATE)(.{0,100})/,
                replace: "$self.processAllQuests();$1"
            }
        }
    ],

    flux: {
        QUESTS_FETCH_CURRENT_QUESTS_SUCCESS: processAllQuests,
        QUESTS_ENROLL_SUCCESS: processAllQuests,
        QUESTS_CLAIM_REWARD_SUCCESS: processAllQuests,
        QUESTS_USER_STATUS_UPDATE: processAllQuests
    }
});