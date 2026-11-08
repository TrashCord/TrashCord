/*
 * TrashCord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import ErrorBoundary from "@components/ErrorBoundary";
import { Devs, IS_LINUX, IS_WINDOWS } from "@utils/constants";
import definePlugin, { OptionType } from "@utils/types";
import { React } from "@webpack/common";

import managedStyle from "./style.css?managed";

let Buttons: any;
let WindowControls: any;

const settings = definePluginSettings({
    moveWindowControls: {
        type: OptionType.BOOLEAN,
        description: "Move window controls next to search",
        default: true,
        restartNeeded: true,
        hidden: !IS_WINDOWS && !IS_LINUX,
        target: "DESKTOP",
    },
    makeWindowDraggable: {
        type: OptionType.BOOLEAN,
        description: "Make the window draggable from the top",
        default: true,
        restartNeeded: true,
        hidden: !IS_WINDOWS && !IS_LINUX,
        target: "DESKTOP",
    }
});

export default definePlugin({
    name: "Untitled",
    description: "Removes the titlebar",
    authors: [Devs.Kyuuhachi, { name: "cxntered", id: 638695599893643274n }],
    tags: ["Appearance", "Customisation", "Utility"],
    enabledByDefault: false,
    managedStyle,
    settings,
    patches: [
        {
            // move buttons next to search
            find: "window.DiscordNative.app.getDefaultDoubleClickAction()",
            replacement: {
                match: /\i\.Fragment\b/,
                replace: "$self.PatchButtons",
            },
        },
        {
            find: "refresh-title-bar-small",
            replacement: [
                // assign buttons element to plugin
                {
                    match: /(function\((\i)\){)(let{leading:)/,
                    replace: "$1$self.Buttons=()=>$2.trailing;$3",
                },
                // assign window controls element to plugin
                {
                    match: /function (\i)\(\i\){let{windowKey:/,
                    replace: "$self.WindowControls=$1;$&",
                    predicate: () => settings.store.moveWindowControls && (IS_WINDOWS || IS_LINUX)
                },
                // create empty div with draggable window class to allow dragging
                {
                    match: /onDoubleClick:\i,"data-window-chrome":"true",/,
                    replace: "});({",
                    predicate: () => settings.store.moveWindowControls && (IS_WINDOWS || IS_LINUX) && settings.store.makeWindowDraggable
                },
                // remove bar entirely if window dragging is disabled
                {
                    match: /getSystemUIDirection\(\),\[\i\]\);/,
                    replace: "$&return null;",
                    predicate: () => !settings.store.moveWindowControls || (!IS_WINDOWS && !IS_LINUX) || !settings.store.makeWindowDraggable
                }
            ],
        }
    ],

    PatchButtons({ children }) {
        return <>
            {children}
            <ErrorBoundary>
                <Buttons />
                {WindowControls && <WindowControls showDivider={true} windowKey={undefined} />}
            </ErrorBoundary>
        </>;
    },

    set Buttons(e: any) {
        Buttons = e;
    },

    set WindowControls(e: any) {
        WindowControls = e;
    },
});
