/*
 * TrashCord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

const MEDIA_PROXY_URL = "https://media.discordapp.net";
const CDN_URL = "cdn.discordapp.com";

export function formatBytes(bytes?: number): string {
    if (bytes === undefined || bytes === null || isNaN(bytes) || bytes < 0) {
        return "Unknown";
    }
    if (bytes === 0) return "0 B";

    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    const formatted = parseFloat((bytes / Math.pow(k, i)).toFixed(2));
    return `${formatted} ${sizes[i]}`;
}

export function sanitizeFilename(filename: string, fallback = "download"): string {
    if (!filename || typeof filename !== "string") return fallback;

    // Remove path traversal and illegal characters: / \ ? % * : | " < >
    let sanitized = filename
        .replace(/[\\/?:%*|"<>]/g, "_")
        .replace(/\.\.+/g, ".")
        .trim();

    if (!sanitized || sanitized === ".") {
        sanitized = fallback;
    }

    return sanitized;
}

export function fixMediaUrl(urlString: string): string {
    try {
        const url = new URL(urlString);
        if (url.host === CDN_URL) {
            return urlString;
        }

        url.searchParams.delete("width");
        url.searchParams.delete("height");

        if (url.origin === MEDIA_PROXY_URL) {
            url.host = CDN_URL;
            url.searchParams.delete("size");
            url.searchParams.delete("quality");
            url.searchParams.delete("format");
        }

        return url.toString();
    } catch {
        return urlString;
    }
}

export function getFilenameFromUrl(urlString: string, fallback = "media"): string {
    try {
        const { pathname } = new URL(urlString);
        const segments = pathname.split("/").filter(Boolean);
        const last = segments[segments.length - 1];
        if (last && last.includes(".")) {
            return sanitizeFilename(decodeURIComponent(last), fallback);
        }
    } catch {
        // Ignore parse error
    }
    return fallback;
}

export function formatDate(timestamp: number): string {
    if (!timestamp) return "";
    try {
        const date = new Date(timestamp);
        return date.toLocaleDateString(undefined, {
            year: "numeric",
            month: "short",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit"
        });
    } catch {
        return "";
    }
}
