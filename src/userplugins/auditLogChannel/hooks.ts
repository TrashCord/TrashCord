/*
 * TrashCord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { GuildStore, PermissionsBits, PermissionStore, UserStore, useStateFromStores } from "@webpack/common";

export function useAuditLogPermission(guildId: string) {
    return useStateFromStores([GuildStore, UserStore, PermissionStore], () => PermissionStore.canWithPartialContext(PermissionsBits.VIEW_AUDIT_LOG, { guildId }), [guildId]);
}
