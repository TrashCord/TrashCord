/*
 * TrashCord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { channelLabel, getChannelInfo, getMyChannelId } from "./channels";
import { T } from "./i18n";
import { joinVoiceChannel } from "./join";
import { getUserDisplayName } from "./names";
import { clearAutoJoin, getAutoJoinTarget } from "./store";
import { toast, ToastVariant } from "./toast";

const JOIN_RETRY_COOLDOWN_MS = 2000;

export interface QueueEntry {
    channelId: string;
    channelLabel: string;
    followingUserId: string | null;
}

let entry: QueueEntry | null = null;
let lastAttemptAt = 0;

const MAX_ATTEMPTS = 8;
let attempts = 0;
const listeners = new Set<() => void>();

export function subscribeToQueue(listener: () => void): () => void {
    listeners.add(listener);
    return () => void listeners.delete(listener);
}

function emit() {
    listeners.forEach(listener => {
        try {
            listener();
        } catch (error) {
            console.error("[VoiceRadar-Discord] queue listener failed:", error);
        }
    });
}

export function getQueueEntry(): QueueEntry | null {
    return entry;
}

export function isQueuedFor(channelId: string): boolean {
    return entry?.channelId === channelId;
}

export function queueForChannel(channelId: string, stopFollowing = false, followingUserId: string | null = null) {
    if (entry?.channelId === channelId) return;

    const label = channelLabel(getChannelInfo(channelId));
    const target = stopFollowing ? getAutoJoinTarget() : undefined;
    const replaced = entry?.channelLabel;

    if (target) clearAutoJoin();

    entry = { channelId, channelLabel: label, followingUserId };
    attempts = 0;
    emit();

    const extras = [
        target && T.queueAutoJoinDropped(getUserDisplayName(target.id, target.name)),
        replaced && T.queueReplaced(replaced)
    ].filter(Boolean);

    toast(T.queueWaiting(label, extras.join(", ")), ToastVariant.MESSAGE);
}

export function cancelQueue(reason?: string) {
    if (!entry) return;

    entry = null;
    attempts = 0;
    emit();

    if (reason) toast(reason, ToastVariant.MESSAGE);
}

export function checkQueue() {
    if (!entry) return;

    if (getMyChannelId() === entry.channelId) {
        const label = entry.channelLabel;
        entry = null;
        attempts = 0;
        emit();
        toast(T.queueGotSlot(label), ToastVariant.SUCCESS);
        return;
    }

    const info = getChannelInfo(entry.channelId);
    if (info.isFull || !info.canJoin) {
        attempts = 0;
        return;
    }

    if (Date.now() - lastAttemptAt < JOIN_RETRY_COOLDOWN_MS) return;

    if (attempts >= MAX_ATTEMPTS) {
        const label = entry.channelLabel;
        entry = null;
        attempts = 0;
        emit();
        toast(T.queueStuck(label), ToastVariant.FAILURE);
        return;
    }

    lastAttemptAt = Date.now();
    attempts++;

    if (joinVoiceChannel(entry.channelId) !== "refused") return;

    const label = entry.channelLabel;
    entry = null;
    attempts = 0;
    emit();
    toast(T.queueRefused(label), ToastVariant.FAILURE);
}

export function resetQueue() {
    entry = null;
    lastAttemptAt = 0;
    attempts = 0;

}
