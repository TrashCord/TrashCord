/**
 * htmlExport/users.ts
 *
 * User / participant helpers: participant map, display names, avatar
 * rendering, and popout data generation.
 */

import type { ExportDocument, ExportMessage, ExportParticipant } from "../../types/export"
import { escapeAttribute, escapeHtml, isSafeUrl } from "./safety"

export type ParticipantMap = Map<string, ExportParticipant>

// ─── Participant map ──────────────────────────────────────────────────────────

/**
 * Build a participant map from the document. Prefers the dedicated
 * `participants` record (richer data); falls back to scanning messages.
 * Also accumulates per-user message counts and first/last message timestamps.
 */
export function buildParticipantMap(doc: ExportDocument): ParticipantMap {
  const map: ParticipantMap = new Map()

  if (doc.participants) {
    for (const [id, p] of Object.entries(doc.participants)) {
      map.set(id, p)
    }
    return map
  }

  // Fallback: derive from messages
  for (const msg of doc.messages) {
    if (!map.has(msg.author_id)) {
      map.set(msg.author_id, {
        id: msg.author_id,
        username: msg.author_username || undefined,
        discriminator: msg.author_discriminator,
        global_name: msg.author_global_name,
        display_name: msg.author_display_name,
        avatar: msg.author_avatar,
        avatar_url: msg.author_avatar_url,
      })
    }
  }
  return map
}

/** Pick the best display name for a participant. */
export function participantDisplayName(p: ExportParticipant): string {
  return p.display_name ?? p.global_name ?? p.username ?? p.id
}

// ─── Participant stats ────────────────────────────────────────────────────────

export interface ParticipantStats {
  msgCount: number
  firstTs?: string
  lastTs?: string
}

export function buildParticipantStats(
  messages: ExportMessage[]
): Record<string, ParticipantStats> {
  const stats: Record<string, ParticipantStats> = {}
  for (const m of messages) {
    const s = stats[m.author_id] ?? { msgCount: 0 }
    s.msgCount++
    if (!s.firstTs || m.timestamp < s.firstTs) s.firstTs = m.timestamp
    if (!s.lastTs  || m.timestamp > s.lastTs)  s.lastTs  = m.timestamp
    stats[m.author_id] = s
  }
  return stats
}

// ─── DM sidebar identity resolution ──────────────────────────────────────────

export interface DmDisplayTarget {
  displayName: string
  username: string
  avatarUrl: string | undefined
  userId: string
}

/**
 * For a normal DM, resolve the "other" participant (not the current user).
 * Returns null if unable to resolve (falls back to caller using channel ID).
 */
export function resolveDmDisplayTarget(
  doc: ExportDocument,
  participants: ParticipantMap
): DmDisplayTarget | null {
  // Use dm_recipient if provided
  const dmRecip = (doc as any).dm_recipient as ExportParticipant | undefined
  if (dmRecip?.id) {
    return {
      displayName: participantDisplayName(dmRecip),
      username: dmRecip.username ?? dmRecip.id,
      avatarUrl: dmRecip.avatar_url,
      userId: dmRecip.id,
    }
  }

  // Use recipients array if provided
  const recipients = (doc as any).recipients as ExportParticipant[] | undefined
  if (Array.isArray(recipients) && recipients.length > 0) {
    const currentUserId = (doc as any).current_user_id as string | undefined
    const other = currentUserId
      ? recipients.find(r => r.id !== currentUserId) ?? recipients[0]
      : recipients[0]
    if (other?.id) {
      return {
        displayName: participantDisplayName(other),
        username: other.username ?? other.id,
        avatarUrl: other.avatar_url,
        userId: other.id,
      }
    }
  }

  // Derive from participants — pick the one with most messages (not current user)
  if (participants.size > 0) {
    const currentUserId = (doc as any).current_user_id as string | undefined
    let best: ExportParticipant | null = null
    let bestCount = -1
    const msgCount: Record<string, number> = {}
    for (const m of doc.messages) {
      msgCount[m.author_id] = (msgCount[m.author_id] ?? 0) + 1
    }
    for (const [id, p] of participants.entries()) {
      if (currentUserId && id === currentUserId) continue
      const c = msgCount[id] ?? 0
      if (c > bestCount) { bestCount = c; best = p }
    }
    if (best) {
      return {
        displayName: participantDisplayName(best),
        username: best.username ?? best.id,
        avatarUrl: best.avatar_url,
        userId: best.id,
      }
    }
  }

  return null
}

// ─── Avatar rendering ─────────────────────────────────────────────────────────

/** Deterministic avatar color based on the user id. */
function avatarColor(userId: string): string {
  const PALETTE = [
    "#5865f2", "#3ba55c", "#faa61a",
    "#ed4245", "#eb459e", "#00b0f4", "#7289da",
  ]
  let hash = 0
  for (let i = 0; i < userId.length; i++) {
    hash = (hash * 31 + userId.charCodeAt(i)) >>> 0
  }
  return PALETTE[hash % PALETTE.length]
}

/**
 * Render an inline SVG circular avatar as a data-URI so it can be used as an
 * <img> fallback without any external request.
 */
export function makeSvgAvatarDataUri(authorName: string, authorId: string): string {
  const letter = ((authorName || "?")[0] ?? "?").toUpperCase()
  const color = avatarColor(authorId)
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128">` +
    `<circle cx="64" cy="64" r="64" fill="${color}"/>` +
    `<text x="64" y="64" dy="0.35em" text-anchor="middle" font-family="sans-serif" font-size="56" font-weight="700" fill="#fff">${letter}</text>` +
    `</svg>`
  const b64 = btoa(unescape(encodeURIComponent(svg)))
  return `data:image/svg+xml;base64,${b64}`
}

/**
 * Render the avatar element with all data attributes needed for the popout.
 * Always wraps in a clickable button-like div.
 */
export function renderAvatar(
  authorName: string,
  authorId: string,
  avatarUrl: string | undefined,
  msgCount = 0
): string {
  const fallbackSrc = makeSvgAvatarDataUri(authorName, authorId)
  const escapedFallback = escapeAttribute(fallbackSrc)
  const alt = escapeAttribute(authorName)
  const eid = escapeAttribute(authorId)
  const eMsgCount = escapeAttribute(String(msgCount))

  let imgTag: string
  if (avatarUrl && isSafeUrl(avatarUrl)) {
    const src = escapeAttribute(avatarUrl)
    imgTag = `<img class="avatar-img" src="${src}" alt="${alt}" loading="lazy" onerror="this.onerror=null;this.src='${escapedFallback}'">`
  } else {
    imgTag = `<img class="avatar-img" src="${escapedFallback}" alt="${alt}">`
  }

  return (
    `<div class="avatar" role="button" tabindex="0" ` +
    `aria-label="View profile of ${alt}" ` +
    `data-user-id="${eid}" ` +
    `data-msg-count="${eMsgCount}" ` +
    `onclick="openPopout(this)" ` +
    `onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();openPopout(this)}">` +
    imgTag +
    `</div>`
  )
}

// ─── Popout data script ───────────────────────────────────────────────────────

/**
 * Build the JSON blob embedded in the page that the client-side JS uses to
 * populate the user profile popout. All data is JSON-encoded — no raw
 * user content is ever injected as JS literals.
 */
export function buildPopoutDataScript(
  participants: ParticipantMap,
  messages: ExportMessage[]
): string {
  const stats = buildParticipantStats(messages)

  const entries: string[] = []
  for (const [id, p] of participants.entries()) {
    const displayName = participantDisplayName(p)
    const fallbackSvg = makeSvgAvatarDataUri(displayName, id)
    const s = stats[id] ?? { msgCount: 0 }
    const obj = JSON.stringify({
      id,
      displayName,
      username: p.username ?? id,
      discriminator: p.discriminator ?? "",
      avatarUrl: (p.avatar_url && isSafeUrl(p.avatar_url)) ? p.avatar_url : fallbackSvg,
      fallbackUrl: fallbackSvg,
      msgCount: s.msgCount,
    })
    entries.push(`${JSON.stringify(id)}:${obj}`)
  }

  return `var PARTICIPANTS={${entries.join(",")}};`
}
