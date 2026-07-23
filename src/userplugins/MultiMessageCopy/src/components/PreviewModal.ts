import { selectedMessages } from "../hooks/selectionState"
import { copyToClipboard } from "../utils/clipboard"

export function showPreviewModal(
  formattedMessages: string,
  onConfirm: () => void,
): void {
  const modal = document.createElement("div")
  modal.className = "mmc-preview-modal"

  const backdrop = document.createElement("div")
  backdrop.className = "mmc-modal-backdrop"

  const content = document.createElement("div")
  content.className = "mmc-modal-content"

  const header = document.createElement("div")
  header.className = "mmc-modal-header"
  header.innerHTML = `
    <h3>Preview Selected Messages (${selectedMessages.size})</h3>
    <button class="mmc-modal-close" aria-label="Close preview">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
        <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12 19 6.41z"/>
      </svg>
    </button>
  `

  const body = document.createElement("div")
  body.className = "mmc-modal-body"

  const preview = document.createElement("pre")
  preview.className = "mmc-preview-text"
  preview.textContent = formattedMessages

  const footer = document.createElement("div")
  footer.className = "mmc-modal-footer"
  footer.innerHTML = `
    <button class="mmc-btn mmc-btn-secondary mmc-modal-cancel">Cancel</button>
    <button class="mmc-btn mmc-btn-primary mmc-modal-confirm">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
        <path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/>
      </svg>
      Copy to Clipboard
    </button>
  `

  body.appendChild(preview)
  content.appendChild(header)
  content.appendChild(body)
  content.appendChild(footer)
  modal.appendChild(backdrop)
  modal.appendChild(content)
  document.body.appendChild(modal)

  const closeModal = () => {
    modal.classList.add("mmc-hiding")
    setTimeout(() => modal.remove(), 300)
  }

  backdrop.addEventListener("click", closeModal)
  header.querySelector(".mmc-modal-close")?.addEventListener("click", closeModal)
  footer.querySelector(".mmc-modal-cancel")?.addEventListener("click", closeModal)
  footer.querySelector(".mmc-modal-confirm")?.addEventListener("click", () => {
    copyToClipboard(formattedMessages, selectedMessages.size, onConfirm)
    closeModal()
  })

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      closeModal()
    } else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      copyToClipboard(formattedMessages, selectedMessages.size, onConfirm)
      closeModal()
    }
  }

  document.addEventListener("keydown", handleKeyDown)
  modal.addEventListener("remove", () => {
    document.removeEventListener("keydown", handleKeyDown)
  })
}
