import {
  selectedMessages,
  isSelectionMode,
} from "../hooks/selectionState"
// selectedMessages is now Map<string, Message> — .has() / .size still work
// identically so no logic changes are required in this file.
import { isSystemMessageElement } from "../utils/domHelpers"
import { MESSAGE_SELECTOR } from "../constants"

// Forward-declared – filled in by selectionManager to avoid circular imports
let _toggleMessageSelection: (id: string) => void = () => {}
export function registerToggleMessageSelection(fn: (id: string) => void): void {
  _toggleMessageSelection = fn
}

// ─── Delegated click handler ─────────────────────────────────────────────────
// One listener on the document handles ALL checkbox clicks. This means we never
// add/remove per-element click listeners, which eliminates duplicate-handler bugs
// and prevents listener accumulation across mode toggles.

let _delegatedClickHandler: ((e: MouseEvent) => void) | null = null

export function attachDelegatedClickHandler(): void {
  if (_delegatedClickHandler) return // already attached

  _delegatedClickHandler = (e: MouseEvent) => {
    if (!isSelectionMode) return

    const target = e.target as Element
    const container = target.closest("[data-mmc-message-id]")
    if (!container) return

    const messageId = container.getAttribute("data-mmc-message-id")
    if (!messageId) return

    e.stopPropagation()
    _toggleMessageSelection(messageId)
  }

  document.addEventListener("click", _delegatedClickHandler, true)
}

export function detachDelegatedClickHandler(): void {
  if (_delegatedClickHandler) {
    document.removeEventListener("click", _delegatedClickHandler, true)
    _delegatedClickHandler = null
  }
}

// ─── Keyboard handler for focused checkboxes ─────────────────────────────────

let _delegatedKeydownHandler: ((e: KeyboardEvent) => void) | null = null

export function attachDelegatedKeydownHandler(): void {
  if (_delegatedKeydownHandler) return

  _delegatedKeydownHandler = (e: KeyboardEvent) => {
    if (!isSelectionMode) return
    if (e.key !== "Enter" && e.key !== " ") return

    const active = document.activeElement
    if (!active) return

    const container = active.closest("[data-mmc-message-id]")
    if (!container) return

    const messageId = container.getAttribute("data-mmc-message-id")
    if (!messageId) return

    e.preventDefault()
    _toggleMessageSelection(messageId)
  }

  document.addEventListener("keydown", _delegatedKeydownHandler, true)
}

export function detachDelegatedKeydownHandler(): void {
  if (_delegatedKeydownHandler) {
    document.removeEventListener("keydown", _delegatedKeydownHandler, true)
    _delegatedKeydownHandler = null
  }
}

// ─── Checkbox creation ───────────────────────────────────────────────────────

export function addCheckboxesToMessages(): void {
  const messageElements = document.querySelectorAll(MESSAGE_SELECTOR)

  messageElements.forEach((messageElement) => {
    // Skip if already has a checkbox
    if (messageElement.querySelector("[data-mmc-message-id]")) return

    const messageId = messageElement.id.split("-").pop()
    if (!messageId) return

    if (isSystemMessageElement(messageElement)) return

    // Mark message row — no padding change, position: relative is sufficient
    messageElement.classList.add("mmc-message-container", "mmc-selection-mode")

    // Checkbox container — stable, always visible in selection mode
    const checkboxContainer = document.createElement("div")
    checkboxContainer.className = "mmc-checkbox-container"
    checkboxContainer.setAttribute("role", "checkbox")
    checkboxContainer.setAttribute("aria-checked", "false")
    checkboxContainer.setAttribute("tabindex", "0")
    // Data attribute used by delegated handlers — no per-element listeners needed
    checkboxContainer.setAttribute("data-mmc-message-id", messageId)
    checkboxContainer.setAttribute("data-mmc-selectable", "true")

    const checkbox = document.createElement("div")
    checkbox.className = "mmc-checkbox"
    // Inner decoration is pointer-events:none so it never steals the click
    checkbox.style.pointerEvents = "none"

    const checkmark = document.createElement("div")
    checkmark.className = "mmc-checkmark"
    checkmark.style.pointerEvents = "none"
    checkmark.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z" fill="white"/></svg>`

    checkbox.appendChild(checkmark)
    checkboxContainer.appendChild(checkbox)

    messageElement.appendChild(checkboxContainer)
  })
}

// ─── State sync ──────────────────────────────────────────────────────────────

export function updateCheckboxStates(): void {
  document.querySelectorAll("[data-mmc-message-id]").forEach((container) => {
    const messageId = container.getAttribute("data-mmc-message-id")
    if (!messageId) return

    const messageElement = container.closest(".mmc-message-container")
    const checkbox = container.querySelector(".mmc-checkbox")
    const checkmark = container.querySelector(".mmc-checkmark")
    const isSelected = selectedMessages.has(messageId)

    container.setAttribute("aria-checked", String(isSelected))

    if (isSelected) {
      checkbox?.classList.add("mmc-checked")
      checkmark?.classList.add("mmc-visible")
      messageElement?.classList.add("mmc-selected")
    } else {
      checkbox?.classList.remove("mmc-checked")
      checkmark?.classList.remove("mmc-visible")
      messageElement?.classList.remove("mmc-selected")
    }
  })
}

// ─── Cleanup ─────────────────────────────────────────────────────────────────

export function cleanupMessageModifications(): void {
  // Remove selection classes from message rows
  document.querySelectorAll(".mmc-message-container").forEach((container) => {
    container.classList.remove(
      "mmc-message-container",
      "mmc-selection-mode",
      "mmc-selected",
      "mmc-hover",
    )
    const el = container as HTMLElement
    el.style.paddingLeft = ""
    el.style.background = ""
    el.style.borderLeft = ""
    el.style.borderRadius = ""
    el.style.transition = ""
    el.style.position = ""
  })

  // Remove all checkbox DOM nodes (with exit animation)
  document.querySelectorAll("[data-mmc-message-id]").forEach((checkbox) => {
    checkbox.classList.add("mmc-hiding")
    setTimeout(() => checkbox.remove(), 250)
  })

  // Detach delegated handlers
  detachDelegatedClickHandler()
  detachDelegatedKeydownHandler()
}
