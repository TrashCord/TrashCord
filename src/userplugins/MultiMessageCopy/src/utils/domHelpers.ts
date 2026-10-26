/*
 * TrashCord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

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
