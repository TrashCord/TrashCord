/**
 * htmlExport/messages.ts
 *
 * Single-message rendering with stable two-column layout (avatar-slot +
 * message-main), reply previews, and proper grouped-message support.
 * No negative margins, no layout tricks that cause embed misalignment.
 */

import type { ExportMessage } from "../../types/export"
import { escapeAttribute, escapeHtml, formatTimestamp } from "./safety"
import { type ParticipantMap, buildParticipantStats, renderAvatar } from "./users"
import {
  collectSuppressedUrls,
  extractDirectMediaLinks,
  renderMessageContent,
} from "./content"
import { renderAttachments, renderDiscordCdnMediaLinks, renderStickers } from "./media"
import { renderEmbeds } from "./embeds"

// ─── Grouping logic ───────────────────────────────────────────────────────────

/**
 * A message is "grouped" with the previous one when:
 *   - Same author
 *   - No reply reference on this message
 *   - Within 7 minutes of the previous message
 */
function isGrouped(msg: ExportMessage, prev: ExportMessage | null): boolean {
  if (!prev) return false
  if (msg.author_id !== prev.author_id) return false
  if (msg.referenced_message) return false
  try {
    const diff =
      new Date(msg.timestamp).getTime() - new Date(prev.timestamp).getTime()
    return diff < 7 * 60 * 1000
  } catch {
    return false
  }
}

// ─── Reply preview ────────────────────────────────────────────────────────────

function renderReplyPreview(msg: ExportMessage): string {
  if (!msg.referenced_message?.message_id) return ""
  const refId = escapeAttribute(msg.referenced_message.message_id)
  return (
    `<div class="reply-preview">` +
    `<svg class="reply-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 14 4 9 9 4"/><path d="M20 20v-7a4 4 0 0 0-4-4H4"/></svg>` +
    `<a class="reply-text link" href="#msg-${refId}">Replying to message ${escapeHtml(msg.referenced_message.message_id)}</a>` +
    `</div>`
  )
}

// ─── Single message ───────────────────────────────────────────────────────────

/**
 * Render a single message using a stable two-column layout:
 *
 *   <article class="message [grouped]">
 *     <div class="avatar-slot">       ← fixed 40px column (avatar or blank space)
 *     <div class="message-main">      ← flex: 1, all content inside
 *       <div class="message-header">  ← author + timestamp (non-grouped only)
 *       <div class="message-content">
 *       <div class="media-container"> ← attachments + CDN media previews
 *       <div class="embeds">          ← embed cards
 *       <div class="stickers">        ← sticker previews
 *
 * Embeds and media are always INSIDE message-main, so they can never drift
 * left or right of the content column.
 */
export function renderMessage(
  msg: ExportMessage,
  previousMessage: ExportMessage | null,
  participants: ParticipantMap,
  msgCountByAuthor: Record<string, number>
): string {
  const grouped = isGrouped(msg, previousMessage)

  const displayName = escapeHtml(
    msg.author_display_name ?? msg.author_global_name ?? msg.author_username
  )
  const username    = escapeHtml(msg.author_username)
  const userId      = escapeHtml(msg.author_id)
  const time        = escapeHtml(formatTimestamp(msg.timestamp))
  const timeIso     = escapeAttribute(msg.timestamp)

  const p = participants.get(msg.author_id)
  const avatarUrl   = msg.author_avatar_url ?? p?.avatar_url
  const msgCount    = msgCountByAuthor[msg.author_id] ?? 0

  // Collect attachment URLs so CDN media in content body isn't duplicated
  const attachmentUrls = new Set(msg.attachments.map(a => a.url))
  // Collect embed URLs (video, image) so CDN media links aren't duplicated
  const embedUrls = new Set<string>()
  for (const e of msg.embeds) {
    if (e.video?.url) embedUrls.add(e.video.url)
    if (e.image?.url) embedUrls.add(e.image.url)
    if (e.thumbnail?.url) embedUrls.add(e.thumbnail.url)
    if (e.url) embedUrls.add(e.url)
  }

  // Extract direct Discord CDN media links from message text
  const directMediaLinks = extractDirectMediaLinks(
    msg.content,
    attachmentUrls,
    embedUrls
  )

  // Collect URLs to suppress in the text (Tenor embeds + CDN media links) — returns Set<string>
  const suppressedUrls = collectSuppressedUrls(msg.content, msg.embeds, directMediaLinks)

  // ── Layout ────────────────────────────────────────────────────────────────
  let out = ""

  // Reply preview (always outside the columns, full width, indented)
  out += renderReplyPreview(msg)

  if (grouped) {
    out += (
      `<article class="message message-grouped" id="msg-${escapeAttribute(msg.id)}" ` +
      `data-author-id="${userId}">` +
      // avatar-slot: empty but keeps layout aligned
      `<div class="avatar-slot avatar-slot-grouped">` +
      `<time class="grouped-timestamp" datetime="${timeIso}" aria-label="${time}">${time}</time>` +
      `</div>` +
      `<div class="message-main">`
    )
  } else {
    out += (
      `<article class="message" id="msg-${escapeAttribute(msg.id)}" ` +
      `data-author-id="${userId}">` +
      `<div class="avatar-slot">` +
      renderAvatar(
        msg.author_global_name ?? msg.author_username,
        msg.author_id,
        avatarUrl,
        msgCount
      ) +
      `</div>` +
      `<div class="message-main">` +
      `<div class="message-header">` +
      `<span class="msg-author" ` +
      `title="@${escapeAttribute(msg.author_username)} · ID: ${userId}" ` +
      `data-user-id="${userId}" ` +
      `role="button" tabindex="0" ` +
      `onclick="openPopout(this)" ` +
      `onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();openPopout(this)}">` +
      displayName +
      `</span>` +
      `<time class="msg-time" datetime="${timeIso}" title="${timeIso}">${time}</time>` +
      `</div>` // .message-header
    )
  }

  // Content
  if (msg.content) {
    const rendered = renderMessageContent(msg.content, participants, suppressedUrls)
    out += `<div class="message-content">${rendered}</div>`
  }

  // Attachments + CDN media previews (both inside message-main)
  const attachmentsHtml    = renderAttachments(msg.attachments)
  const cdnMediaHtml       = renderDiscordCdnMediaLinks(directMediaLinks)
  const combinedMediaHtml  = attachmentsHtml + cdnMediaHtml

  if (combinedMediaHtml) {
    out += `<div class="media-container">${combinedMediaHtml}</div>`
  }

  // Embeds
  const embedsHtml = renderEmbeds(msg.embeds)
  if (embedsHtml) {
    out += `<div class="embeds">${embedsHtml}</div>`
  }

  // Stickers
  const stickersHtml = renderStickers(msg.stickers)
  if (stickersHtml) {
    out += `<div class="stickers">${stickersHtml}</div>`
  }

  out += `</div>` // close .message-main
  out += `</article>`

  return out
}

// ─── Message list ─────────────────────────────────────────────────────────────

export function renderMessages(
  messages: ExportMessage[],
  participants: ParticipantMap
): string {
  const stats = buildParticipantStats(messages)
  const msgCountByAuthor: Record<string, number> = {}
  for (const [id, s] of Object.entries(stats)) {
    msgCountByAuthor[id] = s.msgCount
  }

  const rows: string[] = []
  for (let i = 0; i < messages.length; i++) {
    const prev = i > 0 ? messages[i - 1] : null
    rows.push(renderMessage(messages[i], prev, participants, msgCountByAuthor))
  }
  return rows.join("\n")
}
