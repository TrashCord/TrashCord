/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./style.css";

import { definePluginSettings } from "@api/Settings";
import ErrorBoundary from "@components/ErrorBoundary";
<<<<<<< HEAD
import { Devs } from "@utils/constants";
import { classNameFactory } from "@utils/css";
import definePlugin, { OptionType } from "@utils/types";
import { useEffect, UserStore, useState } from "@webpack/common";

const cl = classNameFactory("vc-charCounter-");
=======
import { Devs, EquicordDevs } from "@utils/constants";
import { classNameFactory } from "@utils/css";
import definePlugin, { OptionType } from "@utils/types";
import { findByPropsLazy } from "@webpack";
import { useEffect, UserStore, useState } from "@webpack/common";

const cl = classNameFactory("vc-charCounter-");
const SlateUtils = findByPropsLazy("getSelectedText");
>>>>>>> 89b0fd2a5 (Update index.tsx)

const settings = definePluginSettings({
    colorEffects: {
        type: OptionType.BOOLEAN,
        description: "Enable yellow/red colouring as you get closer to the character limit",
        default: true,
    }
});

function getCounterColor(percentage: number) {
    if (!settings.store.colorEffects) return "var(--primary-330)";
    if (percentage < 50) return "var(--text-muted)";
    if (percentage < 75) return "var(--yellow-330)";
    if (percentage < 90) return "var(--orange-330)";
    return "var(--red-360)";
}

export default definePlugin({
    name: "CharacterCounter",
    description: "Adds a character counter to the chat input",
<<<<<<< HEAD
    authors: [Devs.thororen, Devs.creations],
=======
    authors: [Devs.thororen, EquicordDevs.creations],
>>>>>>> 89b0fd2a5 (Update index.tsx)
    tags: ["Utility"],
    settings,
    patches: [
        {
            find: ".CREATE_FORUM_POST||",
            replacement: [
                {
                    match: /(?<=,editorRef:(\i),.{0,200}textValue:(\i),editorHeight:\i,channelId:\i\.id\}\)),\i/,
                    replace: ",$self.renderCharCounter({editorRef:$1,text:$2})"
                }
            ]
        },
        {
            find: "#{intl::PREMIUM_MESSAGE_LENGTH_UPSELL_TOOLTIP}",
            replacement: {
                match: /(?<=\.PREMIUM_UPSELL\);)(?=.{0,50}\.PREMIUM_UPSELL_VIEWED)/,
                replace: "return null;"
            }
        }
    ],

    renderCharCounter: ErrorBoundary.wrap(({ editorRef, text }: { text: string; editorRef: any; }) => {
        const [selectedCount, setSelectedCount] = useState(0);
        const showSelected = selectedCount > 0 && (editorRef?.current?.state?.focused ?? false);

        useEffect(() => {
            const listener = () => {
<<<<<<< HEAD
                setSelectedCount(document.getSelection()?.toString()?.length ?? 0);
=======
                if (!editorRef?.current) return setSelectedCount(0);

                setTimeout(() => setSelectedCount(SlateUtils.getSelectedText(editorRef.current?.getSlateEditor())?.length ?? 0), 50);
>>>>>>> 89b0fd2a5 (Update index.tsx)
            };

            document.addEventListener("selectionchange", listener);
            return () => document.removeEventListener("selectionchange", listener);
        }, []);

        if (!text.length) return null;

        const premiumType = UserStore.getCurrentUser().premiumType ?? 0;
        const charMax = premiumType === 2 ? 4000 : 2000;

        const color = getCounterColor((text.length / charMax) * 100);

        return (
            <div className={cl("counter")} style={{ color }}>
                {showSelected && (
                    <>
                        <span className={cl("selected")}>{selectedCount}</span>
                        /
                    </>
                )}
                <span className={cl("count")}>{text.length}</span>
                /
                <span className={cl("max")}>{charMax}</span>
            </div>
        );
    }, { noop: true })
});
