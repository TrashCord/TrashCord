export function isSystemMessageElement(messageElement: Element): boolean {
  return !!(
    messageElement.querySelector('[class*="systemMessage"]') ||
    messageElement.querySelector('[class*="welcomeMessage"]') ||
    messageElement.querySelector('[class*="divider"]') ||
    messageElement.querySelector('[class*="newMessagesBar"]') ||
    messageElement.textContent?.includes(
      "This is the beginning of your direct message history",
    ) ||
    messageElement.textContent?.includes("Mutual Servers") ||
    messageElement.querySelector('button[aria-label*="Add Friend"]') ||
    messageElement.querySelector('button[aria-label*="Block"]')
  )
}
