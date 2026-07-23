/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import managedStyle from "./components/QuestButton.css?managed";

import definePlugin from "@utils/types";
import { findByCodeLazy, findByPropsLazy } from "@webpack";
import { FluxDispatcher, RestAPI } from "@webpack/common";

import { QuestButton, QuestsCount } from "./components/QuestButton";
import settings from "./settings";
import { ChannelStore, GuildChannelStore, QuestsStore, RunningGameStore } from "./stores";

const QuestApplyAction = findByCodeLazy("type:\"QUESTS_ENROLL_BEGIN\"") as (questId: string, action: QuestAction) => Promise<any>;
const QuestLocationMap = findByPropsLazy("QUEST_HOME_DESKTOP", "11") as Record<string, any>;

let availableQuests: QuestValue[] = [];
let acceptableQuests: QuestValue[] = [];
let completableQuests: QuestValue[] = [];

const completingQuest = new Map();
const fakeGames = new Map();
const fakeApplications = new Map();
let cachedFakeGamesList: any[] | null = null;



function dbg(...args: unknown[]): void { if (settings.store.debugLogging) console.log(...args); }

const CONSENT_WARNING = `Important Notice\n\nAs of April 7th 2026, Discord has expressed their intent to crack down on automating quest completion.\n\nUse this plugin at your own risk, as you may get flagged by doing so.\n\nPress OK to keep using this plugin, or Cancel to keep automation disabled.`;

export default definePlugin({
    name: "CompleteDiscordQuest",
    description: "A plugin that completes multiple discord quests in background simultaneously.",
    authors: [{ name: "nicola02nb", id: 257900031351193600n  }, { name: "zfrancesck1", id: 456195985404592149n }],
    tags: ["Utility", "Fun", "Quests"],
    enabledByDefault: false,
    managedStyle,
    settings,
    patches: [
        {
            find: ".PlatformTypes.WEB",
            replacement: {
                match: /(\((\i)\){)(let{leading)/,
                replace: "$1$2?.trailing?.props?.children?.unshift($self.renderQuestButtonTopBar());$3"
            }
        },
        {
            find: "accountContainerRef:",
            replacement: {
                match: /className:\i\.Uo,style:\i,children:\[/,
                replace: "$&$self.renderQuestButtonSettingsBar(),"
            }
        },
        {
            find: "\"innerRef\",\"navigate\",\"onClick\"",
            replacement: {
                match: /(\i).createElement\("a",(\i)\)/,
                replace: "$1.createElement(\"a\",$self.renderQuestButtonBadges($2))"
            }
        },
        {
            find: "\"RunningGameStore\"",
            group: true,
            replacement: [
                {
                    match: /}getRunningGames\(\){return/,
                    replace: "}getRunningGames(){const games=$self.getRunningGames();return games ? games : "
                },
                {
                    match: /}getGameForPID\((\i)\){/,
                    replace: "}getGameForPID($1){const pid=$self.getGameForPID($1);if(pid){return pid;}"
                }
            ]
        },
        {
            find: "ApplicationStreamingStore",
            replacement: {
                match: /}getStreamerActiveStreamMetadata\(\){/,
                replace: "}getStreamerActiveStreamMetadata(){const metadata=$self.getStreamerActiveStreamMetadata();if(metadata){return metadata;}"
            }
        }
    ],
    start: () => {
        if (!ensureHasAcceptedToUsePlugin()) {
            stopAllFarming();
            return;
        }

        QuestsStore.addChangeListener(updateQuests);
        updateQuests();
    },
    stop: () => {
        QuestsStore.removeChangeListener(updateQuests);
        stopAllFarming();
    },

    renderQuestButtonTopBar() {
        if (settings.store.showQuestsButtonTopBar) {
            return <QuestButton type="top-bar" />;
        }
    },

    renderQuestButtonSettingsBar() {
        if (settings.store.showQuestsButtonSettingsBar) {
            return <QuestButton type="settings-bar" />;
        }
    },

    renderQuestButtonBadges(questButton) {
        if (settings.store.showQuestsButtonBadges && typeof questButton === "string" && questButton === "quests") {
            return (<QuestsCount />);
        }
        if (settings.store.showQuestsButtonBadges && questButton?.href?.startsWith("/quest-home")
            && Array.isArray(questButton?.children) && !questButton.children.some(child => child?.type === QuestsCount)) {
            questButton.children.push(<QuestsCount />);
        }
        return questButton;
    },

    getRunningGames() {
        if (fakeGames.size > 0) {
            if (!cachedFakeGamesList) cachedFakeGamesList = Array.from(fakeGames.values());
            return cachedFakeGamesList;
        }
    },

    getGameForPID(pid) {
        if (fakeGames.size > 0) {
            for (const game of fakeGames.values()) {
                if (game.pid === pid) return game;
            }
        }
    },

    getStreamerActiveStreamMetadata() {
        if (fakeApplications.size > 0) {
            return fakeApplications.values().next().value;
        }
    }
});

function isQuestEligibleForFarming(quest: QuestValue): boolean {
    const tasks = (quest.config.taskConfig || quest.config.taskConfigV2).tasks;
    if (!((tasks.WATCH_VIDEO != null && settings.store.farmVideos)
        || (tasks.WATCH_VIDEO_ON_MOBILE != null && settings.store.farmVideos)
        || (tasks.PLAY_ON_DESKTOP != null && settings.store.farmPlayOnDesktop)
        || (tasks.STREAM_ON_DESKTOP != null && settings.store.farmStreamOnDesktop)
        || (tasks.PLAY_ACTIVITY != null && settings.store.farmPlayActivity))) return false;

    const rewards = quest.config?.rewardsConfig?.rewards;
    if (!Array.isArray(rewards) || rewards.length === 0) return false;
    return rewards.some(reward =>
        (reward.type === 1 && settings.store.farmRewardCodes)
        || (reward.type === 2 && settings.store.farmInGame)
        || (reward.type === 3 && settings.store.farmCollectibles)
        || (reward.type === 4 && settings.store.farmVirtualCurrency)
        || (reward.type === 5 && settings.store.farmFractionalPremium)
    );
}

function ensureHasAcceptedToUsePlugin(): boolean {
    if (settings.store.hasAcceptedToUsePlugin === true) {
        return true;
    }

    const accepted = window.confirm(CONSENT_WARNING);
    settings.store.hasAcceptedToUsePlugin = accepted;

    if (!accepted) {
        dbg("Consent not accepted. Quest completion is disabled.");
    }

    return accepted;
}

function updateQuests() {
    if (!settings.store.hasAcceptedToUsePlugin) {
        stopAllFarming();
        return;
    }

    const now = Date.now();
    availableQuests = [];
    acceptableQuests = [];
    completableQuests = [];

    for (const quest of QuestsStore.quests.values()) {
        availableQuests.push(quest);
        if (new Date(quest.config.expiresAt).getTime() <= now) continue;
        if (quest.userStatus?.enrolledAt == null) {
            acceptableQuests.push(quest);
        } else if (!quest.userStatus?.completedAt) {
            completableQuests.push(quest);
        }
    }

    for (const quest of acceptableQuests) {
        if (isQuestEligibleForFarming(quest)) acceptQuest(quest);
    }
    for (const quest of completableQuests) {
        if (completingQuest.has(quest.id)) {
            if (completingQuest.get(quest.id) === false) completingQuest.delete(quest.id);
        } else {
            completeQuest(quest);
        }
    }
}

function acceptQuest(quest: QuestValue) {
    if (!settings.store.acceptQuestsAutomatically) return;
    dbg("Accepting quest:", quest.config.messages.questName);
    const action: QuestAction = {
        questContent: QuestLocationMap.QUEST_HOME_DESKTOP,
        questContentCTA: "ACCEPT_QUEST",
        sourceQuestContent: 0,
    };
    QuestApplyAction(quest.id, action).then(() => {
        dbg("Accepted quest:", quest.config.messages.questName);
    }).catch(err => {
        dbg("Failed to accept quest:", quest.config.messages.questName, err);
    });
}

function stopCompletingAll() {
    for (const id of completingQuest.keys()) {
        completingQuest.set(id, false);
    }
    dbg("Stopped completing all quests.");
}

function stopAllFarming() {
    stopCompletingAll();

    if (fakeGames.size > 0) {
        const removedGames = cachedFakeGamesList ?? Array.from(fakeGames.values());
        fakeGames.clear();
        cachedFakeGamesList = null;
        const games = RunningGameStore.getRunningGames();
        FluxDispatcher.dispatch({ type: "RUNNING_GAMES_CHANGE", removed: removedGames, added: games, games });
    }

    if (fakeApplications.size > 0) {
        fakeApplications.clear();
    }
}

function completeQuest(quest: QuestValue) {
    if (!settings.store.hasAcceptedToUsePlugin) {
        stopAllFarming();
        return;
    }

    if (!quest) {
        dbg("You don't have any uncompleted quests!");
    } else {
        const pid = Math.floor(Math.random() * 30000) + 1000;

        const applicationId = quest.config.application.id;
        const applicationName = quest.config.application.name;
        const { questName } = quest.config.messages;
        const taskConfig = quest.config.taskConfig ?? quest.config.taskConfigV2;
        const taskName = ["WATCH_VIDEO", "PLAY_ON_DESKTOP", "STREAM_ON_DESKTOP", "PLAY_ACTIVITY", "WATCH_VIDEO_ON_MOBILE"].find(x => taskConfig.tasks[x] != null);
        if (!taskName) {
            dbg("Unknown task type for quest:", questName);
            return;
        }
        const secondsNeeded = taskConfig.tasks[taskName].target;
        let secondsDone = quest.userStatus?.progress?.[taskName]?.value ?? 0;

        const isApp = typeof DiscordNative !== "undefined";
        if (!isApp && taskName !== "WATCH_VIDEO" && taskName !== "WATCH_VIDEO_ON_MOBILE") {
            dbg("This no longer works in browser for non-video quests (" + taskName + "). Use the discord desktop app to complete the", questName, "quest!");
            return;
        }

        completingQuest.set(quest.id, true);

        dbg(`Completing quest ${questName} (${quest.id}) - ${taskName} for ${secondsNeeded} seconds.`);

        switch (taskName) {
            case "WATCH_VIDEO":
            case "WATCH_VIDEO_ON_MOBILE":
                const maxFuture = 10, speed = 7;
                const enrolledAt = new Date(quest.userStatus.enrolledAt).getTime();
                let completed = false;
                const watchVideo = async () => {
                    while (true) {
                        const maxAllowed = Math.floor((Date.now() - enrolledAt) / 1000) + maxFuture;
                        const diff = maxAllowed - secondsDone;
                        const timestamp = secondsDone + speed;

                        if (!completingQuest.get(quest.id)) {
                            dbg("Stopping completing quest:", questName);
                            completingQuest.set(quest.id, false);
                            break;
                        }

                        if (diff >= speed) {
                            const res = await RestAPI.post({ url: `/quests/${quest.id}/video-progress`, body: { timestamp: Math.min(secondsNeeded, timestamp + Math.random()) } });
                            completed = res.body.completed_at != null;
                            secondsDone = Math.min(secondsNeeded, timestamp);
                        }

                        if (timestamp >= secondsNeeded) {
                            completingQuest.set(quest.id, false);
                            break;
                        }
                        await new Promise(resolve => setTimeout(resolve, 1000));
                    }
                    if (!completed) {
                        await RestAPI.post({ url: `/quests/${quest.id}/video-progress`, body: { timestamp: secondsNeeded } });
                    }
                    dbg("Quest completed!");
                };
                watchVideo();
                dbg(`Spoofing video for ${questName}.`);
                break;

            case "PLAY_ON_DESKTOP":
                RestAPI.get({ url: `/applications/public?application_ids=${applicationId}` }).then(res => {
                    const appData = res.body[0];
                    const exeName = appData.executables?.find(x => x.os === "win32")?.name?.replace(">","") ?? appData.name.replace(/[\/\\:*?"<>|]/g, "");

                    const fakeGame = {
                        cmdLine: `C:\\Program Files\\${appData.name}\\${exeName}`,
                        exeName,
                        exePath: `c:/program files/${appData.name.toLowerCase()}/${exeName}`,
                        hidden: false,
                        isLauncher: false,
                        id: applicationId,
                        name: appData.name,
                        pid: pid,
                        pidPath: [pid],
                        processName: appData.name,
                        start: Date.now(),
                    };
                    const realGames = fakeGames.size === 0 ? RunningGameStore.getRunningGames() : [];
                    fakeGames.set(quest.id, fakeGame);
                    cachedFakeGamesList = Array.from(fakeGames.values());
                    FluxDispatcher.dispatch({ type: "RUNNING_GAMES_CHANGE", removed: realGames, added: [fakeGame], games: cachedFakeGamesList });

                    const playOnDesktop = event => {
                        if (event.questId !== quest.id) return;
                        const progress = quest.config.configVersion === 1 ? event.userStatus.streamProgressSeconds : Math.floor(event.userStatus.progress.PLAY_ON_DESKTOP.value);
                        dbg(`Quest progress ${questName}: ${progress}/${secondsNeeded}`);

                        if (!completingQuest.get(quest.id) || progress >= secondsNeeded) {
                            dbg("Stopping completing quest:", questName);

                            fakeGames.delete(quest.id);
                            cachedFakeGamesList = null;
                            const games = RunningGameStore.getRunningGames();
                            const added = fakeGames.size === 0 ? games : [];
                            FluxDispatcher.dispatch({ type: "RUNNING_GAMES_CHANGE", removed: [fakeGame], added: added, games: games });
                            FluxDispatcher.unsubscribe("QUESTS_SEND_HEARTBEAT_SUCCESS", playOnDesktop);

                            if (progress >= secondsNeeded) {
                                dbg("Quest completed!");
                                completingQuest.set(quest.id, false);
                            }
                        }
                    };
                    FluxDispatcher.subscribe("QUESTS_SEND_HEARTBEAT_SUCCESS", playOnDesktop);

                    dbg(`Spoofed your game to ${applicationName}. Wait for ${Math.ceil((secondsNeeded - secondsDone) / 60)} more minutes.`);
                });
                break;

            case "STREAM_ON_DESKTOP":
                const fakeApp = {
                    id: applicationId,
                    name: `FakeApp ${applicationName} (CompleteDiscordQuest)`,
                    pid: pid,
                    sourceName: null,
                };
                fakeApplications.set(quest.id, fakeApp);

                const streamOnDesktop = event => {
                    if (event.questId !== quest.id) return;
                    const progress = quest.config.configVersion === 1 ? event.userStatus.streamProgressSeconds : Math.floor(event.userStatus.progress.STREAM_ON_DESKTOP.value);
                    dbg(`Quest progress ${questName}: ${progress}/${secondsNeeded}`);

                    if (!completingQuest.get(quest.id) || progress >= secondsNeeded) {
                        dbg("Stopping completing quest:", questName);

                        fakeApplications.delete(quest.id);
                        FluxDispatcher.unsubscribe("QUESTS_SEND_HEARTBEAT_SUCCESS", streamOnDesktop);

                        if (progress >= secondsNeeded) {
                            dbg("Quest completed!");
                            completingQuest.set(quest.id, false);
                        }
                    }
                };
                FluxDispatcher.subscribe("QUESTS_SEND_HEARTBEAT_SUCCESS", streamOnDesktop);

                dbg(`Spoofed your stream to ${applicationName}. Stream any window in vc for ${Math.ceil((secondsNeeded - secondsDone) / 60)} more minutes.`);
                dbg("Remember that you need at least 1 other person to be in the vc!");
                break;

            case "PLAY_ACTIVITY":
                const channelId = ChannelStore.getSortedPrivateChannels()[0]?.id ?? Object.values(GuildChannelStore.getAllGuilds()).find(x => x != null && x.VOCAL.length > 0).VOCAL[0].channel.id;
                const streamKey = `call:${channelId}:1`;

                const playActivity = async () => {
                    dbg("Completing quest", questName, "-", quest.config.messages.questName);

                    while (true) {
                        const res = await RestAPI.post({ url: `/quests/${quest.id}/heartbeat`, body: { stream_key: streamKey, terminal: false } });
                        const progress = res.body.progress.PLAY_ACTIVITY.value;
                        dbg(`Quest progress ${questName}: ${progress}/${secondsNeeded}`);

                        if (!completingQuest.get(quest.id) || progress >= secondsNeeded) {
                            if (progress >= secondsNeeded) {
                                await RestAPI.post({ url: `/quests/${quest.id}/heartbeat`, body: { stream_key: streamKey, terminal: true } });
                                dbg("Quest completed!");
                                completingQuest.set(quest.id, false);
                            } else {
                                dbg("Stopping completing quest:", questName);
                            }
                            break;
                        }

                        await new Promise(resolve => setTimeout(resolve, 20 * 1000));
                    }
                };
                playActivity();
                break;

            default:
                dbg("Unknown task type:", taskName);
                completingQuest.set(quest.id, false);
                break;
        }
    }
}