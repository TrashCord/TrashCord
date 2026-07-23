/**
 * copyFormats/plain.ts
 *
 * Plain format: [DD.MM.YYYY, HH:mm] User: message
 */

import type { Message } from "../../types"
import {
  displayName, formatTs, buildMediaSuffix,
  authorIdSuffix, messageLinkSuffix, readCopyOptions,
} from "./helpers"

export function formatPlain(msg: Message): string {
  const opts   = readCopyOptions()
  const name   = displayName(msg) + authorIdSuffix(msg, opts)
  const content = msg.content || ""
  const media  = buildMediaSuffix(msg, opts)
  const link   = messageLinkSuffix(msg, opts)

  if (opts.includeTimestamps) {
    const ts = formatTs(msg, opts.dateFormat)
    return `[${ts}] ${name}: ${content}${media}${link}`
  }
  return `${name}: ${content}${media}${link}`
}
