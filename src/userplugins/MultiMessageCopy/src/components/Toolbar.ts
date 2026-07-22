import { selectedMessages } from "../hooks/selectionState"

// Forward-declared – filled in by selectionManager to avoid circular imports
let _copySelectedMessages: () => void = () => {}
let _exitSelectionMode: () => void = () => {}
let _selectAllMessages: () => void = () => {}
let _deselectAllMessages: () => void = () => {}
let _invertSelection: () => void = () => {}

export function registerToolbarCallbacks(callbacks: {
  copySelectedMessages: () => void
  exitSelectionMode: () => void
  selectAllMessages: () => void
  deselectAllMessages: () => void
  invertSelection: () => void
}): void {
  _copySelectedMessages = callbacks.copySelectedMessages
  _exitSelectionMode = callbacks.exitSelectionMode
  _selectAllMessages = callbacks.selectAllMessages
  _deselectAllMessages = callbacks.deselectAllMessages
  _invertSelection = callbacks.invertSelection
}

export function addControlButtons(): void {
  if (document.querySelector(".mmc-toolbar")) return

  const toolbar = document.createElement("div")
  toolbar.className = "mmc-toolbar"
  toolbar.setAttribute("role", "toolbar")
  toolbar.setAttribute("aria-label", "Message selection controls")

  const buttons = [
    {
      id: "select-all",
      icon: `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
        <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z"/>
      </svg>`,
      text: "Select All",
      className: "mmc-btn-select",
      title: "Select all messages (Ctrl+A)",
      action: () => _selectAllMessages(),
    },
    {
      id: "invert",
      icon: `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
      </svg>`,
      text: "Invert",
      className: "mmc-btn-invert",
      title: "Invert selection (Ctrl+I)",
      action: () => _invertSelection(),
    },
    {
      id: "clear",
      icon: `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
        <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12 19 6.41z"/>
      </svg>`,
      text: "Clear",
      className: "mmc-btn-deselect",
      title: "Clear selection (Ctrl+D)",
      action: () => _deselectAllMessages(),
    },
    {
      id: "copy",
      icon: `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
        <path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/>
      </svg>`,
      text: "Copy (0)",
      className: "mmc-btn-copy",
      title: "Copy selected messages (Ctrl+Enter)",
      action: () => _copySelectedMessages(),
      disabled: true,
    },
  ]

  buttons.forEach((btn) => {
    const button = document.createElement("button")
    button.id = `mmc-${btn.id}`
    button.innerHTML = `${btn.icon} ${btn.text}`
    button.className = `mmc-btn ${btn.className}`
    button.title = btn.title
    button.disabled = btn.disabled ?? false
    button.addEventListener("click", btn.action)
    toolbar.appendChild(button)
  })

  const closeButton = document.createElement("button")
  closeButton.innerHTML = `
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
      <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12 19 6.41z"/>
    </svg>
  `
  closeButton.className = "mmc-btn mmc-btn-close"
  closeButton.title = "Exit selection mode (Escape)"
  closeButton.addEventListener("click", () => _exitSelectionMode())

  toolbar.appendChild(closeButton)
  document.body.appendChild(toolbar)
}

export function updateSelectedCount(): void {
  const copyButton = document.querySelector("#mmc-copy")
  const counter = document.querySelector(".mmc-counter span")

  if (copyButton) {
    copyButton.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
        <path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/>
      </svg>
      Copy (${selectedMessages.size})
    `
    const button = copyButton as HTMLButtonElement
    button.disabled = selectedMessages.size === 0
  }

  if (counter) {
    counter.textContent = `${selectedMessages.size} selected`
  }
}

export function addSelectionCounter(): void {
  if (document.querySelector(".mmc-counter")) return

  const counter = document.createElement("div")
  counter.className = "mmc-counter"
  counter.setAttribute("role", "status")
  counter.setAttribute("aria-live", "polite")
  counter.innerHTML = `
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
      <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z"/>
    </svg>
    <span>0 selected</span>
  `
  document.body.appendChild(counter)
}

export function addKeyboardHints(): void {
  if (document.querySelector(".mmc-keyboard-hints")) return

  const hints = document.createElement("div")
  hints.className = "mmc-keyboard-hints"
  hints.innerHTML = `
    <div class="mmc-hint-title">Keyboard Shortcuts</div>
    <div class="mmc-hint-item"><kbd>Ctrl+A</kbd> Select All</div>
    <div class="mmc-hint-item"><kbd>Ctrl+D</kbd> Clear Selection</div>
    <div class="mmc-hint-item"><kbd>Ctrl+I</kbd> Invert Selection</div>
    <div class="mmc-hint-item"><kbd>Ctrl+Enter</kbd> Copy Messages</div>
    <div class="mmc-hint-item"><kbd>Esc</kbd> Exit Mode</div>
  `
  document.body.appendChild(hints)

  setTimeout(() => {
    if (hints.parentNode) {
      hints.classList.add("mmc-hiding")
      setTimeout(() => hints.remove(), 300)
    }
  }, 5000)
}
