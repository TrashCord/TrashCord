/*
 * TrashCord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { Devs } from "@utils/constants";
import definePlugin, { OptionType } from "@utils/types";
import { FluxDispatcher, SelectedGuildStore, showToast, UserStore } from "@webpack/common";

const AgeVerificationStatus = {
    TEEN: 2,
    ADULT: 3
} as const;

const agreedGuilds = new Set<string>();

const settings = definePluginSettings({
    teen: {
        description: "Set the teen age group instead of adult",
        type: OptionType.BOOLEAN,
        default: false,
        onChange(newValue: boolean) {
            apply();
            showToast({ text: `Age group set to ${newValue ? "teen" : "adult"}`, variant: "success" });
        }
    },
    allowNsfwChannels: {
        description: "Unblock age restricted channels",
        type: OptionType.BOOLEAN,
        default: true
    }
});

function setAgeGroup() {
    const status = settings.plain.teen ? AgeVerificationStatus.TEEN : AgeVerificationStatus.ADULT;
    if (UserStore.getCurrentUser()?.ageVerificationStatus === status) return;

    FluxDispatcher.dispatch({ type: "INITIATE_AGE_VERIFICATION" });
    FluxDispatcher.dispatch({ type: "CLOSE_AGE_VERIFICATION_MODAL", status });
}

function patchUser() {
    const user = UserStore.getCurrentUser();
    if (!user || user.nsfwAllowed === true) return;

    UserStore.getUsers()[user.id] = user.set("nsfwAllowed", true);
    UserStore.emitChange();
}

function agreeGuild(guildId?: string | null) {
    if (!guildId || agreedGuilds.has(guildId)) return;

    agreedGuilds.add(guildId);
    FluxDispatcher.dispatch({ type: "GUILD_NSFW_AGREE", guildId });
}

function allowNsfwChannels(guildId?: string | null) {
    if (!settings.plain.allowNsfwChannels) return;

    patchUser();
    agreeGuild(guildId);
}

function apply() {
    setAgeGroup();
    allowNsfwChannels(SelectedGuildStore.getGuildId());
}

export default definePlugin({
    name: "SetAge",
    description: "Gives accounts with no age group one, so Discord stops asking you to verify your age. Stays on this client only.",
    authors: [Devs.x2b, { name: "zfrancesck1", id: 456195985404592149n }],
    tags: ["Utility", "Privacy"],
    enabledByDefault: true,
    settings,
    start() {
        apply();
    },
    stop() {
        agreedGuilds.clear();
    },

    flux: {
        CURRENT_USER_UPDATE() {
            apply();
        },
        CHANNEL_SELECT({ guildId }: { guildId?: string | null; }) {
            allowNsfwChannels(guildId);
        }
    }
});