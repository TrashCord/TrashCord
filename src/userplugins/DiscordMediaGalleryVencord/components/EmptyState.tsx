/*
 * TrashCord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { HeadingSecondary } from "@components/Heading";
import { Paragraph } from "@components/Paragraph";

interface EmptyStateProps {
    title?: string;
    message?: string;
}

export function EmptyState({
    title = "No media found",
    message = "This channel doesn't contain any supported images, videos or GIFs."
}: EmptyStateProps) {
    return (
        <div className="vc-mg-empty">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="currentColor" opacity={0.4}>
                <path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z" />
            </svg>
            <HeadingSecondary>{title}</HeadingSecondary>
            <Paragraph>{message}</Paragraph>
        </div>
    );
}
