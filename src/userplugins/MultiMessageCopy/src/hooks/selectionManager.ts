import settings from "../settings"
import {
  isSelectionMode,
  selectedMessages,
  currentChannelId,
  observer,
  keyboardListener,
  selectionStarted,
  setIsSelectionMode,
  setCurrentChannelId,
  setObserver,
  setKeyboardListener,
  setSelectionStarted,
} from "./selectionState"
import { Message } from "../types"
import { playSound } from "../utils/sound"
import { showNotification } from "../utils/notification"
import { copyToClipboard } from "../utils/clipboard"
import { formatMessagesForCopy } from "../utils/copyFormats"
import { isSystemMessageElement } from "../utils/domHelpers"
import {
  addCheckboxesToMessages,
  updateCheckboxStates,
  cleanupMessageModifications,
  registerToggleMessageSelection,
  attachDelegatedClickHandler,
  attachDelegatedKeydownHandler,
} from "../components/CheckboxManager"
import {
  addControlButtons,
  addSelectionCounter,
  addKeyboardHints,
  updateSelectedCount,
  registerToolbarCallbacks,
} from "../components/Toolbar"
import { showPreviewModal } from "../components/PreviewModal"
import {
  MESSAGE_SELECTOR,
  CHAT_CONTAINER_SELECTOR,
  ELEMENTS_TO_REMOVE_ON_EXIT,
} from "../constants"
import { MessageStore } from "@webpack/common"

// ─── DOM observers ──────────────────────────────────────────────────────────

function startObservingMessages(): void {
  const chatContainer = document.querySelector(CHAT_CONTAINER_SELECTOR)
  if (!chatContainer) return

  // Throttle: only run addCheckboxesToMessages once per animation frame after a
  // batch of mutations. This prevents rapid re-runs during Discord's virtualised
  // scroll and was a secondary cause of the checkbox flicker.
  let rafPending = false

  const obs = new MutationObserver(() => {
    if (!isSelectionMode || rafPending) return
    rafPending = true
    requestAnimationFrame(() => {
      rafPending = false
      if (isSelectionMode) addCheckboxesToMessages()
    })
  })

  obs.observe(chatContainer, { childList: true, subtree: true })
  setObserver(obs)
}

function stopObservingMessages(): void {
  if (observer) {
    observer.disconnect()
    setObserver(null)
  }
}

// ─── Keyboard shortcuts ─────────────────────────────────────────────────────

function setupKeyboardShortcuts(): void {
  const listener = (e: KeyboardEvent) => {
    if (!isSelectionMode) return

    if (e.key === "Escape") {
      e.preventDefault()
      exitSelectionMode()
    } else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault()
      copySelectedMessages()
    } else if (e.key === "a" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault()
      selectAllMessages()
    } else if (e.key === "d" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault()
      deselectAllMessages()
    } else if (e.key === "i" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault()
      invertSelection()
    }
  }

  document.addEventListener("keydown", listener)
  setKeyboardListener(listener)
}

function removeKeyboardShortcuts(): void {
  if (keyboardListener) {
    document.removeEventListener("keydown", keyboardListener)
    setKeyboardListener(null)
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Look up a Message object for the given id.
 *
 * Priority:
 *   1. Already stored in persistent map (fastest, survives scroll eviction)
 *   2. MessageStore for the current channel (while message is still in cache)
 *   3. Synthetic fallback built from the DOM element (last resort)
 *
 * Returns null if the message cannot be found at all.
 */
function resolveMessage(messageId: string): Message | null {
  // 1. Already captured
  if (selectedMessages.has(messageId)) {
    return selectedMessages.get(messageId)!
  }

  // 2. MessageStore lookup — this works while the message is still cached
  try {
    const storeMessages = MessageStore.getMessages(currentChannelId)?._array as Message[] | undefined
    if (storeMessages) {
      const found = storeMessages.find((m: Message) => m.id === messageId)
      if (found) return found
    }
  } catch {
    // MessageStore unavailable — fall through
  }

  // 3. DOM fallback — extract what we can from the visible message element
  const el = document.getElementById(`chat-messages-${messageId}`)
    ?? document.querySelector(`[id$="-${messageId}"]`)
  if (el) {
    const authorEl = el.querySelector("[class*='username']") ?? el.querySelector("[class*='author']")
    const contentEl = el.querySelector("[id*='message-content']") ?? el.querySelector("[class*='messageContent']")
    const timestampEl = el.querySelector("time")
    return {
      id: messageId,
      channel_id: currentChannelId,
      content: contentEl?.textContent ?? "",
      timestamp: timestampEl?.getAttribute("datetime") ?? new Date().toISOString(),
      author: {
        id: "",
        username: authorEl?.textContent ?? "Unknown",
        globalName: undefined,
      },
    }
  }

  return null
}

/**
 * Sort messages in chronological order using Discord snowflake IDs.
 * Snowflakes embed the creation timestamp in the upper bits, so lexicographic
 * string sort is equivalent to chronological sort without BigInt arithmetic.
 */
function sortMessagesBySnowflake(messages: Message[]): Message[] {
  return [...messages].sort((a, b) => {
    // Snowflake IDs are numeric strings; comparing them as strings works
    // correctly as long as both have the same length (they always do for
    // Discord IDs). Use numeric comparison to be safe.
    const aId = BigInt(a.id)
    const bId = BigInt(b.id)
    return aId < bId ? -1 : aId > bId ? 1 : 0
  })
}

// ─── Selection actions ───────────────────────────────────────────────────────

export function toggleMessageSelection(messageId: string): void {
  const wasSelected = selectedMessages.has(messageId)

  if (wasSelected) {
    selectedMessages.delete(messageId)
    playSound("deselect")
  } else {
    // Capture the full message object NOW while it is still in the DOM /
    // MessageStore. This is the critical step that makes selection persist
    // across Discord's virtualised scroll.
    const message = resolveMessage(messageId)
    if (message) {
      selectedMessages.set(messageId, message)
    } else {
      // Store a minimal record so the ID is at least counted / shown
      selectedMessages.set(messageId, {
        id: messageId,
        channel_id: currentChannelId,
        content: "[Message content unavailable]",
        timestamp: new Date().toISOString(),
        author: { id: "", username: "Unknown" },
      })
    }
    playSound("select")
  }

  updateCheckboxStates()
  updateSelectedCount()

  const messageElement = document.getElementById(`chat-messages-${messageId}`)
  if (messageElement) {
    messageElement.style.transform = wasSelected ? "scale(0.98)" : "scale(1.02)"
    setTimeout(() => {
      messageElement.style.transform = "scale(1)"
    }, 150)
  }
}

export function selectAllMessages(): void {
  const messageElements = document.querySelectorAll(MESSAGE_SELECTOR)

  let addedCount = 0
  messageElements.forEach((messageElement) => {
    const messageId = messageElement.id.split("-").pop()
    if (!messageId) return
    if (isSystemMessageElement(messageElement)) return
    if (selectedMessages.has(messageId)) return // already selected

    const message = resolveMessage(messageId)
    if (message) {
      selectedMessages.set(messageId, message)
      addedCount++
    }
  })

  updateCheckboxStates()
  updateSelectedCount()
  playSound("select")
  showNotification(`Selected ${addedCount} messages`, "info", "📋")
}

export function deselectAllMessages(): void {
  const count = selectedMessages.size
  selectedMessages.clear()
  updateCheckboxStates()
  updateSelectedCount()

  document.querySelectorAll(".mmc-message-container").forEach((container) => {
    container.classList.remove("mmc-hover")
  })

  if (count > 0) {
    playSound("deselect")
    showNotification(`Deselected ${count} messages`, "info", "🗑️")
  }
}

export function invertSelection(): void {
  const messageElements = document.querySelectorAll(MESSAGE_SELECTOR)

  let changedCount = 0
  messageElements.forEach((messageElement) => {
    const messageId = messageElement.id.split("-").pop()
    if (!messageId) return
    if (isSystemMessageElement(messageElement)) return

    if (selectedMessages.has(messageId)) {
      selectedMessages.delete(messageId)
    } else {
      const message = resolveMessage(messageId)
      if (message) {
        selectedMessages.set(messageId, message)
      }
    }
    changedCount++
  })

  updateCheckboxStates()
  updateSelectedCount()
  showNotification(`Inverted selection for ${changedCount} messages`, "info", "🔄")
}

// ─── Copy ────────────────────────────────────────────────────────────────────

export function copySelectedMessages(): void {
  if (selectedMessages.size === 0) {
    playSound("error")
    showNotification("No messages selected!", "error", "⚠️")
    return
  }

  // Use the persistent Map — never touch MessageStore here.
  // Sort by snowflake ID to guarantee chronological order regardless of
  // which order messages were selected or in which direction the user scrolled.
  const sortedMessages    = sortMessagesBySnowflake(Array.from(selectedMessages.values()))
  const formattedMessages = formatMessagesForCopy(sortedMessages)

  if (settings.store.showPreview && selectedMessages.size > 1) {
    showPreviewModal(formattedMessages, exitSelectionMode)
  } else {
    copyToClipboard(formattedMessages, selectedMessages.size, exitSelectionMode)
  }
}

// ─── Enter / Exit ────────────────────────────────────────────────────────────

export function enterSelectionMode(channelId: string): void {
  setIsSelectionMode(true)
  setCurrentChannelId(channelId)
  // Clear the persistent map when entering a fresh selection session
  selectedMessages.clear()
  setSelectionStarted(true)

  playSound("enter")
  setupKeyboardShortcuts()
  document.body.setAttribute("data-animation-speed", settings.store.animationSpeed)

  const overlay = document.createElement("div")
  overlay.className = "mmc-selection-overlay"
  document.body.appendChild(overlay)

  showNotification(
    "Selection mode activated! Click messages to select them.",
    "info",
    "🎯",
  )

  // Attach a single delegated click/keydown handler for all checkboxes.
  // Must be done before addCheckboxesToMessages so created checkboxes are covered.
  attachDelegatedClickHandler()
  attachDelegatedKeydownHandler()

  setTimeout(() => {
    addCheckboxesToMessages()
    addControlButtons()
    addSelectionCounter()
    addKeyboardHints()
    startObservingMessages()
  }, 100)
}

export function exitSelectionMode(): void {
  setIsSelectionMode(false)
  // Clear the persistent map on explicit exit — this is the ONLY place it is
  // cleared (other than enterSelectionMode). Scroll, MutationObserver, DOM
  // recycling, and checkbox re-renders must NOT clear the map.
  selectedMessages.clear()
  setCurrentChannelId("")
  setSelectionStarted(false)

  playSound("exit")
  removeKeyboardShortcuts()
  stopObservingMessages()

  ELEMENTS_TO_REMOVE_ON_EXIT.forEach((selector) => {
    const element = document.querySelector(selector)
    if (element) {
      element.classList.add("mmc-hiding")
      setTimeout(() => element.remove(), 300)
    }
  })

  cleanupMessageModifications()
}

// ─── Wire up circular-dep callbacks ──────────────────────────────────────────

registerToggleMessageSelection(toggleMessageSelection)
registerToolbarCallbacks({
  copySelectedMessages,
  exitSelectionMode,
  selectAllMessages,
  deselectAllMessages,
  invertSelection,
})
