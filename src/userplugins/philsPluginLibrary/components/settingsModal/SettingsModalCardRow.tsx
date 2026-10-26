/*
 * TrashCord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { ComponentProps } from "react";

export interface SettingsModalRowProps extends Pick<ComponentProps<"div">,
    | "children"
    | "style"> {
    gap?: string;
}

export const SettingsModalCardRow = ({ children, style, gap }: SettingsModalRowProps) => {
    return (
        <div style={{ display: "inline-flex", gap: gap ?? "1em", ...style }}>{children}</div>
    );
};
