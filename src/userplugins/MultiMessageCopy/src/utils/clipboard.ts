import { playSound } from "./sound"
import { showNotification } from "./notification"

// selectedMessages count is passed in to avoid circular deps with selectionState
export function fallbackCopyTextToClipboard(
  text: string,
  selectedCount: number,
  onSuccess: () => void,
): void {
  const textArea = document.createElement("textarea")
  textArea.value = text
  textArea.style.position = "fixed"
  textArea.style.left = "-999999px"
  textArea.style.top = "-999999px"
  document.body.appendChild(textArea)
  textArea.focus()
  textArea.select()

  try {
    document.execCommand("copy")
    playSound("copy")
    showNotification(`${selectedCount} messages copied successfully!`, "success", "✅")
    onSuccess()
  } catch (err) {
    console.error("Failed to copy messages:", err)
    playSound("error")
    showNotification("Failed to copy messages to clipboard", "error", "❌")
  }

  document.body.removeChild(textArea)
}

export function copyToClipboard(
  text: string,
  selectedCount: number,
  onSuccess: () => void,
): void {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard
        .writeText(text)
        .then(() => {
          playSound("copy")
          showNotification(
            `${selectedCount} messages copied successfully!`,
            "success",
            "✅",
          )
          onSuccess()
        })
        .catch(() => {
          fallbackCopyTextToClipboard(text, selectedCount, onSuccess)
        })
    } else {
      fallbackCopyTextToClipboard(text, selectedCount, onSuccess)
    }
  } catch {
    fallbackCopyTextToClipboard(text, selectedCount, onSuccess)
  }
}
