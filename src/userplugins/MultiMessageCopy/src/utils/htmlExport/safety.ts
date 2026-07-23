/**
 * htmlExport/safety.ts
 *
 * All sanitization and URL-validation helpers for the HTML export.
 * No side-effects, no DOM, fully testable.
 */

/** Escape a string so it is safe to embed as HTML text content. */
export function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

/** Escape a string so it is safe inside an HTML attribute value. */
export function escapeAttribute(raw: string): string {
  return raw
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
}

/**
 * Validate that a URL is safe to use in href/src attributes.
 * Only http, https, blob, and data:image/* schemes are permitted.
 */
export function isSafeUrl(url: string): boolean {
  try {
    const u = new URL(url)
    return (
      u.protocol === "http:" ||
      u.protocol === "https:" ||
      u.protocol === "blob:" ||
      (u.protocol === "data:" && url.startsWith("data:image/"))
    )
  } catch {
    return false
  }
}

/** Return the escaped URL if safe, otherwise empty string. */
export function safeAttr(url: string): string {
  return isSafeUrl(url) ? escapeAttribute(url) : ""
}

/**
 * Sanitize a URL for use in Discord CDN media contexts.
 * Only https://cdn.discordapp.com and https://media.discordapp.net
 * and https://images-ext-*.discordapp.net domains are accepted as
 * "Discord CDN" URLs; all others fall through to isSafeUrl.
 */
export function safeMediaUrl(url: string): string {
  if (!isSafeUrl(url)) return ""
  return escapeAttribute(url)
}

/** Format an ISO timestamp as a human-readable local date/time string. */
export function formatTimestamp(iso: string): string {
  try {
    const d = new Date(iso)
    const pad = (n: number) => String(n).padStart(2, "0")
    return (
      `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
      `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
    )
  } catch {
    return iso
  }
}

/** Format a byte count as a human-readable file size string. */
export function formatFileSize(size: number): string {
  if (size <= 0) return "0 B"
  const units = ["B", "KB", "MB", "GB"]
  const i = Math.floor(Math.log2(size) / 10)
  const clamped = Math.min(i, units.length - 1)
  const value = size / Math.pow(1024, clamped)
  return `${value % 1 === 0 ? value : value.toFixed(1)} ${units[clamped]}`
}

/** Get file extension (lowercase, no dot) from a filename or URL path. */
export function getExtension(filename: string): string {
  // Strip query string before extracting extension
  const path = filename.split("?")[0]
  return path.split(".").pop()?.toLowerCase() ?? ""
}
