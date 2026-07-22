/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/* Tiny inline SVGs, fill/stroke: currentColor so they inherit button text color. */

const box = { className: "vc-hv-icon", viewBox: "0 0 24 24", width: 16, height: 16, "aria-hidden": true } as const;

export function RenderIcon() {
    return (
        <svg {...box} fill="currentColor">
            <path d="M12 5c-5 0-9 4.2-10 7 1 2.8 5 7 10 7s9-4.2 10-7c-1-2.8-5-7-10-7zm0 11.5A4.5 4.5 0 1112 7.5a4.5 4.5 0 010 9zm0-2.2a2.3 2.3 0 100-4.6 2.3 2.3 0 000 4.6z" />
        </svg>
    );
}

export function ExpandIcon() {
    return (
        <svg {...box} fill="currentColor">
            <path d="M4 4h6V2H2v8h2V4zm16 0v6h2V2h-8v2h6zM4 14H2v8h8v-2H4v-6zm18 0h-2v6h-6v2h8v-8z" />
        </svg>
    );
}

export function DownloadIcon() {
    return (
        <svg {...box} fill="currentColor">
            <path d="M13 3h-2v9H7.5l4.5 4.5L16.5 12H13V3zM5 19h14v2H5v-2z" />
        </svg>
    );
}

export function CollapseIcon() {
    return (
        <svg {...box} fill="currentColor">
            <path d="M12 8.4l6 6L16.6 16 12 11.2 7.4 16 6 14.4z" />
        </svg>
    );
}

export function UserIcon() {
    return (
        <svg {...box} fill="currentColor">
            <path d="M12 12a5 5 0 100-10 5 5 0 000 10zm0 2c-5 0-9 2.5-9 5.5V22h18v-2.5c0-3-4-5.5-9-5.5z" />
        </svg>
    );
}

export function ServerIcon() {
    return (
        <svg {...box} fill="currentColor">
            <path d="M9.5 3L8 8H4l-.5 2h4l-1 5H2.5L2 17h4l-1 4h2l1-4h4l-1 4h2l1-4h4l.5-2h-4l1-5h4.5l.5-2h-4l1-5h-2l-1 5H10l1-5H9.5zm.1 7h4l-1 5h-4l1-5z" />
        </svg>
    );
}
