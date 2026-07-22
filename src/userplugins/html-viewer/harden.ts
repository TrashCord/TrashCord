/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/*
 * The sandbox hardening core. Under Legcord the main-frame CSP is deleted
 * (csp:"none"), so a srcdoc iframe inherits NO parent policy — the injected
 * <meta> CSP is the SOLE control over what a rendered artifact may do. It must
 * be the first child of <head> so it governs every later resource tag.
 *
 * Two policies (both verified by the html-viewer-core unit suite):
 *   LOCKED_CSP   — inline glance. Renders inline + data: + a curated allowlist of
 *                  well-known CDNs (fonts/styles/scripts), but connect-src 'none'
 *                  blocks fetch/XHR/WebSocket/beacon. No arbitrary hosts.
 *   FULLVIEW_CSP — Full view. Any https for script/style/img/font; connect-src
 *                  'none' still kills fetch-class egress. Small GET beacons via
 *                  sub-resource URLs remain (inherent to allowing arbitrary CDNs).
 */

// Curated asset CDNs, applied to script/style/font/img in the inline tier so
// common artifacts render without opening Full view. These serve arbitrary
// packages, so this does NOT constrain what code runs — containment still rests
// on connect-src 'none' + the opaque-origin sandbox. It bounds GET-beacon exfil
// to these hosts instead of anywhere.
export const TRUSTED_CDNS = [
    "https://cdn.jsdelivr.net",
    "https://unpkg.com",
    "https://cdnjs.cloudflare.com",
    "https://cdn.tailwindcss.com",
    "https://fonts.googleapis.com",
    "https://fonts.gstatic.com",
    "https://esm.sh"
];

const CDN = TRUSTED_CDNS.join(" ");
const DISCORD_MEDIA = "https://cdn.discordapp.com https://media.discordapp.net";

export const LOCKED_CSP = [
    "default-src 'none'",
    `script-src 'unsafe-inline' 'unsafe-eval' ${CDN}`,
    `style-src 'unsafe-inline' ${CDN}`,
    `img-src data: ${DISCORD_MEDIA} ${CDN}`,
    `font-src data: ${CDN}`,
    `media-src data: ${DISCORD_MEDIA}`,
    "connect-src 'none'",
    "form-action 'none'",
    "base-uri 'none'"
].join("; ");

export const FULLVIEW_CSP = [
    "default-src 'none'",
    "script-src 'unsafe-inline' 'unsafe-eval' https:",
    "style-src 'unsafe-inline' https:",
    "img-src data: https:",
    "font-src data: https:",
    "media-src data: https:",
    "connect-src 'none'",
    "form-action 'none'",
    "base-uri 'none'"
].join("; ");

function metaFor(csp: string): string {
    return `<meta http-equiv="Content-Security-Policy" content="${csp}">`;
}

const HEAD_OPEN = /<head\b[^>]*>/i;
const HTML_OPEN = /<html\b[^>]*>/i;

/**
 * Return `html` with `csp` guaranteed to be parsed before any resource-loading
 * tag. Insertion, in order of preference:
 *   1. immediately after an existing <head ...>
 *   2. a fresh <head> immediately after <html ...>
 *   3. wrap a bare fragment in a minimal document shell
 */
export function hardenHtml(html: string, csp: string = LOCKED_CSP): string {
    const raw = html ?? "";
    const META = metaFor(csp);

    const head = HEAD_OPEN.exec(raw);
    if (head) {
        const at = head.index + head[0].length;
        return raw.slice(0, at) + META + raw.slice(at);
    }

    const htmlTag = HTML_OPEN.exec(raw);
    if (htmlTag) {
        const at = htmlTag.index + htmlTag[0].length;
        return raw.slice(0, at) + `<head>${META}</head>` + raw.slice(at);
    }

    return `<!doctype html><html><head>${META}</head><body>${raw}</body></html>`;
}
