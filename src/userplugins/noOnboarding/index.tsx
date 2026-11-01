/*
 * TrashCord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { Devs, EquicordDevs } from "@utils/constants";
import definePlugin, { OptionType } from "@utils/types";
import { FluxDispatcher, GuildMemberStore, RestAPI, UserStore } from "@webpack/common";

const settings = definePluginSettings({
    randomAnswers: {
        description: "Select a random option for every prompt instead of always the last one, mimicking manual clicks so strict servers verify the join",
        default: true,
        type: OptionType.BOOLEAN,
        restartNeeded: false,
    },
});

export default definePlugin({
    name: "NoOnboarding",
    description: "Bypasses Discord's onboarding process for quicker server entry.",
    authors: [EquicordDevs.omaw, Devs.Glitch, { name: "zfrancesck1", id: 456195985404592149n }],
    tags: ["Privacy", "Utility"],
    enabledByDefault: false,
    settings,
    patches: [
        {
            find: "getOnboardingPromptsForOnboarding(t)),",
            replacement: {
                match: /function (\i)\((\i)\)\{(?=let\{guildId:\i\}=\2,.{0,200}?getOnboardingPromptsForOnboarding)/,
                replace: "function $1($2){if($self.shouldSkip($2.guildId)){$self.autoBypass($2.guildId);return null;}"
            }
        }
    ],

    shouldSkip(guildId: string) {
        try {
            const me = UserStore.getCurrentUser();
            return !!me && !!guildId && GuildMemberStore.isMember(guildId, me.id);
        } catch {
            return false;
        }
    },

    _gj: null as ((e: any) => void) | null,

    _autoBypassed: new Set<string>(),

    autoBypass(guildId: string) {
        if (!guildId || this._autoBypassed.has(guildId)) return;
        this._autoBypassed.add(guildId);
        FluxDispatcher.dispatch({ type: "IMPERSONATE_STOP", guildId });
        this.bypassOnboard(guildId);
    },

    handleGuildJoin(e: any) {
        if (e?.lurker) return;
        const guildId = e?.guildId;
        if (guildId) {
            this._autoBypassed.add(guildId);
            this.bypassOnboard(guildId);
        }
    },

    start() {
        this._gj = this.handleGuildJoin.bind(this);
        FluxDispatcher.subscribe("GUILD_JOIN", this._gj);
    },

    stop() {
        if (this._gj) FluxDispatcher.unsubscribe("GUILD_JOIN", this._gj);
        this._gj = null;
    },

    bypassOnboard(guild_id: string) {
        RestAPI.get({ url: `/guilds/${guild_id}/onboarding` })
            .then(res => {
                const data = res.body;
                if (!data?.prompts?.length) return;

                const now = Math.floor(Date.now() / 1000);
                const prompts_seen = {};
                const responses_seen = {};
                const responses: string[] = [];
                const random = settings.store.randomAnswers;

                for (const prompt of data.prompts) {
                    const options = prompt.options || [];
                    if (!options.length) continue;
                    prompts_seen[prompt.id] = now;
                    for (const opt of options) responses_seen[opt.id] = now;
                    if (!prompt.required && !random) continue;
                    const idx = random
                        ? Math.floor(Math.random() * options.length)
                        : options.length - 1;
                    responses.push(options[idx].id);
                }

                return RestAPI.post({
                    url: `/guilds/${guild_id}/onboarding-responses`,
                    body: {
                        onboarding_responses: responses,
                        onboarding_prompts_seen: prompts_seen,
                        onboarding_responses_seen: responses_seen,
                    }
                }).then(res => {
                    if (res?.body) {
                        FluxDispatcher.dispatch({
                            type: "GUILD_ONBOARDING_UPDATE_RESPONSES_SUCCESS",
                            guildId: guild_id,
                            options: res.body.onboarding_responses,
                            prompts_seen: res.body.onboarding_prompts_seen,
                            options_seen: res.body.onboarding_responses_seen,
                        });
                    }

                    FluxDispatcher.dispatch({
                        type: "IMPERSONATE_STOP",
                        guildId: guild_id,
                    });
                });
            })
            .catch(() => { });
    }
});