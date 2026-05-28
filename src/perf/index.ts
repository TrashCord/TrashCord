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
        //     replacement: { match: /(\.flush\(\w,\w\),"READY"===\w\)\{).+?;(.+?\)),.+?\}/, replace: (_, a, b) => a + b + "}" },
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
            replacement: [
                {
                    match: /\i.flushSync\(\(\)=>\{this\.setState\(\{shouldShowTooltip:(\i)\}\)\}\)/,
                    replace: (_m, p) => `this.__open=${p},this.setState({shouldShowTooltip:${p}})`,
                },
                {
                    match: /if\(this\.state\.shouldShowTooltip!==(\i)\)/,
                    replace: "if(this.__open!==$1)",
                },
            ],
        },
        {
            find: "this.rebuildFavoriteEmojisWithoutFetchingLatest()",
            predicate: () => settings.store.optimizeEmojiCache,
            replacement: [
                {
                    match: /(\i)=>\{let \i=(\i)\[null==\i\?(\i)\.kod:\i\];null!=\i&&\((\i)\(\)\.each\(\i\.usableEmojis,(\i)\),\i\(\)\.each\(\i\.emoticons,(\i)\)\)\};/,
                    replace: (_m, e, q, k, a, n, r) =>
                        `${e}=>{` +
                        `const t=${q}[null==${e}?${k}.kod:${e}];` +
                        "const usableEmojis=t?.usableEmojis;" +
                        "const emoticons=t?.emoticons;" +
                        `null!=t&&(${a}().each(usableEmojis,${n}),${a}().each(emoticons,${r}))` +
                        "};",
                },
            ],
        },
        {
            find: /\i\.\i\.getAppSpinnerSources\(\)/,
            predicate: () => settings.store.killLoadingSpinner,
            replacement: {
                match: /let \i=\i\.\i\.getAppSpinnerSources\(\).+?;(\i\.\i).+?\)\}/,
                replace: "$1=()=>null;",
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