/**
 * filename.ts
 *
 * Builds a safe, human-readable filename for chat exports.
 *
 * Patterns:
 *   DM       → discord-export-{username}-{userId}-{YYYY-MM-DD-HH-mm}.{ext}
 *   Group DM → discord-export-group-{groupNameOrChannelId}-{YYYY-MM-DD-HH-mm}.{ext}
 *   Fallback → discord-export-dm-{channelId}-{YYYY-MM-DD-HH-mm}.{ext}
 */

import type { ExportFormat } from "../types/export"

// Discord channel type constants (kept local — no cross-import needed)
const DM_CHANNEL_TYPE = 1
const GROUP_DM_CHANNEL_TYPE = 3

/** Zero-pad a number to 2 digits. */
function pad2(n: number): string {
  return String(n).padStart(2, "0")
}

/** Current timestamp formatted as YYYY-MM-DD-HH-mm. */
function datestamp(): string {
  const now = new Date()
  return [
    now.getFullYear(),
    pad2(now.getMonth() + 1),
    pad2(now.getDate()),
    pad2(now.getHours()),
    pad2(now.getMinutes()),
  ].join("-")
}

/**
 * Sanitize a user-supplied string for use in a filename.
 *
 * - Strips / replaces characters that are unsafe on Windows, macOS, and Linux:
 *     / \ : * ? " < > |
 * - Collapses whitespace and runs of hyphens into a single "-"
 * - Lowercases the result
 * - Trims to 48 characters to keep filenames reasonable
 * - Falls back to `fallback` when the sanitized result is empty
 */
export function sanitizeSlug(raw: string, fallback: string): string {
  const cleaned = raw
    .toLowerCase()
    .replace(/[/\\:*?"<>|]+/g, "-")   // unsafe chars → hyphen
    .replace(/\s+/g, "-")             // spaces → hyphen
    .replace(/-{2,}/g, "-")           // collapse multiple hyphens
    .replace(/^-+|-+$/g, "")          // trim leading/trailing hyphens
    .slice(0, 48)

  return cleaned.length > 0 ? cleaned : fallback
}

/**
 * Build a canonical export filename for a given channel and format.
 *
 * @param channel  - The Vencord/Discord channel object (any shape)
 * @param format   - One of "json" | "txt" | "html"
 * @param UserStore - Optional Vencord UserStore for DM user resolution
 */
export function buildExportFilename(
  channel: any,
  format: ExportFormat,
  UserStore?: any
): string {
  const ext = format           // "json" | "txt" | "html"
  const date = datestamp()
  const channelId = String(channel?.id ?? "unknown")

  // ── Group DM ──────────────────────────────────────────────────────────────
  if (channel?.type === GROUP_DM_CHANNEL_TYPE) {
    const rawName: string =
      channel?.name
        ? String(channel.name)
        : channelId

    const slug = sanitizeSlug(rawName, channelId)
    return `discord-export-group-${slug}-${date}.${ext}`
  }

  // ── Private DM ────────────────────────────────────────────────────────────
  if (channel?.type === DM_CHANNEL_TYPE) {
    // Try to resolve the *other* participant (not the logged-in user).
    // channel.recipients is an array of user objects or user ids (depending
    // on the Vencord version); the array typically has exactly one entry for
    // a private DM.
    let otherUser: any = null

    if (Array.isArray(channel.recipients) && channel.recipients.length > 0) {
      // Some builds store full user objects; others store only snowflake ids.
      const first = channel.recipients[0]
      if (first && typeof first === "object" && first.username) {
        otherUser = first
      } else if (first && UserStore) {
        // Only a snowflake — look up the full user via UserStore
        try {
          otherUser = UserStore.getUser(String(first))
        } catch {
          otherUser = null
        }
      }
    }

    // Also try channel.recipient (singular alias present in some builds)
    if (!otherUser && channel.recipient) {
      otherUser = channel.recipient
    }

    if (otherUser?.username && otherUser?.id) {
      const usernameSlug = sanitizeSlug(String(otherUser.username), "user")
      const userId = String(otherUser.id)
      return `discord-export-${usernameSlug}-${userId}-${date}.${ext}`
    }

    // Could not resolve the other user — fall back to channelId
    return `discord-export-dm-${channelId}-${date}.${ext}`
  }

  // ── Generic fallback (should not normally be reached given the DM guard) ──
  return `discord-export-dm-${channelId}-${date}.${ext}`
}
