/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/* Attachment detection + external-reference sniffing. Pure, no Discord imports. */

interface AttachmentLike {
    filename?: string;
    content_type?: string;
}

/** True when an attachment is an HTML document we should offer to render. */
export function isHtmlAttachment(att: AttachmentLike | null | undefined): boolean {
    if (!att) return false;
    const type = (att.content_type ?? "").toLowerCase();
    if (type.split(";")[0].trim() === "text/html") return true;
    const name = (att.filename ?? "").toLowerCase();
    return name.endsWith(".html") || name.endsWith(".htm");
}

// Sub-resource references the locked preview CSP will block. Anchors (<a href>)
// are excluded — they load nothing. Only drives an advisory hint, so
// approximate matching is fine.
const EXTERNAL_PATTERNS: RegExp[] = [
    /<script\b[^>]*\bsrc\s*=\s*["']?\s*(?:https?:)?\/\//i,
    /<link\b[^>]*\bhref\s*=\s*["']?\s*(?:https?:)?\/\//i,
    /<img\b[^>]*\bsrc\s*=\s*["']?\s*(?:https?:)?\/\//i,
    /@import\s+(?:url\()?\s*["']?\s*(?:https?:)?\/\//i
];

/** True if the HTML pulls in any remote sub-resource (script/style/img/@import). */
export function hasExternalRefs(html: string): boolean {
    const raw = html ?? "";
    return EXTERNAL_PATTERNS.some(re => re.test(raw));
}

// Capture the URL out of a src=/href=/@import reference so we can test its host.
const REF_URL = /(?:<(?:script|img)\b[^>]*\bsrc|<link\b[^>]*\bhref)\s*=\s*["']?\s*((?:https?:)?\/\/[^"'\s>]+)/gi;
const IMPORT_URL = /@import\s+(?:url\()?\s*["']?\s*((?:https?:)?\/\/[^"')\s]+)/gi;

function collectRefUrls(html: string): string[] {
    const urls: string[] = [];
    for (const re of [REF_URL, IMPORT_URL]) {
        re.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = re.exec(html)) !== null) urls.push(m[1]);
    }
    return urls;
}

/**
 * True if the HTML references a remote sub-resource whose origin is NOT in
 * `trusted`. Those are the refs the inline (locked) CSP will block — so this
 * drives the "open Full view" hint now that the inline tier allows trusted CDNs.
 */
export function hasUntrustedRefs(html: string, trusted: string[]): boolean {
    return collectRefUrls(html ?? "").some(u => {
        const norm = u.startsWith("//") ? "https:" + u : u;
        return !trusted.some(t => norm.startsWith(t));
    });
}
