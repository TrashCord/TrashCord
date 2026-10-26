/*
 * TrashCord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { Message } from "../../types"
import {
  displayName, formatTs, buildMediaSuffix,
  authorIdSuffix, messageLinkSuffix, readCopyOptions,
} from "./helpers"

export function formatDiscord(msg: Message): string {
  const opts    = readCopyOptions()
  const name    = displayName(msg) + authorIdSuffix(msg, opts)
  const content = msg.content || ""
  const media   = buildMediaSuffix(msg, opts)
  const link    = messageLinkSuffix(msg, opts)

  if (opts.includeTimestamps) {
    const ts = formatTs(msg, "DD.MM.YYYY HH:mm")
    return `${name} \u2014 ${ts}\n${content}${media}${link}`
  }
  return `${name}\n${content}${media}${link}`
}
