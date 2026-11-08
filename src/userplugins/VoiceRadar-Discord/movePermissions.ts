/*
 * TrashCord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ChannelStore, PermissionsBits, PermissionStore } from "@webpack/common";

import { type ApiHealth, HealthReport, probe } from "./apiHealth";
import { TtlCache } from "./cache";
import { getMyChannelId, getVoiceInfo } from "./channels";
import { T } from "./i18n";
import { settings } from "./settings";
import { getAutoPullTarget } from "./store";

export function isModeratorMode(): boolean {
    return !!settings.store.moderatorMode;
}

export type MoveAccess = "yes" | "no" | "unknown";

const ACCESS_TTL_MS = 200;
const ACCESS_MAX_ENTRIES = 200;
const accessCache = new TtlCache<MoveAccess>(ACCESS_TTL_MS, ACCESS_MAX_ENTRIES);

export function moveAccessForChannel(channelId: string): MoveAccess {
    const cached = accessCache.get(channelId);
    if (cached !== undefined) return cached;

    const channel = ChannelStore.getChannel(channelId);
    let access: MoveAccess;

    if (!channel) access = "no";
    else if (!canAskAboutMoving()) access = "unknown";
    else {
        try {
            access = PermissionStore.can(PermissionsBits.MOVE_MEMBERS, channel) ? "yes" : "no";
        } catch (error) {
            console.warn("[VoiceRadar-Discord] moderator permission check failed:", error);
            access = "unknown";
        }
    }

    return accessCache.set(channelId, access);
}

function canAskAboutMoving(): boolean {
    return probe(() => typeof (PermissionStore as any)?.can === "function"
        && typeof PermissionsBits?.MOVE_MEMBERS === "bigint");
}

/** Discord wants Move Members in both channels. */
function moveAccessBetween(fromChannelId: string, toChannelId: string | null): MoveAccess {
    const from = moveAccessForChannel(fromChannelId);
    if (from === "no" || !toChannelId) return from;

    const to = moveAccessForChannel(toChannelId);
    if (to === "no") return "no";

    return from === "unknown" || to === "unknown" ? "unknown" : "yes";
}

export function getMoveAccess(userId: string): MoveAccess {
    if (!isModeratorMode()) return "no";

    const voice = getVoiceInfo(userId);
    if (!voice?.guildId) return "no";

    return moveAccessBetween(voice.channelId, getMyChannelId());
}

export function canMoveUser(userId: string): boolean {
    return getMoveAccess(userId) !== "no";
}

/** The magnet needs the right only where the person sits, and waits while you are somewhere it cannot pull them to. */
export function canShowMagnet(userId: string): boolean {
    if (!isModeratorMode()) return false;
    if (getAutoPullTarget()?.id === userId) return true;

    const voice = getVoiceInfo(userId);
    return voice?.guildId != null && moveAccessForChannel(voice.channelId) !== "no";
}

export function forgetMoveAccess(): void {
    accessCache.clear();
}

export function movePermissionProblems(): ApiHealth {
    return new HealthReport()
        .nice(() => typeof (PermissionsBits as any)?.MOVE_MEMBERS === "bigint", T.apiMoveMembersFlag);
}
