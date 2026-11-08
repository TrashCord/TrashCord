/*
 * TrashCord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { showNotification } from "@api/Notifications";
import { Settings } from "@api/Settings";
import { UserStore } from "@webpack/common";

import { proveWorking, reportBroken } from "./apiHealth";
import { T } from "./i18n";
import { getAvatarUrl, getUserDisplayName } from "./names";
import { ALERT_OFF, getJoinAlert } from "./settings";
import { playJoinSound } from "./sound";

export interface JoinCard {
    /** A newer card with the same key replaces the old one. */
    key: string;
    title: string;
    body: string;
    icon?: string;
    onOpen?: () => void;
    onJoin?: () => void;
}

let showCard: ((card: JoinCard) => void) | null = null;

export function setJoinCardShower(show: ((card: JoinCard) => void) | null) {
    showCard = show;
}

function discordHasFocus(): boolean {
    return typeof document !== "undefined" && document.hasFocus();
}

/** The card inside Discord always shows, since Windows hides its own notifications during a game. */
export function announceJoin(card: JoinCard) {
    if (getJoinAlert() === ALERT_OFF) return;
    playJoinSound();

    let cardShown = false;
    try {
        if (showCard) {
            showCard(card);
            cardShown = true;
            proveWorking(T.apiJoinCard);
        }
    } catch (error) {
        console.warn("[VoiceRadar-Discord] could not show the join card:", error);
        reportBroken(T.apiJoinCard);
    }

    // Without the card Vencord's own notification is the only thing you would see, so it goes out whatever the setting says.
    if (!cardShown) {
        void showNotification({ title: card.title, body: card.body, icon: card.icon, onClick: card.onOpen });
        return;
    }

    if (discordHasFocus()) return;
    if ((Settings as any).notifications?.useNative === "never") return;

    void showNotification({ title: card.title, body: card.body, icon: card.icon, onClick: card.onOpen });
}

export function previewJoinAlert() {
    const me = UserStore.getCurrentUser();
    const name = me ? getUserDisplayName(me.id, T.someone) : T.someone;

    announceJoin({
        key: "preview",
        title: T.notifyTitle(name),
        body: T.joinPreviewBody,
        icon: (me && getAvatarUrl(me.id)) ?? undefined
    });
}
