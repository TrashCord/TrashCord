/*
 * TrashCord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { IpcMainInvokeEvent } from "electron"
import * as https from "https"

// ---------------------------------------------------------------------------
// Types (duplicated from updateChecker.ts to avoid cross-process imports)
// ---------------------------------------------------------------------------

interface RemoteVersionInfo {
    name: string
    version: string
    repo: string
    latestRelease: string
    setupUrl: string
    updateUrl: string
    uninstallUrl: string
    changelog?: string
}

/** Wraps every native IPC response — mirrors Vencord's IpcRes<V> convention. */
type NativeResult<T> =
    | { ok: true;  value: T }
    | { ok: false; error: string }

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const VERSION_JSON_URL =
    "https://cdn.jsdelivr.net/gh/tsx-awtns/MultiMessageCopy@main/version.json"

/** Fetch a URL using Node's built-in https module, with a timeout. */
function httpsGet(url: string, timeoutMs = 8000): Promise<string> {
    return new Promise((resolve, reject) => {
        const req = https.get(url, { timeout: timeoutMs }, res => {
            // Follow one level of redirect (GitHub raw → fastly CDN).
            if (
                res.statusCode !== undefined &&
                res.statusCode >= 300 &&
                res.statusCode < 400 &&
                res.headers.location
            ) {
                httpsGet(res.headers.location, timeoutMs).then(resolve, reject)
                return
            }

            if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
                reject(new Error(`HTTP ${res.statusCode ?? "unknown"}`))
                return
            }

            const chunks: Buffer[] = []
            res.on("data", (chunk: Buffer) => chunks.push(chunk))
            res.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")))
            res.on("error", reject)
        })

        req.on("timeout", () => {
            req.destroy()
            reject(new Error(`Request timed out after ${timeoutMs}ms`))
        })

        req.on("error", reject)
    })
}

// ---------------------------------------------------------------------------
// Exported IPC handlers
// ---------------------------------------------------------------------------

/**
 * Fetch the remote version.json over Node's https stack (bypasses Discord's
 * renderer Content Security Policy). Returns the parsed JSON on success, or
 * `{ ok: false, error }` on any failure so the renderer can fall back to its
 * own fetch().
 *
 * The `cacheBust` flag appends a `?t=<timestamp>` parameter so manual checks
 * always get a fresh response from GitHub's CDN.
 */
export async function fetchVersionJson(
    _event: IpcMainInvokeEvent,
    cacheBust = false
): Promise<NativeResult<RemoteVersionInfo>> {
    try {
        const url = cacheBust ? `${VERSION_JSON_URL}?t=${Date.now()}` : VERSION_JSON_URL
        const body = await httpsGet(url)
        const json = JSON.parse(body)

        if (typeof json?.version !== "string") {
            return { ok: false, error: "version.json missing required 'version' field" }
        }

        return { ok: true, value: json as RemoteVersionInfo }
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err)
        return { ok: false, error: message }
    }
}


