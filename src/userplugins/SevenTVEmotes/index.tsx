/*
* Vencord, a Discord client mod
* Copyright (c) 2026 Vendicated and contributors*
* SPDX-License-Identifier: GPL-3.0-or-later
*/

import managedStyle from "./styles.css?managed";

import { Devs } from "@utils/constants";
import definePlugin from "@utils/types";
import { stv } from "./api";
import { addExpressionPickerTab, ExpressionPickerPanelProps, removeExpressionPickerTab, RenderTabButtons, TabPanels } from "./ExpressionPickerTabs";
import { settings } from "./settings";
import { SevenTVChatBarIcon, SevenTVIcon, SevenTVExpressionPicker } from "./ui";


export default definePlugin({
    name: "SevenTVEmotes",
    description: "Easily send 7TV emotes like discord emotes.",
    tags: ["Emotes", "Chat", "Utility"],
    enabledByDefault: false,
    authors: [
        {
            name: "lolsper",
            id: 518308474828881930n
        },
        // thanks for the ExpressionPickerTabs API :)
        Devs.iamme
    ],
    managedStyle,

    settings,
    aba: false,
    patches: [
        { // module 731231
            find: "#{intl::EXPRESSION_PICKER_CATEGORIES_A11Y_LABEL}",
            replacement: [
                { // render custom tab in picker
                    match: /\(0,\i\.jsx\)\((\i),\{id:\i\.\i,"aria-controls":\i\.\i,"aria-selected":(\i)===\i\.\i\.EMOJI.+?,viewType:(\i).{0,50}\}\)/,
                    replace: "[$&,...$self.RenderTabButtons($1, $2)]"
                },
                {
                    match: /null,(\i)===\i\.\i\.SOUNDBOARD\?.{0,95}channel:(\i),containerWidth:(\i).+?\):null/,
                    replace: "$&,...$self.TabPanels($1, $2, $3)"
                },
            ]
        },
    ],


    chatBarButton: {
        icon: SevenTVIcon,
        render: SevenTVChatBarIcon
    },

    stv: stv,

    RenderTabButtons: RenderTabButtons,
    TabPanels: TabPanels,

    start: () => {
        addExpressionPickerTab("SevenTVEmotes", "7TV", (props: ExpressionPickerPanelProps) => { return SevenTVExpressionPicker(props); });
    },

    stop: () => {
        removeExpressionPickerTab("SevenTVEmotes");
    },
});
