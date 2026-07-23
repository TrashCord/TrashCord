/**
 * htmlExport/embeds.ts
 *
 * Discord embed card rendering: Tenor/gifv, standard rich embeds, TikTok,
 * video embeds. All embeds use a consistent stable layout with no misalignment.
 */

import type { ExportEmbed } from "../../types/export"
import {
  escapeAttribute,
  escapeHtml,
  formatTimestamp,
  isSafeUrl,
  safeAttr,
} from "./safety"
import { isTenorUrl } from "./content"

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Detect whether an embed is primarily a Tenor GIF card. */
function isTenorEmbed(e: ExportEmbed): boolean {
  if (e.type === "gifv") return true
  if (e.provider?.name?.toLowerCase() === "tenor") return true
  if (e.url && isTenorUrl(e.url)) return true
  return false
}

/**
 * Find the best displayable media source from an embed.
 * Returns { mediaUrl, isVideo } or null if nothing usable is found.
 */
function embedMediaSource(e: ExportEmbed): { mediaUrl: string; isVideo: boolean } | null {
  if (e.video?.url && isSafeUrl(e.video.url)) {
    return { mediaUrl: e.video.url, isVideo: true }
  }
  if (e.image?.url && isSafeUrl(e.image.url)) {
    return { mediaUrl: e.image.url, isVideo: false }
  }
  if (e.thumbnail?.url && isSafeUrl(e.thumbnail.url)) {
    return { mediaUrl: e.thumbnail.url, isVideo: false }
  }
  return null
}

/** Render the left accent color strip as an inline style string. */
function embedAccentStyle(color?: number): string {
  if (color == null) return ""
  const hex = `#${(color & 0xffffff).toString(16).padStart(6, "0")}`
  return ` style="border-left-color:${escapeAttribute(hex)}"`
}

// ─── Tenor embed ──────────────────────────────────────────────────────────────

function renderTenorEmbed(e: ExportEmbed): string {
  const media = embedMediaSource(e)
  const providerLabel = e.provider?.name ? escapeHtml(e.provider.name) : "Tenor"
  const linkUrl = e.url ? safeAttr(e.url) : ""

  if (media) {
    let mediaHtml: string
    if (media.isVideo) {
      const src = escapeAttribute(media.mediaUrl)
      mediaHtml = (
        `<video class="gif-video" autoplay loop muted playsinline ` +
        `aria-label="${escapeAttribute(e.title ?? "GIF")}" ` +
        `title="${escapeAttribute(e.title ?? "GIF")}" ` +
        `data-missing-fallback="true" data-original-url="${src}">` +
        `<source src="${src}">` +
        `</video>`
      )
    } else {
      const previewSrc = escapeAttribute(media.mediaUrl)
      mediaHtml = (
        `<div class="media-preview" data-full-src="${previewSrc}" data-filename="gif" ` +
        `role="button" tabindex="0" aria-label="Open GIF">` +
        `<img src="${previewSrc}" alt="${escapeAttribute(e.title ?? "GIF")}" class="gif-img media-img" loading="lazy" ` +
        `data-missing-fallback="true" data-original-url="${previewSrc}">` +
        `<span class="media-badge gif-badge" aria-hidden="true">GIF</span>` +
        `</div>`
      )
    }

    let footer = ""
    if (e.title || linkUrl) {
      footer += `<div class="gif-footer">`
      footer += `<span class="gif-provider">${providerLabel}</span>`
      if (e.title) footer += `<span class="gif-title">${escapeHtml(e.title)}</span>`
      if (linkUrl) {
        footer += `<a class="link gif-link" href="${linkUrl}" target="_blank" rel="noopener noreferrer">Open in ${providerLabel}</a>`
      }
      footer += `</div>`
    }

    return `<div class="embed embed-gif">${mediaHtml}${footer}</div>`
  }

  // No media — Tenor card with link
  let out = `<div class="embed embed-gif-card"${embedAccentStyle(e.color)}>`
  out += `<span class="gif-provider">${providerLabel}</span>`
  if (e.title) out += `<div class="gif-title">${escapeHtml(e.title)}</div>`
  if (linkUrl) {
    out += `<a class="link" href="${linkUrl}" target="_blank" rel="noopener noreferrer">${escapeHtml(e.url ?? linkUrl)}</a>`
  }
  out += `</div>`
  return out
}

// ─── Standard rich embed ──────────────────────────────────────────────────────

function renderStandardEmbed(e: ExportEmbed): string {
  let out = `<div class="embed"${embedAccentStyle(e.color)}>`

  // Provider
  if (e.provider?.name) {
    const provUrl = e.provider.url ? safeAttr(e.provider.url) : ""
    if (provUrl) {
      out += `<a class="embed-provider" href="${provUrl}" target="_blank" rel="noopener noreferrer">${escapeHtml(e.provider.name)}</a>`
    } else {
      out += `<div class="embed-provider">${escapeHtml(e.provider.name)}</div>`
    }
  }

  // Author
  if (e.author?.name) {
    const authorUrl = e.author.url ? safeAttr(e.author.url) : ""
    const iconUrl =
      e.author.icon_url && isSafeUrl(e.author.icon_url)
        ? escapeAttribute(e.author.icon_url)
        : ""
    out += `<div class="embed-author">`
    if (iconUrl)
      out += `<img class="embed-author-icon" src="${iconUrl}" alt="" aria-hidden="true">`
    if (authorUrl) {
      out += `<a class="embed-author-name" href="${authorUrl}" target="_blank" rel="noopener noreferrer">${escapeHtml(e.author.name)}</a>`
    } else {
      out += `<span class="embed-author-name">${escapeHtml(e.author.name)}</span>`
    }
    out += `</div>`
  }

  // Thumbnail (floated right via CSS — rendered early so float works)
  if (e.thumbnail?.url && isSafeUrl(e.thumbnail.url)) {
    const thumbSrc = escapeAttribute(e.thumbnail.url)
    out += (
      `<img class="embed-thumbnail" src="${thumbSrc}" alt="thumbnail" loading="lazy" ` +
      `data-missing-fallback="true" data-original-url="${thumbSrc}">`
    )
  }

  // Title
  if (e.title) {
    const titleUrl = e.url ? safeAttr(e.url) : ""
    if (titleUrl) {
      out += `<a class="embed-title" href="${titleUrl}" target="_blank" rel="noopener noreferrer">${escapeHtml(e.title)}</a>`
    } else {
      out += `<div class="embed-title">${escapeHtml(e.title)}</div>`
    }
  }

  // Description
  if (e.description) {
    out += `<div class="embed-desc">${escapeHtml(e.description).replace(/\n/g, "<br>")}</div>`
  }

  // Standalone URL (only if no title claimed it)
  if (!e.title && e.url) {
    const u = safeAttr(e.url)
    if (u)
      out += `<a class="embed-url" href="${u}" target="_blank" rel="noopener noreferrer">${escapeHtml(e.url)}</a>`
  }

  // Image
  if (e.image?.url && isSafeUrl(e.image.url)) {
    const imgSrc = escapeAttribute(e.image.url)
    out += (
      `<img class="embed-image" src="${imgSrc}" alt="embed image" loading="lazy" ` +
      `data-missing-fallback="true" data-original-url="${imgSrc}">`
    )
  }

  // Video
  if (e.video?.url && isSafeUrl(e.video.url)) {
    const vidSrc = escapeAttribute(e.video.url)
    out += (
      `<video class="embed-video" controls preload="metadata" ` +
      `data-missing-fallback="true" data-original-url="${vidSrc}">` +
      `<source src="${vidSrc}">` +
      `</video>`
    )
  }

  // Footer
  if (e.footer?.text) {
    const footerIcon =
      e.footer.icon_url && isSafeUrl(e.footer.icon_url)
        ? `<img class="embed-footer-icon" src="${escapeAttribute(e.footer.icon_url)}" alt="" aria-hidden="true">`
        : ""
    const footerTs = e.timestamp
      ? `<span class="embed-footer-sep">·</span><span class="embed-footer-ts">${escapeHtml(formatTimestamp(e.timestamp))}</span>`
      : ""
    out += `<div class="embed-footer">${footerIcon}<span class="embed-footer-text">${escapeHtml(e.footer.text)}</span>${footerTs}</div>`
  }

  out += `</div>` // close .embed
  return out
}

// ─── Public renderer ───���──────────────────────────────────────────────────────

export function renderEmbeds(embeds: ExportEmbed[]): string {
  if (embeds.length === 0) return ""
  let out = ""
  for (const e of embeds) {
    if (isTenorEmbed(e)) {
      out += renderTenorEmbed(e)
    } else {
      out += renderStandardEmbed(e)
    }
  }
  return out
}
