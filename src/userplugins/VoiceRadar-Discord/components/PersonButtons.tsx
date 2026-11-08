/*
 * TrashCord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describeAutoJoinPace, describeMagnet, toggleAutoJoinFor, toggleMagnetFor, toggleNotifyFor, togglePinFor } from "../actions";
import { T } from "../i18n";
import { GIVE_UP_COOLDOWN_MS, MAX_RETURNS_PER_MINUTE } from "../magnet";
import { canShowMagnet, getMoveAccess } from "../movePermissions";
import type { TrackedUser } from "../store";
import { ActionButton } from "./common";
import { BellIcon, MagnetIcon, PinIcon, TargetIcon } from "./icons";

export interface PersonButtonProps {
    userId: string;
    /** The name saved for somebody new, so never a translated placeholder. */
    storedName: string;
    tracked: TrackedUser | undefined;
}

export function MagnetButton({ userId, storedName, tracked }: PersonButtonProps) {
    if (!canShowMagnet(userId)) return null;

    const uncheckedNote = getMoveAccess(userId) === "unknown" ? T.permissionUnchecked : "";

    return (
        <ActionButton
            icon={<MagnetIcon />}
            tooltip={describeMagnet(!!tracked?.autoPull, userId) + uncheckedNote}
            note={T.magnetLimit(MAX_RETURNS_PER_MINUTE, GIVE_UP_COOLDOWN_MS / 1000)}
            active={tracked?.autoPull}
            onClick={() => toggleMagnetFor(userId, storedName)}
        />
    );
}

export function PinButton({ userId, storedName, tracked }: PersonButtonProps) {
    return (
        <ActionButton
            icon={<PinIcon />}
            tooltip={tracked?.pinned ? T.unpin : T.pin}
            active={tracked?.pinned}
            onClick={() => togglePinFor(userId, storedName)}
        />
    );
}

export function NotifyButton({ userId, storedName, tracked }: PersonButtonProps) {
    return (
        <ActionButton
            icon={<BellIcon />}
            tooltip={tracked?.notify ? T.notifyOn : T.notifyOff}
            active={tracked?.notify}
            onClick={() => toggleNotifyFor(userId, storedName)}
        />
    );
}

export function AutoJoinButton({ userId, storedName, tracked }: PersonButtonProps) {
    return (
        <ActionButton
            icon={<TargetIcon />}
            tooltip={tracked?.autoJoin ? T.autoJoinOn : T.autoJoinOff}
            note={describeAutoJoinPace()}
            active={tracked?.autoJoin}
            onClick={() => toggleAutoJoinFor(userId, storedName)}
        />
    );
}
