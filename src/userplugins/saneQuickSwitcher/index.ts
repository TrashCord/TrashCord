/*
 * TrashCord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Devs } from "@utils/constants";
import { getCurrentGuild } from "@utils/discord";
import definePlugin from "@utils/types";

export default definePlugin({
    name: "SaneQuickSwitcher",
    authors: [
        Devs.sadan
    , Devs.x2b],
    description: "Puts results for the channels in the current server at the top of the quick switcher. Only reorders the results",
    tags: ["Shortcuts", "Utility"],
    enabledByDefault: false,
    patches: [
        {
            find: ".QUICKSWITCHER_PLACEHOLDER",
            replacement: {
                match: /renderResults\(\).{0,50}\i:(\i)}=this\.props;/,
                replace: "$&$1=$self.order($1);"
            }
        }
    ],
    order(results: any){
        const cGuild = getCurrentGuild();
        if(!cGuild)
            return results;
        const maxScore = results[0].score;
        for(const r of results){
            if (r.record?.guild_id === cGuild.id){
                r.score += maxScore;
            }
        }
        // it makes no sense, but for some reason, it is b - a
        return results.sort((a, b) => b.score - a.score);
    }
});




