/**
 * htmlExport/media.ts
 *
 * Media rendering: attachments (images, video, audio, files), stickers,
 * inline previews for direct Discord CDN media links, and the shared
 * missing-content placeholder used when any media fails to load.
 */

import type { ExportAttachment, ExportSticker } from "../../types/export"
import {
  escapeAttribute,
  escapeHtml,
  formatFileSize,
  getExtension,
  isSafeUrl,
  safeAttr,
} from "./safety"
import {
  isDiscordCdnAudioUrl,
  isDiscordCdnImageUrl,
  isDiscordCdnVideoUrl,
} from "./content"

// ─── Deleted-content placeholder ─────────────────────────────────────────────

const MISSING_MESSAGE =
  "This content was deleted from the hoster, original user & channel, or Discord itself."

/**
 * Render a Discord-style placeholder card for missing/deleted media.
 * If `originalUrl` is provided and safe, it is shown as a small clickable link.
 */
export function renderMissingContentPlaceholder(originalUrl?: string): string {
  let linkHtml = ""
  if (originalUrl && isSafeUrl(originalUrl)) {
    const href = escapeAttribute(originalUrl)
    const label = escapeHtml(originalUrl.length > 60 ? originalUrl.slice(0, 60) + "…" : originalUrl)
    linkHtml = (
      `<a class="missing-link link" href="${href}" target="_blank" rel="noopener noreferrer">` +
      `${label}</a>`
    )
  }
  return (
    `<div class="missing-content-card">` +
    `<div class="missing-content-icon" aria-hidden="true">` +
    `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">` +
    `<circle cx="12" cy="12" r="10"/>` +
    `<line x1="12" y1="8" x2="12" y2="12"/>` +
    `<line x1="12" y1="16" x2="12.01" y2="16"/>` +
    `</svg>` +
    `</div>` +
    `<div class="missing-content-body">` +
    `<span class="missing-content-text">${escapeHtml(MISSING_MESSAGE)}</span>` +
    (linkHtml ? `<br>${linkHtml}` : "") +
    `</div>` +
    `</div>`
  )
}

// ─── Attachment type guards ───────────────────────────────────────────────────

const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "webp", "gif"])
const VIDEO_EXTENSIONS = new Set(["mp4", "webm", "mov"])
const AUDIO_EXTENSIONS = new Set(["mp3", "wav", "ogg", "flac"])

export function isImageAttachment(att: ExportAttachment): boolean {
  if (att.content_type?.startsWith("image/")) return true
  return IMAGE_EXTENSIONS.has(getExtension(att.filename))
}

export function isVideoAttachment(att: ExportAttachment): boolean {
  if (att.content_type?.startsWith("video/")) return true
  return VIDEO_EXTENSIONS.has(getExtension(att.filename))
}

export function isAudioAttachment(att: ExportAttachment): boolean {
  if (att.content_type?.startsWith("audio/")) return true
  return AUDIO_EXTENSIONS.has(getExtension(att.filename))
}

// ─── Single image / media preview tile ───────────────────────────────────────

function renderSingleImageAttachment(att: ExportAttachment): string {
  const src = safeAttr(att.url)
  if (!src) return ""
  const alt = escapeAttribute(att.filename)
  const filename = escapeHtml(att.filename)
  const isGif =
    getExtension(att.filename) === "gif" ||
    att.content_type === "image/gif"
  const badge = isGif
    ? `<span class="media-badge gif-badge" aria-hidden="true">GIF</span>`
    : ""
  return (
    `<div class="media-preview" data-full-src="${src}" data-filename="${alt}" ` +
    `role="button" tabindex="0" aria-label="Open image: ${alt}">` +
    `<img src="${src}" alt="${alt}" class="media-img" loading="lazy" ` +
    `data-missing-fallback="true" data-original-url="${src}">` +
    badge +
    `<div class="media-filename">${filename}</div>` +
    `</div>`
  )
}

// ─── Full attachment set ──────────────────────────────────────────────────────

export function renderAttachments(attachments: ExportAttachment[]): string {
  if (attachments.length === 0) return ""

  const images  = attachments.filter(isImageAttachment)
  const videos  = attachments.filter(isVideoAttachment)
  const audios  = attachments.filter(isAudioAttachment)
  const others  = attachments.filter(
    a => !isImageAttachment(a) && !isVideoAttachment(a) && !isAudioAttachment(a)
  )

  let out = ""

  // Images
  if (images.length === 1) {
    out += `<div class="media-grid media-grid-1">${renderSingleImageAttachment(images[0])}</div>`
  } else if (images.length === 2) {
    out += `<div class="media-grid media-grid-2">`
    for (const img of images) out += renderSingleImageAttachment(img)
    out += `</div>`
  } else if (images.length >= 3) {
    out += `<div class="media-grid media-grid-many">`
    for (const img of images) out += renderSingleImageAttachment(img)
    out += `</div>`
  }

  // Videos
  for (const vid of videos) {
    const src = safeAttr(vid.url)
    if (!src) continue
    const filename = escapeHtml(vid.filename)
    out += `<div class="video-wrap">`
    out += (
      `<video class="media-video" controls preload="metadata" ` +
      `aria-label="${escapeAttribute(vid.filename)}" ` +
      `data-missing-fallback="true" data-original-url="${src}">` +
      `<source src="${src}">` +
      `</video>`
    )
    out += `<div class="media-filename">${filename}</div>`
    out += `<a class="att-fallback-link" href="${src}" target="_blank" rel="noopener noreferrer">Open video</a>`
    out += `</div>`
  }

  // Audio
  for (const aud of audios) {
    const src = safeAttr(aud.url)
    if (!src) continue
    const filename = escapeHtml(aud.filename)
    out += `<div class="audio-wrap">`
    out += (
      `<div class="audio-icon" aria-hidden="true">` +
      `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>` +
      `</div>`
    )
    out += (
      `<div class="audio-info"><div class="att-filename">${filename}</div>` +
      `<audio controls class="audio-player" data-missing-fallback="true" data-original-url="${src}">` +
      `<source src="${src}"></audio></div>`
    )
    out += `</div>`
  }

  // Generic file cards
  for (const file of others) {
    const href = safeAttr(file.url)
    if (!href) continue
    const filename = escapeHtml(file.filename)
    const size = formatFileSize(file.size)
    const ctype = file.content_type ? escapeHtml(file.content_type) : ""
    out += `<a class="att-card" href="${href}" target="_blank" rel="noopener noreferrer">`
    out += (
      `<div class="att-icon" aria-hidden="true">` +
      `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>` +
      `</div>`
    )
    out += (
      `<div class="att-meta">` +
      `<div class="att-filename">${filename}</div>` +
      `<div class="att-size">${escapeHtml(size)}${ctype ? ` · ${ctype}` : ""}</div>` +
      `</div>`
    )
    out += `</a>`
  }

  return out ? `<div class="msg-attachments">${out}</div>` : ""
}

// ─── Direct Discord CDN media link inline previews ────────────────────────────

/**
 * Render inline media previews for direct Discord CDN URLs found in the
 * message content (images, videos, audio). These are shown below content,
 * similar to how Discord renders them.
 */
export function renderDiscordCdnMediaLinks(urls: string[]): string {
  if (urls.length === 0) return ""
  let out = ""

  for (const url of urls) {
    if (!isSafeUrl(url)) continue
    const src = escapeAttribute(url)
    const ext = getExtension(url)

    if (isDiscordCdnImageUrl(url)) {
      const isGif = ext === "gif"
      const badge = isGif
        ? `<span class="media-badge gif-badge" aria-hidden="true">GIF</span>`
        : ""
      out += (
        `<div class="media-grid media-grid-1">` +
        `<div class="media-preview" data-full-src="${src}" data-filename="${src}" ` +
        `role="button" tabindex="0" aria-label="Open media">` +
        `<img src="${src}" alt="Discord media" class="media-img" loading="lazy" ` +
        `data-missing-fallback="true" data-original-url="${src}">` +
        badge +
        `</div>` +
        `</div>`
      )
    } else if (isDiscordCdnVideoUrl(url)) {
      out += (
        `<div class="video-wrap">` +
        `<video class="media-video" controls preload="metadata" aria-label="Discord video" ` +
        `data-missing-fallback="true" data-original-url="${src}">` +
        `<source src="${src}">` +
        `</video>` +
        `<a class="att-fallback-link" href="${src}" target="_blank" rel="noopener noreferrer">Open video</a>` +
        `</div>`
      )
    } else if (isDiscordCdnAudioUrl(url)) {
      out += (
        `<div class="audio-wrap">` +
        `<div class="audio-icon" aria-hidden="true">` +
        `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>` +
        `</div>` +
        `<div class="audio-info">` +
        `<audio controls class="audio-player" data-missing-fallback="true" data-original-url="${src}">` +
        `<source src="${src}"></audio>` +
        `</div>` +
        `</div>`
      )
    }
  }

  return out ? `<div class="msg-attachments cdn-media">${out}</div>` : ""
}

// ─── Sticker rendering ────────────────────────────────────────────────────────

/**
 * Sticker format_type values:
 *   1 = PNG
 *   2 = APNG
 *   3 = LOTTIE (not renderable as <img>)
 *   4 = GIF
 */
export function renderStickers(stickers: ExportSticker[]): string {
  if (stickers.length === 0) return ""
  let out = `<div class="msg-stickers">`

  for (const s of stickers) {
    const stickerName = escapeHtml(s.name)
    const stickerNameAttr = escapeAttribute(s.name)
    const id = s.id

    let imgUrl: string | null = null
    if (s.format_type === 1 || s.format_type === 2) {
      imgUrl = `https://media.discordapp.net/stickers/${id}.png`
    } else if (s.format_type === 4) {
      imgUrl = `https://media.discordapp.net/stickers/${id}.gif`
    }

    if (imgUrl && isSafeUrl(imgUrl)) {
      const src = escapeAttribute(imgUrl)
      out += (
        `<div class="sticker-wrap" title="${stickerNameAttr}" data-missing-fallback="true" data-original-url="${src}">` +
        `<img class="sticker-img" src="${src}" alt="${stickerNameAttr}" loading="lazy">` +
        `<div class="sticker-fallback-card" style="display:none">` +
        `<span class="sticker-chip">${stickerName}</span>` +
        `</div>` +
        `</div>`
      )
    } else {
      // Lottie or unknown format — show pill card
      out += `<div class="sticker-fallback-card"><span class="sticker-chip">${stickerName}</span></div>`
    }
  }

  out += `</div>`
  return out
}
