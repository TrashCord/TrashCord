/*
 * TrashCord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Link } from "@components/Link";
import { Devs } from "@utils/constants";
import { localStorage } from "@utils/localStorage";
import { closeAllModals, openModal } from "@utils/modal";
import definePlugin from "@utils/types";
import { findByPropsLazy } from "@webpack";
import { Button } from "@components/Button";
import { Heading } from "@components/Heading";
import { Paragraph } from "@components/Paragraph";
import { FluxDispatcher, React, showToast } from "@webpack/common";

import AppIconModal from "./AppIconModal";

interface AppIcon {
    id: string;
    iconSource: string;
    name: string;
    isPremium: boolean;
}

interface AppIconData {
    UZ: AppIcon[];
    QA: Record<string, AppIcon>;
}

const AppIconData = findByPropsLazy("UZ", "QA") as AppIconData;

const AppIconStore = findByPropsLazy("getCurrentDesktopIcon");
const EditorFooterClasses = findByPropsLazy("editorFooter");

function removeAppIcon() {
    const current_icon = AppIconStore.getCurrentDesktopIcon();
    let icons = JSON.parse(localStorage.getItem("vc_app_icons") || "[]") as AppIcon[];
    const index = icons.findIndex(icon => current_icon === icon.id);
    if (index !== -1) {
        icons = icons.filter(icon => icon.id !== current_icon);
        delete AppIconData.QA[current_icon];
        delete AppIconData.UZ[AppIconData.UZ.findIndex(icon => current_icon === icon?.id)];
        localStorage.setItem("vc_app_icons", JSON.stringify(icons));
        showToast({ text: "Icon successfully deleted!", variant: "success" });
        FluxDispatcher.dispatch({
            type: "APP_ICON_UPDATED",
            id: "AppIcon"
        });
    } else {
        showToast({ text: "Cannot delete native App Icons!", variant: "critical" });
        return;
    }

}

export default definePlugin({
    name: "CustomAppIcons",
    description: "Add/upload your own custom (In-)App Icon(s).",
    authors: [Devs.x2b, Devs.nnenaza],
    tags: ["Appearance", "Customisation"],
    enabledByDefault: false,
    patches: [
        {
            find: /\i\.\i\.APP_ICON_UPSELL/,
            replacement: [
                {
                    match: /\w+\.jsx\)\(\w+,{markAsDismissed:\w+,isCoachmark:\w+}\)/,
                    replace(str) {
                        return str + ",$self.addButtons()";
                    }
                }
            ]
        }
    ],

    start() {
        console.log("Well hello there!, CustomAppIcons has started :)");
        const appIcons = JSON.parse(localStorage.getItem("vc_app_icons") ?? "[]");
        for (const icon of appIcons) {
            AppIconData.UZ.push(icon);
            AppIconData.QA[icon.id] = icon;
        }
    },
    stop() {

    },
    addButtons() {

        const { editorFooter } = EditorFooterClasses;
        return (
            <>
                <Button variant="primary" size="medium" className={editorFooter} onClick={() => {
                    openModal(props => <AppIconModal {...props as any} />);
                }}>
                    Add Custom App Icon
                </Button>
                <Button variant="dangerPrimary" size="medium" className={editorFooter} onClick={removeAppIcon}>
                    Remove Custom selected App Icon
                </Button>
            </>
        );
    },

    settingsAboutComponent: () => {
        return (
            <>
                <Heading>
                    <Heading>How to use?</Heading>
                </Heading>
                <Paragraph>
                    <Paragraph>Go to <Link href="/settings/appearance" onClick={e => { e.preventDefault(); closeAllModals(); FluxDispatcher.dispatch({ type: "USER_SETTINGS_MODAL_SET_SECTION", section: "Appearance" }); }}>Appearance Settings</Link> tab.</Paragraph>
                    <Paragraph>Scroll down to "In-app Icons" and click on "Preview App Icon".</Paragraph>
                    <Paragraph>And upload your own custom icon!</Paragraph>
                    <Paragraph>You can only use links when you are uploading your Custom Icon.</Paragraph>
                </Paragraph>
            </>
        );
    }
});
