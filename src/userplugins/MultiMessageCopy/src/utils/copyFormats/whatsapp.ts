/**
 * copyFormats/whatsapp.ts
 *
 * WhatsApp-style format: [DD.MM.YYYY, HH:mm:ss] User: message
 */

import type { Message } from "../../types"
import {
  displayName, formatTs, buildMediaSuffix,
  authorIdSuffix, messageLinkSuffix, readCopyOptions,
} from "./helpers"

export function formatWhatsApp(msg: Message): string {
  const opts    = readCopyOptions()
  const name    = displayName(msg) + authorIdSuffix(msg, opts)
  const content = msg.content || ""
  const media   = buildMediaSuffix(msg, opts)
  const link    = messageLinkSuffix(msg, opts)

  if (opts.includeTimestamps) {
    const ts = formatTs(msg, "DD.MM.YYYY, HH:mm:ss")
    return `[${ts}] ${name}: ${content}${media}${link}`
  }
  return `${name}: ${content}${media}${link}`
}
