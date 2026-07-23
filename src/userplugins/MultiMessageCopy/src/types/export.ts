/** Attachment shape in an exported message */
export interface ExportAttachment {
  id: string
  filename: string
  url: string
  proxy_url?: string
  size: number
  content_type?: string
  width?: number
  height?: number
}

/** Embed shape in an exported message — full Discord fields */
export interface ExportEmbed {
  type: string
  url?: string
  title?: string
  description?: string
  color?: number
  provider?: { name?: string; url?: string }
  author?: { name?: string; url?: string; icon_url?: string }
  footer?: { text?: string; icon_url?: string }
  timestamp?: string
  thumbnail?: { url: string; proxy_url?: string; width?: number; height?: number }
  image?: { url: string; proxy_url?: string; width?: number; height?: number }
  video?: { url: string; proxy_url?: string; width?: number; height?: number }
}

/** Sticker shape in an exported message */
export interface ExportSticker {
  id: string
  name: string
  format_type: number
}

/** Message reference / reply info */
export interface ExportMessageReference {
  message_id?: string
  channel_id?: string
  guild_id?: string
}

/** A single exported message record */
export interface ExportMessage {
  id: string
  channel_id: string
  guild_id?: string
  author_id: string
  author_username: string
  author_discriminator?: string
  author_global_name?: string
  author_display_name?: string
  /** Raw avatar hash from Discord (e.g. "a_abc123"). May be absent. */
  author_avatar?: string
  /** Resolved CDN URL for the author's avatar. May be absent if not available. */
  author_avatar_url?: string
  timestamp: string
  edited_timestamp?: string
  content: string
  attachments: ExportAttachment[]
  embeds: ExportEmbed[]
  stickers: ExportSticker[]
  referenced_message?: ExportMessageReference
}

/** A participant record collected across all messages in the export */
export interface ExportParticipant {
  id: string
  username?: string
  discriminator?: string
  global_name?: string
  display_name?: string
  /** Raw avatar hash */
  avatar?: string
  /** Resolved CDN avatar URL */
  avatar_url?: string
}

/** Root export document */
export interface ExportDocument {
  export_version: 1
  exported_at: string
  channel_id: string
  guild_id?: string
  channel_name?: string
  channel_type?: number
  message_count: number
  messages: ExportMessage[]
  /** Map of userId → participant info, collected from all messages */
  participants?: Record<string, ExportParticipant>
  /**
   * For DMs: the ID of the currently logged-in user at export time.
   * Used to identify the "other" participant for sidebar display.
   */
  current_user_id?: string
  /**
   * For normal DMs: the resolved recipient (the other user).
   * Pre-populated by exportChat.ts when available.
   */
  dm_recipient?: ExportParticipant
  /**
   * For Group DMs: array of all recipients.
   */
  recipients?: ExportParticipant[]
}

/** Format options */
export type ExportFormat = "json" | "txt" | "html"

/** Current phase of the export pipeline */
export type ExportPhase =
  | "fetching"
  | "formatting"
  | "building"
  | "downloading"

/** State passed to the progress modal */
export interface ExportProgressState {
  status: "running" | "done" | "error" | "cancelled"
  /** Messages fetched/collected so far */
  fetched: number
  /** Total messages to process, if known (e.g. during formatting) */
  totalMessages?: number
  statusText: string
  phase?: ExportPhase
  /** Elapsed time in seconds */
  elapsedSeconds?: number
}
