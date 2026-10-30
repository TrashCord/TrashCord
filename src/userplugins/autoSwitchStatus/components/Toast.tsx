/*
 * TrashCord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Text } from "@components/Text";
import { findByPropsLazy, findComponentByCodeLazy } from "@webpack";

const StatusIcon = findComponentByCodeLazy(".ONLINE&&", ".mask");
const ToastClasses = findByPropsLazy("toast", "content");

export function Toast({ message, status, size }: { message: string; status: string; size: number; }) {
    return (
        <div className={`${ToastClasses.toast}`}>
            <StatusIcon status={status} size={size} className={`${ToastClasses.icon}`} />
            <Text size="md" weight="normal">{message}</Text>
        </div>
    );
}
