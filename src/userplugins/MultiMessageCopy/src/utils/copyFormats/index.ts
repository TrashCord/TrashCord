/**
 * copyFormats/index.ts
 *
 * Public entry point. Selects and runs the appropriate copy-format
 * function based on the current settings. All formatters are pure
 * functions that never touch the DOM or Discord internals.
 */

import settings from "../../settings"
import type { Message } from "../../types"
import { formatPlain }     from "./plain"
import { formatDiscord }   from "./discord"
import { formatWhatsApp }  from "./whatsapp"
import { formatMarkdown }  from "./markdown"
import { formatCompact }   from "./compact"
import { formatJson }      from "./json"

export type CopyFormat = "plain" | "discord" | "whatsapp" | "markdown" | "compact" | "json"

export type SeparatorStyle = "blank" | "line" | "compact"

/**
 * Format an array of messages using the currently selected copy format
 * and join them with the chosen separator.
 */
export function formatMessagesForCopy(messages: Message[]): string {
  const fmt          = (settings.store.copyFormat as CopyFormat) ?? "plain"
  const separator    = (settings.store.separatorStyle as SeparatorStyle) ?? "blank"

  const formatOne = pickFormatter(fmt)
  const formatted = messages.map(formatOne)

  // JSON format produces one JSON object per message; wrap in a valid array
  if (fmt === "json") {
    return `[\n${formatted.join(",\n")}\n]`
  }

  return joinWithSeparator(formatted, separator)
}

function pickFormatter(fmt: CopyFormat): (msg: Message) => string {
  switch (fmt) {
    case "discord":   return formatDiscord
    case "whatsapp":  return formatWhatsApp
    case "markdown":  return formatMarkdown
    case "compact":   return formatCompact
    case "json":      return formatJson
    case "plain":
    default:          return formatPlain
  }
}

function joinWithSeparator(lines: string[], style: SeparatorStyle): string {
  switch (style) {
    case "line":    return lines.join("\n---\n")
    case "compact": return lines.join("\n")
    case "blank":
    default:        return lines.join("\n\n")
  }
}

/** For JSON format, wrap all formatted lines as a valid JSON array. */
export function wrapJsonLines(lines: string[]): string {
  // Each line from formatJson is a JSON object string; wrap in array brackets.
  return `[\n${lines.join(",\n")}\n]`
}
