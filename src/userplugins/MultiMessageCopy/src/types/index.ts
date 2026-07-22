export interface MessageAttachment {
  id: string
  filename: string
  url: string
  proxy_url: string
  size: number
  width?: number
  height?: number
  content_type?: string
}

export interface MessageEmbed {
  type: string
  url?: string
  title?: string
  description?: string
  image?: { url: string }
  video?: { url: string }
}

export interface MessageAuthor {
  id: string
  username: string
  globalName?: string
}

export interface Message {
  id: string
  content: string
  author: MessageAuthor
  timestamp: string
  channel_id: string
  attachments?: MessageAttachment[]
  embeds?: MessageEmbed[]
}

export type SoundType = "select" | "deselect" | "copy" | "error" | "enter" | "exit"
export type NotificationType = "success" | "error" | "info" | "warning"
export type MediaFormat = "inline" | "separate" | "end"
export type AnimationSpeed = "fast" | "normal" | "slow"
