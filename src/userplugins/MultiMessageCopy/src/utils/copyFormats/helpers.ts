/**
 * copyFormats/helpers.ts
 *
 * Shared helpers for all copy-format modules.
 * No direct settings access here — callers pass options objects.
 */

import { moment } from "@webpack/common"
import type { Message } from "../../types"
import { MEDIA_EXTENSIONS_REGEX } from "../../constants"

// ─── Options collected from settings by callers ───────────────────────────────

export interface CopyOptions {
  dateFormat: string
  includeTimestamps: boolean
  includeAuthorIds: boolean
  includeAttachments: boolean
  includeEmbeds: boolean
  includeStickers: boolean
  includeMentionsAsText: boolean
  includeMessageLinks: boolean
}

// ─── Display name ─────────────────────────────────────────────────────────────

export function displayName(msg: Message): string {
  return msg.author.globalName || msg.author.username
}

// ─── Timestamp ────────────────────────────────────────────────────────────────

export function formatTs(msg: Message, fmt: string): string {
  try {
    return moment(msg.timestamp).format(fmt)
  } catch {
    return String(msg.timestamp ?? "")
  }
}

// ─── Media / attachment lines ─────────────────────────────────────────────────

export function collectAttachmentLines(msg: Message, opts: CopyOptions): string[] {
  const lines: string[] = []
  if (opts.includeAttachments && msg.attachments) {
    for (const att of msg.attachments) {
      if (
        att.content_type?.startsWith("image/") ||
        att.content_type?.startsWith("video/") ||
        att.filename?.match(MEDIA_EXTENSIONS_REGEX)
      ) {
        lines.push(`${att.filename}: ${att.url}`)
      }
    }
  }
  return lines
}

export function collectEmbedLines(msg: Message, opts: CopyOptions): string[] {
  const lines: string[] = []
  if (opts.includeEmbeds && msg.embeds) {
    for (const e of msg.embeds) {
      if (e.image?.url) lines.push(`Image: ${e.image.url}`)
      if (e.video?.url) lines.push(`Video: ${e.video.url}`)
    }
  }
  return lines
}

export function collectStickerLines(msg: Message, opts: CopyOptions): string[] {
  const lines: string[] = []
  if (opts.includeStickers && msg.stickerItems) {
    for (const s of msg.stickerItems) {
      lines.push(`[Sticker: ${s.name}]`)
    }
  }
  return lines
}

/** Collect all attachment/embed/sticker lines as a single suffix block. */
export function buildMediaSuffix(msg: Message, opts: CopyOptions): string {
  const att     = collectAttachmentLines(msg, opts)
  const emb     = collectEmbedLines(msg, opts)
  const stickers = collectStickerLines(msg, opts)
  const all     = [...att, ...emb, ...stickers]
  if (all.length === 0) return ""
  return "\n" + all.map(l => `    ${l}`).join("\n")
}

// ─── Author ID suffix ─────────────────────────────────────────────────────────

export function authorIdSuffix(msg: Message, opts: CopyOptions): string {
  return opts.includeAuthorIds ? ` (${msg.author.id})` : ""
}

// ─── Message link suffix ──────────────────────────────────────────────────────

export function messageLinkSuffix(msg: Message, opts: CopyOptions): string {
  if (!opts.includeMessageLinks) return ""
  const guildId = (msg as any).guild_id ?? "@me"
  return `\nhttps://discord.com/channels/${guildId}/${msg.channel_id}/${msg.id}`
}

// ─── Build CopyOptions from settings ─────────────────────────────────────────

/** Read current settings and return a CopyOptions bag. Import lazily to avoid circular deps. */
export function readCopyOptions(): CopyOptions {
  const s = require("../../settings").default.store
  return {
    dateFormat:           s.dateFormat          ?? "DD.MM.YYYY, HH:mm:ss",
    includeTimestamps:    s.includeTimestamps    ?? true,
    includeAuthorIds:     s.includeAuthorIds     ?? false,
    includeAttachments:   s.includeAttachments   ?? true,
    includeEmbeds:        s.includeEmbeds        ?? true,
    includeStickers:      s.includeStickers      ?? true,
    includeMentionsAsText: s.includeMentionsAsText ?? true,
    includeMessageLinks:  s.includeMessageLinks  ?? false,
  }
}
