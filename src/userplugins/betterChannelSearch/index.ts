/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import definePlugin from "@utils/types";
import { Channel, FluxStore, Guild } from "@vencord/discord-types";
import { findStore } from "@webpack";

interface SearchResultItem {
    type: "TEXT_CHANNEL" | "VOICE_CHANNEL";
    record: Channel;
    score: number;
    comparator: string;
    sortable: string;
}
interface FrecencyStore extends FluxStore {
    getFrequentlyWithoutFetchingLatest(): (Channel | Guild)[];
}

export default definePlugin({
    name: "BetterChannelSearch",
    description: "Sorts the Forward menu and Quick Switcher (Ctrl+K / ⌘+K) menu channel search results so that channels from servers you've opened recently show up highest on the list",
    authors: [{ name: "afriendlygam8r", id: 318120180385447939n }],    
    tags: ["Utility", "Shortcuts"],
    enabledByDefault: false,
// I wasn't planning for it to affect the quick switcher menu too but.. we can say it's a feature not a bug totally :3

    patches: [{
        find: ",queryStaticRouteChannels(",
        replacement: {
            match: /(}}return )(?<searchResults>\i)\.sort\((?<byScoreOrComparator>\i\.\i)\)/,
            replace: "$1(Vencord.Plugins.isPluginEnabled($self.name) ? $<searchResults>.sort($self.byGuildRecency).map($self.amplifyScores) : $<searchResults>.sort($<byScoreOrComparator>))"
        }
    }],

    byGuildRecency(searchResultA: SearchResultItem, searchResultB: SearchResultItem) {
        const frecencyStore: FrecencyStore = findStore("FrecencyStore");
        const TypeTag = Symbol.for("PlainRecord.TypeTag");
        // Is `as Guild[]` most practical here?
        // Getting TS intellisense to automatically infer the type correctly seems like it might be a mess just for this one variable
        const recentGuilds = frecencyStore.getFrequentlyWithoutFetchingLatest().filter(x => x[TypeTag] === "Guild") as Guild[];
        const getGuildRecency = (channel: Channel) => {
            const index = recentGuilds.findIndex(recentGuild => recentGuild.id === channel.guild_id);
            return index === -1 ? 1000 : index;
        };
        return getGuildRecency(searchResultA.record) - getGuildRecency(searchResultB.record);
    },
    amplifyScores: (searchResult: SearchResultItem, i: number, arr: Array<SearchResultItem>) => (searchResult.score = (arr.length - 1 - i) * 1000, searchResult),
    // Maybe ill just stick to one liner arrow functions if a normal function wouldnt be more than just a few lines anyways :3
    // or maybe this is pedantic and it's not really a big deal~
    // amplifyScores(searchResult: SearchResultItem, i: number, arr: Array<SearchResultItem>) {
    //     searchResult.score = (arr.length - 1 - i) * 1000;
    //     return searchResult;
    // },
});
