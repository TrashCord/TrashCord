/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import definePlugin, { OptionType } from "@utils/types";

const settings = definePluginSettings({
    disableNowPlaying: {
        type: OptionType.BOOLEAN,
        description: "Disables NowPlayingStore - stops game tracking and clears the detected games list, reducing background CPU usage.",
        default: true,
        restartNeeded: true,
    },
    // DISABLED: optimizeDispatch patch strips parts of the READY event handler that other plugins
    // rely on (e.g. plugins hooking into dispatcher internals). Re-enable only after verifying
    // no conflicts with your installed plugins — it will likely cause crashes or silent failures.
    // optimizeDispatch: {
    //     type: OptionType.BOOLEAN,
    //     description: "Optimizes the READY event dispatcher - skips unnecessary operations on startup and reconnect.",
    //     default: true,
    //     restartNeeded: true,
    // },
    disableQuestsBar: {
        type: OptionType.BOOLEAN,
        description: "Removes the Quest bar above the user panel - skips rendering entirely, saving CPU and RAM.",
        default: true,
        restartNeeded: true,
    },
    optimizeTooltips: {
        type: OptionType.BOOLEAN,
        description: "Bypasses flushSync in tooltip state updates - prevents forced synchronous re-renders on hover.",
        default: true,
        restartNeeded: true,
    },
    optimizeEmojiCache: {
        type: OptionType.BOOLEAN,
        description: "Caches emoji getters in the emoji store - avoids redundant lookups during emoji rendering.",
        default: true,
        restartNeeded: true,
    },
    killLoadingSpinner: {
        type: OptionType.BOOLEAN,
        description: "Removes the app loading spinner - skips spinner source resolution on startup, saving ~100ms.",
        default: true,
        restartNeeded: true,
    },
    disableSpriteCanvas: {
        type: OptionType.BOOLEAN,
        description: "Removes the sprite canvas used for effects like confetti - saves GPU memory and draw calls.",
        default: true,
        restartNeeded: true,
    },
});

export default definePlugin({
    name: "perf",
    description: "Collection of small performance improvements",
    authors: [
        { id: 579731384868798464n, name: "void" },
        { id: 456195985404592149n, name: "zfrancesck1" },
    ],
    tags: ["Developers", "Utility"],
    enabledByDefault: false,
    settings,
    patches: [
        {
            find: "=\"NowPlayingStore\"",
            predicate: () => settings.store.disableNowPlaying,
            replacement: [
                { match: /get games\(\)\{return \w+?\}/, replace: "get games(){return []}" },
                { match: /(\.gameId;return null!=\w\[\w\]&&\().+?,(.+?,)\w={\.\.\.\w\},/, replace: (_, a, b) => a + b },
            ],
        },
        // DISABLED: this patch aggressively trims the READY handler and breaks plugins that
        // hook into the dispatch pipeline or expect the full handler chain to be intact.
        // {
        //     find: "getDispatchHandler needs to be passed in first!",
        //     predicate: () => settings.store.optimizeDispatch,
        //     replacement: {
        //        match: /let \i=Date\.now\(\),(\i=\i\.Z\.flush\(\i,\i\));\i\.\i\.showPerformanceTelemetry\?.+?Telemetry\(.+?,\i\)/,
        //        replace: "$1",
        //    },
        // },
        {
            find: "--custom-app-panels-height",
            predicate: () => settings.store.disableQuestsBar,
            replacement: {
                match: /,\(0,\w+\.jsx\)\(\w+\.A,\{\}\)(?=,\(0,\w+\.jsx\)\(\w+(?:\.\w+)?,\{\}\),\(0,\w+\.jsx\)\(\w+\.A,\{section:)/,
                replace: "",
            },
        },
        {
            find: "this.state.shouldShowTooltip!==",
            predicate: () => settings.store.optimizeTooltips,
            replacement: {
                match: /\w+\.flushSync\(\(\)=>\{(this\.setState\(\{shouldShowTooltip:\w+\}\))\}\)/,
                replace: "$1",
            },
        },
        {
            find: "this.rebuildFavoriteEmojisWithoutFetchingLatest()",
            predicate: () => settings.store.optimizeEmojiCache,
            replacement: {
                match: /(\w+)=(\w+)=>\{let (\w+)=(\w+)\[null==\2\?([^:]+):\2\];null!=\3&&\((\w+)\(\)\.each\(\3\.usableEmojis,(\w+)\),\6\(\)\.each\(\3\.emoticons,(\w+)\)\)\}/,
                replace: (_, o, e, t, cache, key, each, r, s) =>
                    `${o}=${e}=>{` +
                    `const ${t}=${cache}[null==${e}?${key}:${e}];` +
                    `const _u=${t}?.usableEmojis;` +
                    `const _em=${t}?.emoticons;` +
                    `null!=${t}&&(${each}().each(_u,${r}),${each}().each(_em,${s}))` +
                    `}`,
            },
        },
        {
            find: "getAppSpinnerSources",
            predicate: () => settings.store.killLoadingSpinner,
            replacement: {
                match: /let (\w+)=\w+\.\w+\.getAppSpinnerSources\(\),(\w+)=null!=\1\?\w+\(\1\):null/,
                replace: (_, src, spinner) => `let ${src}=null,${spinner}=null`,
            },
        },
        {
            find: "\"SpriteCanvas-module_spriteCanvasHidden",
            predicate: () => settings.store.disableSpriteCanvas,
            replacement: {
                match: /,\w\.createElement\("canvas",{.+?\)}\)/,
                replace: "",
            },
        },
    ],
});