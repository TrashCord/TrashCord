/*
 * TrashCord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { Message } from "../../types"
import {
  displayName, formatTs, readCopyOptions,
  collectAttachmentLines, collectEmbedLines, collectStickerLines,
} from "./helpers"

export function formatJson(msg: Message): string {
  const opts      = readCopyOptions()
  const name      = displayName(msg)
  const timestamp = opts.includeTimestamps ? formatTs(msg, opts.dateFormat) : undefined

  const obj: Record<string, unknown> = {
    author:  name,
    content: msg.content || "",
  }

  if (opts.includeAuthorIds) obj["author_id"] = msg.author.id
  if (timestamp)              obj["timestamp"] = timestamp

  const att = collectAttachmentLines(msg, opts)
  if (att.length > 0) obj["attachments"] = att

  const emb = collectEmbedLines(msg, opts)
  if (emb.length > 0) obj["embeds"] = emb

  const stk = collectStickerLines(msg, opts)
  if (stk.length > 0) obj["stickers"] = stk

  if (opts.includeMessageLinks) {
    const guildId = (msg as any).guild_id ?? "@me"
    obj["link"] = `https://discord.com/channels/${guildId}/${msg.channel_id}/${msg.id}`
  }

  return JSON.stringify(obj, null, 2)
}
