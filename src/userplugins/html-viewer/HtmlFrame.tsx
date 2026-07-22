/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { useMemo } from "@webpack/common";

import { FULLVIEW_CSP, hardenHtml, LOCKED_CSP } from "./harden";

// Containment lives here. sandbox="allow-scripts" and NOTHING else: adding
// allow-same-origin would let the frame delete its own sandbox and read
// Discord's token. That holds in BOTH modes below — and BOTH inject a CSP, so
// neither is ever fully open.
//
//   "locked" (default) — inline glance: no network at all.
//   "full"             — Full view: CDN script/style/img/font render, but
//                        connect-src 'none' blocks fetch/XHR/WebSocket/beacon.
export function HtmlFrame({ html, className, mode = "locked" }: { html: string; className?: string; mode?: "locked" | "full"; }) {
    const srcDoc = useMemo(
        () => hardenHtml(html, mode === "full" ? FULLVIEW_CSP : LOCKED_CSP),
        [html, mode]
    );

    return (
        <iframe
            className={className}
            sandbox="allow-scripts"
            allow=""
            referrerPolicy="no-referrer"
            srcDoc={srcDoc}
        />
    );
}
