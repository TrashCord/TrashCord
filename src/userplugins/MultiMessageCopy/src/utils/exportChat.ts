/**
 * exportChat.ts
 *
 * Safely fetches all messages from a channel/DM and produces a JSON download.
 * Designed to be progressive, cancellable, and rate-limit-aware.
 */

import type {
  ExportAttachment,
  ExportDocument,
  ExportEmbed,
  ExportMessage,
  ExportMessageReference,
  ExportParticipant,
  ExportProgressState,
  ExportSticker,
} from "../types/export"

// ─── Vencord / Discord internal imports ─────────────────────────────────────
// These are resolved at runtime by Vencord's module system.
import { ChannelStore, UserStore } from "@webpack/common"

import settings from "../settings"
import type { ExportFormat } from "../types/export"
import { buildExportFilename } from "./filename"
import {
  formatExportAsHtml,
  formatExportAsJson,
  formatExportAsTxt,
  getExportMimeType,
} from "./exportFormatters"

/** Milliseconds to wait between bulk-fetch calls to respect Discord rate limits */
const FETCH_DELAY_MS = 800

/** How many messages to request per API call (Discord max is 100) */
const BATCH_SIZE = 100

/** Threshold above which we show the "large export" warning */
const LARGE_EXPORT_WARN_THRESHOLD = 10_000

/** Threshold above which we show the "very large export" warning */
const VERY_LARGE_EXPORT_WARN_THRESHOLD = 20_000

/** Signal object returned by startExport so callers can cancel mid-flight */
export interface CancelToken {
  cancelled: boolean
  cancel(): void
}

export function createCancelToken(): CancelToken {
  const token: CancelToken = {
    cancelled: false,
    cancel() {
      this.cancelled = true
    },
  }
  return token
}

// ─── Internal helpers ────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/** Yield execution to the browser event loop for one frame */
function yieldToUI(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0))
}

/**
 * Process `items` in chunks of `batchSize`, yielding to the UI between each
 * batch. Calls `handler(item)` for every item and collects results.
 */
async function processInBatches<T, R>(
  items: T[],
  batchSize: number,
  delayMs: number,
  handler: (item: T) => R,
  onBatch?: (processed: number, total: number) => void
): Promise<R[]> {
  const results: R[] = []
  for (let i = 0; i < items.length; i += batchSize) {
    const chunk = items.slice(i, i + batchSize)
    for (const item of chunk) {
      results.push(handler(item))
    }
    onBatch?.(Math.min(i + batchSize, items.length), items.length)
    if (i + batchSize < items.length) {
      if (delayMs > 0) {
        await sleep(delayMs)
      } else {
        await yieldToUI()
      }
    }
  }
  return results
}

/**
 * Returns a string describing the size risk of the export.
 * "ok" | "large" | "very-large"
 */
function classifyExportSize(messageCount: number): "ok" | "large" | "very-large" {
  if (messageCount >= VERY_LARGE_EXPORT_WARN_THRESHOLD) return "very-large"
  if (messageCount >= LARGE_EXPORT_WARN_THRESHOLD) return "large"
  return "ok"
}

/** Map a Discord raw attachment object to our serialisable ExportAttachment */
function mapAttachment(a: any): ExportAttachment {
  return {
    id: String(a.id ?? ""),
    filename: String(a.filename ?? ""),
    url: String(a.url ?? ""),
    proxy_url: a.proxy_url ? String(a.proxy_url) : undefined,
    size: Number(a.size ?? 0),
    content_type: a.content_type ? String(a.content_type) : undefined,
    width: a.width != null ? Number(a.width) : undefined,
    height: a.height != null ? Number(a.height) : undefined,
  }
}

/** Map a Discord raw embed object to our serialisable ExportEmbed */
function mapEmbed(e: any): ExportEmbed {
  return {
    type: String(e.type ?? "rich"),
    url: e.url ? String(e.url) : undefined,
    title: e.title ? String(e.title) : undefined,
    description: e.description ? String(e.description) : undefined,
    color: e.color != null ? Number(e.color) : undefined,
    provider: e.provider
      ? {
          name: e.provider.name ? String(e.provider.name) : undefined,
          url: e.provider.url ? String(e.provider.url) : undefined,
        }
      : undefined,
    author: e.author
      ? {
          name: e.author.name ? String(e.author.name) : undefined,
          url: e.author.url ? String(e.author.url) : undefined,
          icon_url: e.author.icon_url ? String(e.author.icon_url) : undefined,
        }
      : undefined,
    footer: e.footer
      ? {
          text: e.footer.text ? String(e.footer.text) : undefined,
          icon_url: e.footer.icon_url ? String(e.footer.icon_url) : undefined,
        }
      : undefined,
    timestamp: e.timestamp ? String(e.timestamp) : undefined,
    thumbnail: e.thumbnail?.url
      ? {
          url: String(e.thumbnail.url),
          proxy_url: e.thumbnail.proxy_url ? String(e.thumbnail.proxy_url) : undefined,
          width: e.thumbnail.width != null ? Number(e.thumbnail.width) : undefined,
          height: e.thumbnail.height != null ? Number(e.thumbnail.height) : undefined,
        }
      : undefined,
    image: e.image?.url
      ? {
          url: String(e.image.url),
          proxy_url: e.image.proxy_url ? String(e.image.proxy_url) : undefined,
          width: e.image.width != null ? Number(e.image.width) : undefined,
          height: e.image.height != null ? Number(e.image.height) : undefined,
        }
      : undefined,
    video: e.video?.url
      ? {
          url: String(e.video.url),
          proxy_url: e.video.proxy_url ? String(e.video.proxy_url) : undefined,
          width: e.video.width != null ? Number(e.video.width) : undefined,
          height: e.video.height != null ? Number(e.video.height) : undefined,
        }
      : undefined,
  }
}

/** Map a Discord raw sticker item to our serialisable ExportSticker */
function mapSticker(s: any): ExportSticker {
  return {
    id: String(s.id ?? ""),
    name: String(s.name ?? ""),
    format_type: Number(s.format_type ?? 1),
  }
}

/**
 * Try to resolve a Discord CDN avatar URL from a raw message author object.
 * Discord's getAvatarURL method (if available on the author object) is the
 * most reliable source. Falls back to constructing the CDN URL manually.
 */
function resolveAvatarUrl(author: any): string | undefined {
  // Method 1: Vencord/Discord may attach getAvatarURL() directly
  if (typeof author?.getAvatarURL === "function") {
    try {
      const url = author.getAvatarURL(null, 128, true)
      if (url && typeof url === "string") return url
    } catch { /* ignore */ }
  }
  // Method 2: manual CDN construction from avatar hash
  const id = author?.id ? String(author.id) : undefined
  const hash = author?.avatar ? String(author.avatar) : undefined
  if (id && hash) {
    const ext = hash.startsWith("a_") ? "gif" : "png"
    return `https://cdn.discordapp.com/avatars/${id}/${hash}.${ext}?size=128`
  }
  return undefined
}

/** Convert a single Discord Message object to our ExportMessage format */
function mapMessage(msg: any, channelId: string, guildId?: string): ExportMessage {
  const ref: ExportMessageReference | undefined =
    msg.messageReference
      ? {
          message_id: msg.messageReference.message_id
            ? String(msg.messageReference.message_id)
            : undefined,
          channel_id: msg.messageReference.channel_id
            ? String(msg.messageReference.channel_id)
            : undefined,
          guild_id: msg.messageReference.guild_id
            ? String(msg.messageReference.guild_id)
            : undefined,
        }
      : undefined

  const avatarUrl = resolveAvatarUrl(msg.author)

  return {
    id: String(msg.id ?? ""),
    channel_id: channelId,
    guild_id: guildId,
    author_id: String(msg.author?.id ?? ""),
    author_username: String(msg.author?.username ?? ""),
    author_discriminator: msg.author?.discriminator
      ? String(msg.author.discriminator)
      : undefined,
    author_global_name: msg.author?.globalName
      ? String(msg.author.globalName)
      : (msg.author?.global_name ? String(msg.author.global_name) : undefined),
    author_display_name: msg.author?.displayName
      ? String(msg.author.displayName)
      : (msg.author?.display_name ? String(msg.author.display_name) : undefined),
    author_avatar: msg.author?.avatar ? String(msg.author.avatar) : undefined,
    author_avatar_url: avatarUrl,
    timestamp: String(msg.timestamp ?? ""),
    edited_timestamp: msg.editedTimestamp
      ? String(msg.editedTimestamp)
      : undefined,
    content: String(msg.content ?? ""),
    attachments: Array.isArray(msg.attachments)
      ? msg.attachments.map(mapAttachment)
      : [],
    embeds: Array.isArray(msg.embeds) ? msg.embeds.map(mapEmbed) : [],
    stickers: Array.isArray(msg.stickerItems)
      ? msg.stickerItems.map(mapSticker)
      : [],
    referenced_message: ref,
  }
}

// ─── Download helper ──────────────────────────────────────────────────────────

function downloadExport(content: string, mimeType: string, filename: string): void {
  const blob = new Blob([content], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  a.style.display = "none"
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

// ─── Core export function ─────────────────────────────────────────────────────

/**
 * Fetch all accessible messages from `channelId` and trigger a JSON download.
 *
 * @param channelId   - Discord channel / DM channel snowflake
 * @param cancelToken - Token that can be cancelled by the caller at any time
 * @param onProgress  - Callback called after every batch with the current state
 */
// Discord channel type constants
const DM_CHANNEL_TYPE = 1
const GROUP_DM_CHANNEL_TYPE = 3

export async function startExport(
  channelId: string,
  cancelToken: CancelToken,
  onProgress: (state: ExportProgressState) => void
): Promise<void> {
  const channel = ChannelStore.getChannel(channelId)

  // ── Hard safety guard ────────────────────────────────────────────────────
  // Refuse to export if the channel belongs to a guild/server, or is not a
  // private DM / Group DM. This runs even if the context menu guard is
  // bypassed (e.g. a direct API call).
  //
  // Vencord and Discord may expose the guild association under different names
  // depending on the build/wrapper:
  //   - channel.guild_id        raw Discord API field
  //   - channel.guildId         camelCase alias used by some Vencord wrappers
  //   - channel.getGuildId?.()  method form used by Vencord's Channel class
  const resolvedGuildId: string | undefined =
    channel?.guild_id
      ? String(channel.guild_id)
      : channel?.guildId
        ? String(channel.guildId)
        : typeof channel?.getGuildId === "function" && channel.getGuildId()
          ? String(channel.getGuildId())
          : undefined

  if (
    resolvedGuildId ||
    (channel?.type !== DM_CHANNEL_TYPE &&
      channel?.type !== GROUP_DM_CHANNEL_TYPE)
  ) {
    onProgress({
      status: "error",
      fetched: 0,
      statusText: "Export Chat is only available for DMs and Group DMs.",
    })
    return
  }
  // ─────────────────────────────────────────────────────────────────────────

  const guildId: string | undefined = resolvedGuildId
  const channelName: string | undefined = channel?.name
    ? String(channel.name)
    : undefined

  const allMessages: ExportMessage[] = []
  let beforeId: string | undefined = undefined
  let done = false
  const startTime = Date.now()

  function elapsed(): number {
    return Math.round((Date.now() - startTime) / 1000)
  }

  onProgress({ status: "running", fetched: 0, statusText: "Starting export…", phase: "fetching" })

  while (!done && !cancelToken.cancelled) {
    // Fetch a batch via Vencord's MessageStore helper (already cached +
    // fetched through Discord's existing authenticated session).
    // We use the REST helper injected by Vencord for pagination.
    let batch: any[]

    try {
      // Vencord exposes `RestAPI` for internal use — use the already-
      // provided webpack modules instead of a raw fetch to stay within
      // Vencord's sandboxed environment.
      const { RestAPI } = await import("@webpack/common")

      const query: Record<string, string> = { limit: String(BATCH_SIZE) }
      if (beforeId) query.before = beforeId

      const response = await RestAPI.get({
        url: `/channels/${channelId}/messages`,
        query,
      })

      batch = Array.isArray(response.body) ? response.body : []
    } catch (err: any) {
      onProgress({
        status: "error",
        fetched: allMessages.length,
        statusText: `Fetch error: ${err?.message ?? String(err)}`,
      })
      return
    }

    if (cancelToken.cancelled) break

    if (batch.length === 0) {
      done = true
      break
    }

    for (const raw of batch) {
      allMessages.push(mapMessage(raw, channelId, guildId))
    }

    // The oldest message in this batch becomes the `before` cursor
    beforeId = batch[batch.length - 1].id

    onProgress({
      status: "running",
      fetched: allMessages.length,
      statusText: `Fetching messages… ${allMessages.length} so far`,
      phase: "fetching",
      elapsedSeconds: elapsed(),
    })

    if (batch.length < BATCH_SIZE) {
      // Last page
      done = true
    } else {
      // Respectful delay before the next request
      await sleep(FETCH_DELAY_MS)
    }
  }

  if (cancelToken.cancelled) {
    onProgress({
      status: "cancelled",
      fetched: allMessages.length,
      statusText: `Export cancelled (${allMessages.length} messages collected).`,
      elapsedSeconds: elapsed(),
    })
    return
  }

  // Sort oldest → newest
  allMessages.sort((a, b) => (a.timestamp > b.timestamp ? 1 : -1))

  // Build participants map — use the most recently seen data per user
  const participantsMap: Record<string, ExportParticipant> = {}
  for (const msg of allMessages) {
    const uid = msg.author_id
    if (!uid) continue
    // Always overwrite so we end up with the most recent snapshot of each user
    participantsMap[uid] = {
      id: uid,
      username: msg.author_username || undefined,
      discriminator: msg.author_discriminator,
      global_name: msg.author_global_name,
      display_name: msg.author_display_name,
      avatar: msg.author_avatar,
      avatar_url: msg.author_avatar_url,
    }
  }

  // ── Resolve DM recipient for sidebar display ─────────────────────────────
  let currentUserId: string | undefined
  let dmRecipient: ExportParticipant | undefined
  let dmRecipients: ExportParticipant[] | undefined

  try {
    const currentUser = UserStore.getCurrentUser()
    currentUserId = currentUser?.id ? String(currentUser.id) : undefined
  } catch {
    currentUserId = undefined
  }

  if (channel?.type === DM_CHANNEL_TYPE) {
    // Normal DM — find the other participant
    const recipientIds: string[] = Array.isArray(channel?.recipientIDs)
      ? channel.recipientIDs.map(String)
      : Array.isArray(channel?.recipient_ids)
        ? channel.recipient_ids.map(String)
        : []

    const otherId = currentUserId
      ? recipientIds.find(id => id !== currentUserId)
      : recipientIds[0]

    if (otherId && participantsMap[otherId]) {
      dmRecipient = participantsMap[otherId]
    } else if (otherId) {
      // Try UserStore as a last resort
      try {
        const u = UserStore.getUser(otherId)
        if (u) {
          dmRecipient = {
            id: otherId,
            username: u.username ? String(u.username) : undefined,
            discriminator: u.discriminator ? String(u.discriminator) : undefined,
            global_name: u.globalName ? String(u.globalName) : undefined,
            display_name: u.displayName ? String(u.displayName) : undefined,
            avatar: u.avatar ? String(u.avatar) : undefined,
            avatar_url: resolveAvatarUrl(u),
          }
        }
      } catch { /* ignore */ }
    }
  } else if (channel?.type === GROUP_DM_CHANNEL_TYPE) {
    // Group DM — collect all recipient participants
    const recipientIds: string[] = Array.isArray(channel?.recipientIDs)
      ? channel.recipientIDs.map(String)
      : Array.isArray(channel?.recipient_ids)
        ? channel.recipient_ids.map(String)
        : Object.keys(participantsMap)
    dmRecipients = recipientIds
      .filter(id => participantsMap[id])
      .map(id => participantsMap[id])
  }
  // ─────────────────────────────────────────────────────────────────────────

  const doc: ExportDocument = {
    export_version: 1,
    exported_at: new Date().toISOString(),
    channel_id: channelId,
    guild_id: guildId,
    channel_name: channelName,
    channel_type: channel?.type != null ? Number(channel.type) : undefined,
    message_count: allMessages.length,
    messages: allMessages,
    participants: participantsMap,
    current_user_id: currentUserId,
    dm_recipient: dmRecipient,
    recipients: dmRecipients,
  }

  // ── Large export warnings ─────────────────────────────────────────────────
  const sizeClass = classifyExportSize(allMessages.length)
  const format: ExportFormat =
    (settings.store.exportChatFormat as ExportFormat) ?? "json"

  if (settings.store.largeExportWarningEnabled) {
    if (sizeClass === "very-large") {
      onProgress({
        status: "running",
        fetched: allMessages.length,
        statusText: `Very large export detected (${allMessages.length} messages). For best performance, consider TXT or JSON format.`,
        phase: "formatting",
        elapsedSeconds: elapsed(),
      })
      // Brief pause so the user can read the warning
      await sleep(600)
    } else if (sizeClass === "large") {
      onProgress({
        status: "running",
        fetched: allMessages.length,
        statusText: `Large export (${allMessages.length} messages). This may take some time and the file may be large.`,
        phase: "formatting",
        elapsedSeconds: elapsed(),
      })
      await sleep(400)
    }
  }

  if (cancelToken.cancelled) {
    onProgress({
      status: "cancelled",
      fetched: allMessages.length,
      statusText: "Export cancelled.",
      elapsedSeconds: elapsed(),
    })
    return
  }

  // ── Formatting phase ───────────────────────────────────────────────────────
  onProgress({
    status: "running",
    fetched: allMessages.length,
    totalMessages: allMessages.length,
    statusText: `Formatting ${allMessages.length.toLocaleString()} messages…`,
    phase: "formatting",
    elapsedSeconds: elapsed(),
  })

  // Read batch settings
  const batchSize  = Number(settings.store.exportBatchSize)  || 100
  const batchDelay = Number(settings.store.exportBatchDelayMs) ?? 50

  let content: string

  // ── Building phase ─────────────────────────────────────────────────────────
  onProgress({
    status: "running",
    fetched: allMessages.length,
    statusText: "Building file…",
    phase: "building",
    elapsedSeconds: elapsed(),
  })

  // For HTML exports use array-join accumulation inside the formatter.
  // For JSON/TXT the formatters are synchronous and fast enough at any size.
  if (format === "html" && allMessages.length > batchSize) {
    // Process messages in batches, yield between each to avoid UI freeze.
    // The HTML formatter accepts the full doc; for large exports we yield
    // before calling it so the progress modal stays responsive.
    await yieldToUI()
    content = formatExportAsHtml(doc)
    await yieldToUI()
  } else if (format === "txt") {
    await yieldToUI()
    content = formatExportAsTxt(doc)
    await yieldToUI()
  } else {
    await yieldToUI()
    content = formatExportAsJson(doc)
    await yieldToUI()
  }

  if (cancelToken.cancelled) {
    onProgress({
      status: "cancelled",
      fetched: allMessages.length,
      statusText: "Export cancelled during formatting.",
      elapsedSeconds: elapsed(),
    })
    return
  }

  // ── Download phase ─────────────────────────────────────────────────────────
  onProgress({
    status: "running",
    fetched: allMessages.length,
    statusText: "Downloading file…",
    phase: "downloading",
    elapsedSeconds: elapsed(),
  })

  const mimeType = getExportMimeType(format)

  // Try to resolve UserStore for better DM filenames — optional, best-effort
  let userStore: any = undefined
  try {
    userStore = UserStore
  } catch {
    userStore = undefined
  }

  const filename = buildExportFilename(channel, format, userStore)
  downloadExport(content, mimeType, filename)

  onProgress({
    status: "done",
    fetched: allMessages.length,
    statusText: `Done! ${allMessages.length} messages exported in ${elapsed()}s.`,
    phase: "downloading",
    elapsedSeconds: elapsed(),
  })
}
