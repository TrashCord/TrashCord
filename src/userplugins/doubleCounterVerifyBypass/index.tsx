/*
 * TrashCord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { NavContextMenuPatchCallback } from "@api/ContextMenu";
import definePlugin, { PluginNative } from "@utils/types";
import { Alerts, Menu } from "@webpack/common";
import { Message } from "discord-types/general";

const DOUBLECOUNTER_APP_ID = "703886990948565003";
const VERIFICATION_LINK_REGEX = /https:\/\/verify\.doublecounter\.gg\/v\/[0-9a-z]{8,16}/;

const Native = VencordNative.pluginHelpers.DoubleCounterVerifyBypass as PluginNative<typeof import("./native")>;

function getLink(message: any): string | null {
    const field = message?.embeds?.[0]?.fields?.[1];
    const value = field?.rawValue ?? field?.value;
    if (typeof value !== "string") return null;
    const match = VERIFICATION_LINK_REGEX.exec(value);
    return match ? match[0] : null;
}

async function verify(link: string): Promise<boolean> {
    try {
        return await Native.verify(link);
    } catch {
        return false;
    }
}

function showVerified() {
    Alerts.show({
        title: "Verified",
        body: "You have been verified successfully, please wait a little bit for DoubleCounter to update your roles.",
        confirmText: "Okay"
    });
}

const patchMessageContextMenu: NavContextMenuPatchCallback = (children, { message }) => {
    if (message?.author?.id !== DOUBLECOUNTER_APP_ID) return;
    if (message.components?.length) return;
    if ((message.embeds?.[0] as any)?.fields?.length !== 4) return;

    children.push((
        <Menu.MenuItem
            id="ml-dcvp"
            key="ml-dcvp-verify"
            label="Bypass Double Counter"
            color="brand"
            action={async () => {
                const link = getLink(message);
                if (!link) {
                    Alerts.show({
                        title: "Link not found",
                        body: "The link has not been found in this message.",
                        confirmText: "Okay"
                    });
                    return;
                }
                if (await verify(link)) {
                    showVerified();
                } else {
                    Alerts.show({
                        title: "Verification failed",
                        body: "The verification request did not go through, please try again.",
                        confirmText: "Okay"
                    });
                }
            }}
        />
    ));
};

export default definePlugin({
    name: "DoubleCounterVerifyBypass",
    description: "Bypass Double Counter verifications easily.",
    authors: [{ name: "verticalsync", id: 1181610810548686979n }, { name: "zfrancesck1", id: 456195985404592149n }],
    tags: ["Privacy", "Utility"],
    enabledByDefault: false,

    contextMenus: {
        "message": patchMessageContextMenu,
    },

    flux: {
        async MESSAGE_CREATE({ message }: { message: Message; }) {
            if (message?.author?.id !== DOUBLECOUNTER_APP_ID || message.type !== 19 || !message.embeds?.length) return;
            const link = getLink(message);
            if (!link) return;
            if (await verify(link)) showVerified();
        }
    }
});