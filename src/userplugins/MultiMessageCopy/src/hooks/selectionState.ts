// Shared mutable state for the selection session.
// Using module-level variables mirrors the original index.tsx approach,
// keeping the exact same runtime behaviour.

import { Message } from "../types"

export let isSelectionMode = false

// KEY CHANGE: selectedMessages is now a Map<messageId, Message> instead of
// Set<string>. The full Message object is captured at selection time while it
// is still present in MessageStore. This means the data survives Discord
// virtualising/evicting messages from its cache when the user scrolls away.
//
// API compatibility: callers that only need to check membership can use
//   selectedMessages.has(id)
// Callers that need the count use
//   selectedMessages.size
// Callers that need to iterate use
//   Array.from(selectedMessages.values())
export const selectedMessages = new Map<string, Message>()

export let currentChannelId = ""
export let observer: MutationObserver | null = null
export let keyboardListener: ((e: KeyboardEvent) => void) | null = null
export let selectionStarted = false

export function setIsSelectionMode(value: boolean): void {
  isSelectionMode = value
}

export function setCurrentChannelId(value: string): void {
  currentChannelId = value
}

export function setObserver(value: MutationObserver | null): void {
  observer = value
}

export function setKeyboardListener(
  value: ((e: KeyboardEvent) => void) | null,
): void {
  keyboardListener = value
}

export function setSelectionStarted(value: boolean): void {
  selectionStarted = value
}
