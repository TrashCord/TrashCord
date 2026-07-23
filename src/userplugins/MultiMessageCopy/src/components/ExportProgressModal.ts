/**
 * ExportProgressModal.ts
 *
 * Lightweight pure-DOM progress modal for the chat export feature.
 * Opened immediately when the user clicks "Export Chat", shows live
 * progress (phase, message count, elapsed time, format, warning),
 * and closes automatically when the export finishes or is cancelled.
 */

import type { CancelToken } from "../utils/exportChat"
import type { ExportProgressState } from "../types/export"

// ─── Internal state ───────────────────────────────────────────────────────────

let modalRoot: HTMLDivElement | null = null

const MAX_LOG_LINES = 6

const PHASE_LABELS: Record<string, string> = {
    fetching:    "Fetching messages",
    formatting:  "Formatting messages",
    building:    "Building file",
    downloading: "Downloading",
}

function fmtElapsed(sec: number): string {
    const m = Math.floor(sec / 60)
    const s = sec % 60
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
}

function fmtCount(n: number): string {
    return n.toLocaleString()
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Open the export progress modal. Returns an `update` function and a `close` function.
 * @param cancelToken  CancelToken that can stop the running export.
 * @param exportFormat Human-readable format string shown in the stats panel.
 */
export function openExportProgressModal(
    cancelToken: CancelToken,
    exportFormat?: string
): {
    update: (state: ExportProgressState) => void
    close: () => void
} {
    // Ensure only one instance
    closeExportProgressModal()

    // ── DOM scaffold ────────────────────────────────────────────────────────────
    const root = document.createElement("div")
    root.className = "mmc-export-modal"
    root.setAttribute("role", "dialog")
    root.setAttribute("aria-modal", "true")
    root.setAttribute("aria-label", "Exporting chat")

    // Backdrop
    const backdrop = document.createElement("div")
    backdrop.className = "mmc-modal-backdrop"
    backdrop.addEventListener("click", () => {
        if (!cancelToken.cancelled) {
            cancelToken.cancel()
            cancelBtn.disabled = true
            cancelBtn.textContent = "Cancelling\u2026"
        }
    })
    root.appendChild(backdrop)

    // Modal card
    const card = document.createElement("div")
    card.className = "mmc-export-modal-content"

    // ── Header ──────────────────────────────────────────────────────────────────
    const header = document.createElement("div")
    header.className = "mmc-export-modal-header"

    const title = document.createElement("h3")
    title.className = "mmc-export-modal-title"
    title.textContent = "Exporting chat"

    const subtitle = document.createElement("div")
    subtitle.className = "mmc-export-modal-subtitle"
    subtitle.textContent = "Preparing\u2026"

    header.appendChild(title)
    header.appendChild(subtitle)
    card.appendChild(header)

    // ── Body ────────────────────────────────────────────────────────────────────
    const body = document.createElement("div")
    body.className = "mmc-export-modal-body"

    // Phase label
    const phaseEl = document.createElement("div")
    phaseEl.className = "mmc-export-phase"
    phaseEl.style.display = "none"

    // Phase bar
    const barTrack = document.createElement("div")
    barTrack.className = "mmc-export-bar-track"
    const barFill = document.createElement("div")
    barFill.className = "mmc-export-bar-fill mmc-indeterminate"
    barTrack.appendChild(barFill)

    // Stats panel
    const statsEl = document.createElement("div")
    statsEl.className = "mmc-export-stats"

    function makeStatRow(label: string): { row: HTMLDivElement; valueEl: HTMLSpanElement } {
        const row = document.createElement("div")
        row.className = "mmc-export-stat-row"
        const labelEl = document.createElement("span")
        labelEl.className = "mmc-export-stat-label"
        labelEl.textContent = label
        const valueEl = document.createElement("span")
        valueEl.className = "mmc-export-stat-value"
        valueEl.textContent = "\u2014"
        row.appendChild(labelEl)
        row.appendChild(valueEl)
        return { row, valueEl }
    }

    const { row: rowFetched,  valueEl: valFetched  } = makeStatRow("Messages fetched:")
    const { row: rowFormatted, valueEl: valFormatted } = makeStatRow("Messages formatted:")
    const { row: rowElapsed,  valueEl: valElapsed  } = makeStatRow("Elapsed:")
    const { row: rowFormat,   valueEl: valFormat   } = makeStatRow("Format:")

    valFormat.textContent = exportFormat ? exportFormat.toUpperCase() : "\u2014"
    rowFormatted.style.display = "none" // hidden until formatting phase

    statsEl.appendChild(rowFetched)
    statsEl.appendChild(rowFormatted)
    statsEl.appendChild(rowElapsed)
    statsEl.appendChild(rowFormat)

    // Status text
    const statusEl = document.createElement("div")
    statusEl.className = "mmc-export-status"
    statusEl.textContent = "Starting\u2026"

    // Large-export warning
    const warningEl = document.createElement("div")
    warningEl.className = "mmc-export-warning"

    // Log
    const logEl = document.createElement("div")
    logEl.className = "mmc-export-progress-log"
    logEl.setAttribute("aria-live", "polite")
    logEl.setAttribute("aria-atomic", "false")

    const logLines: string[] = []

    body.appendChild(phaseEl)
    body.appendChild(barTrack)
    body.appendChild(statsEl)
    body.appendChild(statusEl)
    body.appendChild(warningEl)
    body.appendChild(logEl)
    card.appendChild(body)

    // ── Footer ──────────────────────────────────────────────────────────────────
    const footer = document.createElement("div")
    footer.className = "mmc-export-modal-footer"

    const cancelBtn = document.createElement("button")
    cancelBtn.className = "mmc-btn mmc-btn-cancel"
    cancelBtn.textContent = "Cancel"
    cancelBtn.addEventListener("click", () => {
        if (!cancelToken.cancelled) {
            cancelToken.cancel()
        }
        cancelBtn.disabled = true
        cancelBtn.textContent = "Cancelling\u2026"
    })

    footer.appendChild(cancelBtn)
    card.appendChild(footer)

    root.appendChild(card)
    document.body.appendChild(root)
    modalRoot = root

    requestAnimationFrame(() => cancelBtn.focus())

    // ── Update function ─────────────────────────────────────────────────────────

    function appendLog(text: string) {
        logLines.push(`${new Date().toLocaleTimeString()} \u2014 ${text}`)
        if (logLines.length > MAX_LOG_LINES) logLines.shift()
        logEl.textContent = logLines.join("\n")
        logEl.scrollTop = logEl.scrollHeight
    }

    function update(state: ExportProgressState) {
        // Subtitle / status text
        subtitle.textContent = state.statusText
        statusEl.textContent = state.statusText

        // Stats
        valFetched.textContent = fmtCount(state.fetched)
        if (state.elapsedSeconds != null) {
            valElapsed.textContent = fmtElapsed(state.elapsedSeconds)
        }
        if (state.totalMessages != null) {
            rowFormatted.style.display = ""
            valFormatted.textContent = `${fmtCount(state.fetched)} / ${fmtCount(state.totalMessages)}`
        } else {
            rowFormatted.style.display = "none"
        }

        // Phase label + indeterminate bar
        if (state.phase) {
            const label = PHASE_LABELS[state.phase] ?? state.phase
            const elapsed = state.elapsedSeconds != null ? ` \u00b7 ${fmtElapsed(state.elapsedSeconds)}` : ""
            phaseEl.textContent = `${label}${elapsed}`
            phaseEl.style.display = ""
        } else {
            phaseEl.style.display = "none"
        }

        // Large export warning — show once when status text contains keywords
        if (
            state.statusText.toLowerCase().includes("large export") ||
            state.statusText.toLowerCase().includes("very large")
        ) {
            warningEl.textContent = state.statusText
            warningEl.classList.add("mmc-visible")
        }

        // Log
        appendLog(state.statusText)

        // Terminal states
        if (state.status === "done") {
            title.textContent = "Export completed"
            subtitle.textContent = `${fmtCount(state.fetched)} messages exported`
            phaseEl.textContent = "Download started"
            phaseEl.style.display = ""
            barFill.classList.remove("mmc-indeterminate")
            barFill.style.width = "100%"
            cancelBtn.disabled = true
            cancelBtn.textContent = "Done"
            appendLog(`Exported ${fmtCount(state.fetched)} messages.`)
            setTimeout(() => close(), 2500)
        } else if (state.status === "error") {
            title.textContent = "Export failed"
            barFill.classList.remove("mmc-indeterminate")
            barFill.style.width = "0%"
            barFill.style.background = "var(--button-danger-background, #ed4245)"
            cancelBtn.textContent = "Close"
            cancelBtn.disabled = false
            cancelBtn.onclick = () => close()
        } else if (state.status === "cancelled") {
            title.textContent = "Export cancelled"
            subtitle.textContent = `Stopped after ${fmtCount(state.fetched)} messages`
            barFill.classList.remove("mmc-indeterminate")
            barFill.style.width = "0%"
            cancelBtn.textContent = "Close"
            cancelBtn.disabled = false
            cancelBtn.onclick = () => close()
        }
    }

    // ── Close function ──────────────────────────────────────────────────────────

    function close() {
        closeExportProgressModal()
    }

    return { update, close }
}

/** Close and remove the export progress modal if it is open. */
export function closeExportProgressModal(): void {
    if (modalRoot) {
        modalRoot.remove()
        modalRoot = null
    }
}
