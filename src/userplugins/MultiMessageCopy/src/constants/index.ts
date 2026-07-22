export const MEDIA_EXTENSIONS_REGEX = /\.(jpg|jpeg|png|gif|webp|mp4|mov|avi|webm)$/i

export const SOUND_FREQUENCIES: Record<string, number> = {
  select: 800,
  deselect: 600,
  copy: 1000,
  error: 300,
  enter: 900,
  exit: 700,
}

export const MESSAGE_SELECTOR =
  '[id^="chat-messages-"][id*="-"]:not([class*="systemMessage"]):not([class*="divider"]):not([class*="welcomeMessage"])'

export const CHAT_CONTAINER_SELECTOR = '[data-list-id="chat-messages"]'

export const ELEMENTS_TO_REMOVE_ON_EXIT = [
  ".mmc-toolbar",
  ".mmc-counter",
  ".mmc-overlay",
  ".mmc-selection-overlay",
  ".mmc-keyboard-hints",
]
