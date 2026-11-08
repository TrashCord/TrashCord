/*
 * TrashCord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/** The recent tab lists everybody, pinned or not, by when they were last seen. */
export function recentTabUsers<T extends { lastSeen: number; }>(pinned: T[], recent: T[]): T[] {
    return [...pinned, ...recent].sort((a, b) => b.lastSeen - a.lastSeen);
}

/** Pinned rows keep the order you gave them, since the column beside the list shows who is with you. */
export function inTabOrder<T extends { id: string; }>(users: T[], tab: "pinned" | "recent", isWithMe: (id: string) => boolean): T[] {
    if (tab === "pinned") return users;

    const withMe = users.filter(user => isWithMe(user.id));
    return withMe.length ? [...withMe, ...users.filter(user => !isWithMe(user.id))] : users;
}
