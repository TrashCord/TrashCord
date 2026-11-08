/*
 * TrashCord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/** A channel's own name when the other side of a move sits in the same server, so such a move reads short. */
export function placeName(label: string, other: string | null | undefined): string {
    const cut = label.lastIndexOf(" · ");
    const otherCut = other?.lastIndexOf(" · ") ?? -1;
    const sameServer = cut > 0 && otherCut > 0 && label.slice(cut) === other!.slice(otherCut);

    return sameServer ? label.slice(0, cut) : label;
}
