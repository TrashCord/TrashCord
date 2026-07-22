import settings from "../settings"
import { Message } from "../types"
import { MEDIA_EXTENSIONS_REGEX } from "../constants"
import { moment } from "@webpack/common"

export function extractMediaFromMessage(message: Message): string[] {
  const mediaUrls: string[] = []

  if (settings.store.includeAttachments && message.attachments) {
    message.attachments.forEach((attachment) => {
      if (
        attachment.content_type?.startsWith("image/") ||
        attachment.content_type?.startsWith("video/") ||
        attachment.filename.match(MEDIA_EXTENSIONS_REGEX)
      ) {
        mediaUrls.push(`${attachment.filename}: ${attachment.url}`)
      }
    })
  }

  if (settings.store.includeEmbeds && message.embeds) {
    message.embeds.forEach((embed) => {
      if (embed.image?.url) {
        mediaUrls.push(`Image: ${embed.image.url}`)
      }
      if (embed.video?.url) {
        mediaUrls.push(`Video: ${embed.video.url}`)
      }
      if (embed.url && embed.type === "image") {
        mediaUrls.push(`Embed: ${embed.url}`)
      }
    })
  }

  return mediaUrls
}

export function formatMessage(message: Message): string {
  const timestamp = moment(message.timestamp).format(settings.store.dateFormat)
  const displayName = message.author.globalName || message.author.username
  const content = message.content || ""
  const mediaUrls = extractMediaFromMessage(message)

  const formattedMessage = `[${timestamp}] ${displayName}:`

  if (mediaUrls.length === 0) {
    return `${formattedMessage} ${content}`
  }

  switch (settings.store.mediaFormat) {
    case "inline":
      if (content) {
        return `${formattedMessage} ${content} | Media: ${mediaUrls.join(", ")}`
      } else {
        return `${formattedMessage} ${mediaUrls.join(", ")}`
      }

    case "separate": {
      let result = content ? `${formattedMessage} ${content}` : formattedMessage
      mediaUrls.forEach((url) => {
        result += `\n    📎 ${url}`
      })
      return result
    }

    case "end": {
      let endResult = content ? `${formattedMessage} ${content}` : formattedMessage
      if (mediaUrls.length > 0) {
        endResult += `\n📎 Media: ${mediaUrls.join(" | ")}`
      }
      return endResult
    }

    default:
      return `${formattedMessage} ${content}`
  }
}
