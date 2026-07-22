import { NotificationType } from "../types"

export function showNotification(
  message: string,
  type: NotificationType,
  icon = "",
): void {
  // Remove existing notifications of the same type
  document.querySelectorAll(`.mmc-notification.mmc-${type}`).forEach((n) => n.remove())

  const notification = document.createElement("div")
  notification.className = `mmc-notification mmc-${type}`
  notification.setAttribute("role", "alert")
  notification.setAttribute("aria-live", "polite")

  if (icon) {
    const iconSpan = document.createElement("span")
    iconSpan.className = "mmc-notification-icon"
    iconSpan.textContent = icon
    notification.appendChild(iconSpan)
  }

  const textSpan = document.createElement("span")
  textSpan.className = "mmc-notification-text"
  textSpan.textContent = message
  notification.appendChild(textSpan)

  const progressBar = document.createElement("div")
  progressBar.className = "mmc-progress"
  notification.appendChild(progressBar)

  const closeBtn = document.createElement("button")
  closeBtn.className = "mmc-notification-close"
  closeBtn.setAttribute("aria-label", "Close notification")
  closeBtn.innerHTML = `
    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
      <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12 19 6.41z"/>
    </svg>
  `
  notification.appendChild(closeBtn)
  document.body.appendChild(notification)

  const hideTimeout = setTimeout(() => {
    if (notification.parentNode) {
      notification.classList.add("mmc-hiding")
      setTimeout(() => {
        if (notification.parentNode) {
          notification.parentNode.removeChild(notification)
        }
      }, 300)
    }
  }, 5000)

  closeBtn.addEventListener("click", () => {
    clearTimeout(hideTimeout)
    notification.classList.add("mmc-hiding")
    setTimeout(() => notification.remove(), 300)
  })
}
