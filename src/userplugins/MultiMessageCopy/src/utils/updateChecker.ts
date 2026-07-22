/**
 * updateChecker.ts
 *
 * Safe, non-blocking update detection for MultiMessageCopy.
 * Pure logic -- no JSX. All UI lives in src/components/UpdateModal.tsx.
 *
 * Behaviour:
 *   - Compares remote version.json against the compiled PLUGIN_VERSION constant.
 *   - On automatic check: shows modal if update found; silent on failure / up-to-date.
 *   - On manual check: always gives visible feedback (modal or toast).
 *   - Renderer fetch first; native fallback if available.
 *   - Manual checks always bypass cache via ?t= query param.
 *   - Dismissed versions are remembered per-version in localStorage.
 */

import { openModal } from "@utils/modal"
import { PluginNative } from "@utils/types"
import { React } from "@webpack/common"
import { showToast, Toasts } from "@webpack/common"
import { UpdateModal } from "../components/UpdateModal"

// ---------------------------------------------------------------------------
// Typed native helper accessor
// ---------------------------------------------------------------------------

// Import only the type — never the value. The actual module runs in the main
// process; importing it at runtime in the renderer would crash.
type NativeExports = typeof import("../../native")

// PluginNative<T> strips the leading IpcMainInvokeEvent parameter from each
// export and returns a renderer-callable async function.
type MMCNative = PluginNative<NativeExports>

/**
 * Returns the typed native helper proxy, or null if:
 *   - We are running in a web build of Vencord (no VencordNative at all)
 *   - The plugin was not loaded from a folder with a native.ts counterpart
 *   - The Vencord version pre-dates the pluginHelpers API
 */
function getNative(): MMCNative | null {
    try {
        const h = (window as any).VencordNative?.pluginHelpers?.MultiMessageCopy
        if (h == null) return null
        // Sanity-check: the method we rely on must exist.
        if (typeof h.fetchVersionJson !== "function") return null
        return h as MMCNative
    } catch {
        return null
    }
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const PLUGIN_VERSION = "5.4.4"

export const REPO_URL = "https://github.com/tsx-awtns/MultiMessageCopy"

export const UPDATE_COMMAND =
    'iwr -UseB https://raw.githubusercontent.com/tsx-awtns/MultiMessageCopy/main/update.ps1' +
    ' -OutFile "$env:TEMP\\mmc-update.ps1"; powershell -ExecutionPolicy Bypass' +
    ' -File "$env:TEMP\\mmc-update.ps1"'

const VERSION_URL =
    "https://raw.githubusercontent.com/tsx-awtns/MultiMessageCopy/main/version.json"

const DISMISSED_UPDATE_KEY = "MultiMessageCopy:dismissedUpdateVersion"

const FETCH_TIMEOUT_MS = 8000

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RemoteVersionInfo {
    name: string
    version: string
    repo: string
    latestRelease: string
    setupUrl: string
    updateUrl: string
    uninstallUrl: string
    changelog?: string
}

type FetchSource = "renderer" | "native" | "failed"

interface FetchResult {
    info: RemoteVersionInfo | null
    source: FetchSource
}

// ---------------------------------------------------------------------------
// Semver comparison
// ---------------------------------------------------------------------------

/**
 * Returns true if `remote` is strictly newer than `local`.
 * Strips a leading "v" from both before comparing.
 */
export function isNewerVersion(remote: string, local: string): boolean {
    try {
        const clean = (v: string) => v.replace(/^v/, "").trim()
        const parse = (v: string) => clean(v).split(".").map(n => {
            const num = parseInt(n, 10)
            return isNaN(num) ? 0 : num
        })
        const [rMaj, rMin, rPatch] = parse(remote)
        const [lMaj, lMin, lPatch] = parse(local)
        if (rMaj !== lMaj) return rMaj > lMaj
        if (rMin !== lMin) return rMin > lMin
        return rPatch > lPatch
    } catch {
        return false
    }
}

// ---------------------------------------------------------------------------
// localStorage helpers
// ---------------------------------------------------------------------------

function getDismissedVersion(): string | null {
    try {
        return localStorage.getItem(DISMISSED_UPDATE_KEY)
    } catch {
        return null
    }
}

function setDismissedVersion(version: string): void {
    try {
        localStorage.setItem(DISMISSED_UPDATE_KEY, version)
    } catch {}
}

// ---------------------------------------------------------------------------
// Fetch helpers
// ---------------------------------------------------------------------------

async function fetchWithTimeout(url: string, ms: number): Promise<Response> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), ms)
    try {
        return await fetch(url, { signal: controller.signal, cache: "no-store" })
    } finally {
        clearTimeout(timer)
    }
}

async function parseVersionJson(res: Response): Promise<RemoteVersionInfo | null> {
    if (!res.ok) return null
    try {
        const json = await res.json()
        // Minimal validation
        if (typeof json.version !== "string") return null
        return json as RemoteVersionInfo
    } catch {
        return null
    }
}

/**
 * Try to fetch version.json via the renderer.
 * Manual checks add a cache-busting query param.
 */
async function rendererFetch(cacheBust: boolean): Promise<RemoteVersionInfo | null> {
    try {
        const url = cacheBust ? `${VERSION_URL}?t=${Date.now()}` : VERSION_URL
        const res = await fetchWithTimeout(url, FETCH_TIMEOUT_MS)
        return await parseVersionJson(res)
    } catch {
        return null
    }
}

/**
 * Try to fetch version.json via the typed native helper (Electron main
 * process). Falls back gracefully to null if the helper is unavailable
 * (web build, old Vencord, or plugin loaded without native.ts).
 *
 * The native layer returns `{ ok, value | error }` — we unwrap that here so
 * callers only see `RemoteVersionInfo | null`.
 */
async function nativeFetch(cacheBust: boolean): Promise<RemoteVersionInfo | null> {
    try {
        const native = getNative()
        if (!native) return null

        const result = await native.fetchVersionJson(cacheBust)

        // The native module wraps responses in NativeResult<T>
        if (!result || !result.ok) {
            if (!result.ok) {
                console.warn(
                    "[MultiMessageCopy] Native fetch failed:",
                    (result as { ok: false; error: string }).error
                )
            }
            return null
        }

        const info = result.value
        if (typeof info?.version !== "string") return null
        return info
    } catch {
        return null
    }
}

/**
 * Fetch remote version.json, trying renderer fetch first then native IPC
 * fallback. The native path is useful when Discord's CSP blocks the renderer
 * request on certain guild pages or in fullscreen video.
 */
async function fetchRemoteVersion(cacheBust: boolean): Promise<FetchResult> {
    const renderer = await rendererFetch(cacheBust)
    if (renderer) return { info: renderer, source: "renderer" }

    const native = await nativeFetch(cacheBust)
    if (native) return { info: native, source: "native" }

    return { info: null, source: "failed" }
}

// ---------------------------------------------------------------------------
// Toast helpers
// ---------------------------------------------------------------------------

function toast(msg: string, type: "success" | "failure" | "message") {
    try {
        const toastType = type === "success"
            ? Toasts.Type.SUCCESS
            : type === "failure"
                ? Toasts.Type.FAILURE
                : Toasts.Type.MESSAGE
        showToast(msg, toastType)
    } catch {
        // Toasts API might not be available in all Vencord versions — fail silently.
        console.info(`[MultiMessageCopy] ${msg}`)
    }
}

// ---------------------------------------------------------------------------
// Core check logic
// ---------------------------------------------------------------------------

async function runCheck(force: boolean): Promise<void> {
    const { info: remote, source } = await fetchRemoteVersion(force)

    if (!remote) {
        if (force) {
            toast("Could not check for updates. Check your connection.", "failure")
        } else {
            console.warn("[MultiMessageCopy] Automatic update check failed: could not reach version.json")
        }
        return
    }

    // Always compare against the compiled constant — not installed-version.json,
    // which can be stale or missing if the user has never run the updater.
    const localVersion = PLUGIN_VERSION

    const hasUpdate = isNewerVersion(remote.version, localVersion)

    if (!hasUpdate) {
        if (force) {
            toast(`MultiMessageCopy is up to date. (v${localVersion})`, "success")
        } else {
            console.info(`[MultiMessageCopy] Up to date (v${localVersion}).`)
        }
        return
    }

    // Automatic check: respect dismissed state.
    // Manual check: always show the modal (ignore dismissed).
    const dismissed = getDismissedVersion()
    if (!force && dismissed === remote.version) return

    openModal(props =>
        React.createElement(UpdateModal, {
            remoteInfo: remote,
            installedVersion: localVersion,
            modalProps: props,
            onDismiss: () => {
                setDismissedVersion(remote.version)
                props.onClose()
            },
        })
    )
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function checkForUpdates(
    checkEnabled: boolean,
    notifyEnabled: boolean
): Promise<void> {
    if (!checkEnabled || !notifyEnabled) return
    // Delay slightly so the plugin fully starts before the network call.
    setTimeout(() => runCheck(false).catch(() => {}), 3000)
}

export async function checkForUpdatesManual(): Promise<void> {
    toast("Checking for updates\u2026", "message")
    await runCheck(true)
}
