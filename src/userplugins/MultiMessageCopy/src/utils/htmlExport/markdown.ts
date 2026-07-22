/**
 * htmlExport/markdown.ts
 *
 * Safe Discord-flavoured Markdown renderer for the HTML export.
 *
 * SECURITY CONTRACT
 * -----------------
 * This module NEVER calls innerHTML with untrusted content.
 * All raw user text passes through escapeHtml before being
 * placed into the output string. Tokens produced by the
 * extract* helpers contain only control-chars (\x02…\x03) and
 * ASCII hex digits — they cannot be mistaken for HTML.
 *
 * RENDERING ORDER (must not change)
 * ----------------------------------
 *  1. extractCodeBlocks   — protect ``` … ``` from ALL further passes
 *  2. extractInlineCode   — protect `…` from ALL further passes
 *  3. extractCustomEmojis — protect <:name:id> tokens
 *  4. escapeHtml          — escape ALL remaining raw text
 *  5. renderBlockquotes   — > … / >>> … (before other inline marks)
 *  6. renderHeadings      — # / ## / ### (line-level, before inline)
 *  7. renderLists         — - / * / 1. items (block-level)
 *  8. renderInlineFormatting — bold, italic, underline, strike, spoiler
 *  9. resolveMentions     — <@id>, <#id>, <@&id>
 * 10. renderLinks         — http/https links (plain-text segments only)
 * 11. restoreTokens       — replace \x02TOKEN_n\x03 → safe HTML
 * 12. newlines → <br>     — final step so block-elements aren't broken
 */

import { escapeAttribute, escapeHtml } from "./safety"
import type { ParticipantMap } from "./users"
import { participantDisplayName } from "./users"

// ─── Token system ─────────────────────────────────────────────────────────────

type TokenMap = Map<string, string>

let _counter = 0

function nextToken(): string {
  return `\x02T${(_counter++).toString(36).toUpperCase()}\x03`
}

function replaceAll(src: string, needle: string, replacement: string): string {
  return src.split(needle).join(replacement)
}

// ─── Phase 1: Code blocks ─────────────────────────────────────────────────────

export function extractCodeBlocks(raw: string, tokens: TokenMap): string {
  // Match ``` optionally followed by a language identifier on the same line
  return raw.replace(
    /```([^\n`]*)\n?([\s\S]*?)```/g,
    (_, rawLang, code) => {
      const lang = rawLang.trim()
      // Escape the code content — this is the ONLY place code content is escaped
      const safeCode = escapeHtml(code)
      const langAttr = lang ? ` data-lang="${escapeAttribute(lang)}"` : ""
      const langLabel = lang
        ? `<span class="code-language" aria-hidden="true">${escapeHtml(lang)}</span>`
        : ""
      const html =
        `<div class="code-block-wrap"${langAttr}>` +
        langLabel +
        `<pre class="code-block"><code>${safeCode}</code></pre>` +
        `</div>`
      const tok = nextToken()
      tokens.set(tok, html)
      return tok
    }
  )
}

// ─── Phase 2: Inline code ─────────────────────────────────────────────────────

export function extractInlineCode(raw: string, tokens: TokenMap): string {
  // Double backtick first (`` `…` ``) then single
  let out = raw.replace(/``([^`]+)``/g, (_, code) => {
    const html = `<code class="inline-code">${escapeHtml(code)}</code>`
    const tok = nextToken()
    tokens.set(tok, html)
    return tok
  })
  out = out.replace(/`([^`\n]+)`/g, (_, code) => {
    const html = `<code class="inline-code">${escapeHtml(code)}</code>`
    const tok = nextToken()
    tokens.set(tok, html)
    return tok
  })
  return out
}

// ─── Phase 3: Custom emoji extraction ────────────────────────────────────────

export function extractCustomEmojis(raw: string, tokens: TokenMap): string {
  return raw.replace(
    /<(a?):([A-Za-z0-9_]{1,32}):(\d{17,20})>/g,
    (_, animated, name, id) => {
      const ext = animated === "a" ? "gif" : "webp"
      const src = `https://cdn.discordapp.com/emojis/${id}.${ext}?size=48&quality=lossless`
      const safeName = escapeAttribute(name)
      const safeSrc = escapeAttribute(src)
      const html =
        `<img class="custom-emoji" ` +
        `src="${safeSrc}" ` +
        `alt=":${safeName}:" ` +
        `title=":${safeName}:" ` +
        `aria-label=":${safeName}:" ` +
        `loading="lazy" ` +
        `data-missing-fallback="true" ` +
        `data-emoji-name="${safeName}">`
      const tok = nextToken()
      tokens.set(tok, html)
      return tok
    }
  )
}

// ─── Phase 5: Blockquotes ─────────────────────────────────────────────────────

/**
 * Handle both `>>> multiline` (rest of message) and `> single line`.
 * These run on the escaped string so user content inside quotes is already safe.
 */
function renderBlockquotes(escaped: string): string {
  // >>> multi-line blockquote: rest of message from that point
  escaped = escaped.replace(
    /^&gt;&gt;&gt; ([\s\S]*)$/m,
    (_, content) =>
      `<blockquote class="blockquote">${content.trimEnd()}</blockquote>`
  )
  // > single-line blockquote (per line)
  escaped = escaped.replace(
    /^&gt; (.+)$/gm,
    (_, content) =>
      `<blockquote class="blockquote blockquote-inline">${content}</blockquote>`
  )
  return escaped
}

// ─── Phase 6: Headings ────────────────────────────────────────────────────────

function renderHeadings(escaped: string): string {
  return escaped
    .replace(
      /^### (.+)$/gm,
      (_, t) => `<h3 class="markdown-heading markdown-h3">${t}</h3>`
    )
    .replace(
      /^## (.+)$/gm,
      (_, t) => `<h2 class="markdown-heading markdown-h2">${t}</h2>`
    )
    .replace(
      /^# (.+)$/gm,
      (_, t) => `<h1 class="markdown-heading markdown-h1">${t}</h1>`
    )
}

// ─── Phase 7: Lists ──────────────────────────────────────────────────────────

/**
 * Convert consecutive `- item` / `* item` lines into a <ul>,
 * and `1. item` / `2. item` lines into an <ol>.
 * Both run on already-escaped text.
 */
function renderLists(escaped: string): string {
  // Unordered: consecutive lines starting with `- ` or `* `
  escaped = escaped.replace(
    /((?:^[-*] .+$\n?)+)/gm,
    (block) => {
      const items = block
        .trim()
        .split(/\n/)
        .map(line => line.replace(/^[-*] /, "").trim())
        .filter(Boolean)
        .map(item => `<li>${item}</li>`)
        .join("")
      return `<ul class="markdown-list markdown-ul">${items}</ul>`
    }
  )
  // Ordered: consecutive lines starting with `N. `
  escaped = escaped.replace(
    /((?:^\d+\. .+$\n?)+)/gm,
    (block) => {
      const items = block
        .trim()
        .split(/\n/)
        .map(line => line.replace(/^\d+\. /, "").trim())
        .filter(Boolean)
        .map(item => `<li>${item}</li>`)
        .join("")
      return `<ol class="markdown-list markdown-ol">${items}</ol>`
    }
  )
  return escaped
}

// ─── Phase 8: Inline formatting ──────────────────────────────────────────────

// Apply bold, italic, underline, strikethrough, and spoiler formatting.
//
// Order matters: longer markers must come before shorter ones.
//   __** … **__ -> underline+bold before underline-only or bold-only
//   ***  -> bold+italic before ** or *
//   **   -> bold
//   __   -> underline
//   *x*  -> italic (asterisk)
//   _x_  -> italic (underscore)
//   ~~   -> strikethrough
//   ||   -> spoiler
//
// We deliberately do NOT use a recursive parser here — a simple sequential
// regex approach is sufficient for Discord's relatively flat markdown.
// Each regex only matches within a single "segment" (no cross-<tag> matches)
// because we split on HTML tags before applying inline formatting (see
// applyInlineFormattingToSegments).
function applyInlineFormatting(text: string): string {
  // Bold + italic: ***…***
  text = text.replace(
    /\*{3}(.+?)\*{3}/gs,
    (_, c) =>
      `<strong class="markdown-bold"><em class="markdown-italic">${c}</em></strong>`
  )
  // Underline + bold: __**…**__
  text = text.replace(
    /__\*{2}(.+?)\*{2}__/gs,
    (_, c) =>
      `<u class="markdown-underline"><strong class="markdown-bold">${c}</strong></u>`
  )
  // Bold: **…**
  text = text.replace(
    /\*{2}(.+?)\*{2}/gs,
    (_, c) => `<strong class="markdown-bold">${c}</strong>`
  )
  // Underline: __…__
  text = text.replace(
    /__(.+?)__/gs,
    (_, c) => `<u class="markdown-underline">${c}</u>`
  )
  // Italic: *…* or _…_  (must come after ** and __)
  text = text.replace(
    /\*(.+?)\*/gs,
    (_, c) => `<em class="markdown-italic">${c}</em>`
  )
  text = text.replace(
    /_(.+?)_/gs,
    (_, c) => `<em class="markdown-italic">${c}</em>`
  )
  // Strikethrough: ~~…~~
  text = text.replace(
    /~~(.+?)~~/gs,
    (_, c) => `<s class="markdown-strike">${c}</s>`
  )
  // Spoiler: ||…||
  text = text.replace(
    /\|\|(.+?)\|\|/gs,
    (_, c) =>
      `<span class="spoiler" role="button" tabindex="0" ` +
      `aria-label="Spoiler (click to reveal)">${c}</span>`
  )
  return text
}

/**
 * Apply inline formatting only to plain-text segments — not inside HTML tags.
 * This prevents formatting markers inside attribute values from being processed.
 */
function renderInlineFormatting(mixed: string): string {
  const parts = mixed.split(/(<[^>]+>)/g)
  return parts
    .map((part, i) => (i % 2 === 0 ? applyInlineFormatting(part) : part))
    .join("")
}

// ─── Phase 9: Mentions ────────────────────────────────────────────────────────

function resolveMentions(
  escaped: string,
  participants: ParticipantMap
): string {
  // User / member mentions: &lt;@123&gt; or &lt;@!123&gt;
  escaped = escaped.replace(/&lt;@!?(\d+)&gt;/g, (_, id) => {
    const p = participants.get(id)
    const name = escapeHtml(p ? participantDisplayName(p) : id)
    return `<span class="mention" title="User ID: ${escapeAttribute(id)}">@${name}</span>`
  })
  // Channel mentions: &lt;#123&gt;
  escaped = escaped.replace(
    /&lt;#(\d+)&gt;/g,
    (_, id) => `<span class="mention">#${escapeHtml(id)}</span>`
  )
  // Role mentions: &lt;@&amp;123&gt;
  escaped = escaped.replace(
    /&lt;@&amp;(\d+)&gt;/g,
    (_, id) =>
      `<span class="mention role-mention">@role-${escapeHtml(id)}</span>`
  )
  return escaped
}

// ─── Phase 10: Links (plain-text segments only) ───────────────────────────────

function renderLinks(mixed: string, suppressSet: Set<string>): string {
  const parts = mixed.split(/(<[^>]+>)/g)
  return parts
    .map((part, i) => {
      if (i % 2 !== 0) return part
      return part.replace(/(https?:\/\/[^\s<>"'&]+)/g, (url) => {
        if (suppressSet.has(url)) {
          return (
            `<span class="suppressed-url">` +
            `<a class="link muted-link" href="${escapeAttribute(url)}" ` +
            `target="_blank" rel="noopener noreferrer">${url}</a>` +
            `</span>`
          )
        }
        return (
          `<a class="link" href="${escapeAttribute(url)}" ` +
          `target="_blank" rel="noopener noreferrer">${url}</a>`
        )
      })
    })
    .join("")
}

// ─── Phase 11: Token restoration ─────────────────────────────────────────────

function restoreTokens(mixed: string, tokens: TokenMap): string {
  let out = mixed
  for (const [tok, html] of tokens) {
    out = replaceAll(out, tok, html)
  }
  return out
}

// ─── Public API ───────────────────────────────────────────────────────────────

export interface RenderContext {
  participants: ParticipantMap
  suppressUrls?: Set<string>
}

/**
 * Full safe Discord Markdown rendering pipeline.
 *
 * Input:  raw untrusted message content string
 * Output: safe HTML string suitable for direct insertion into the export page
 *
 * The function is pure — it produces no side effects and uses no DOM APIs.
 */
export function renderDiscordMarkdown(
  content: string,
  ctx: RenderContext
): string {
  const tokens: TokenMap = new Map()
  const suppress = ctx.suppressUrls ?? new Set<string>()

  // Phase 1–3: protect code/emoji regions as tokens (before escaping)
  let out = extractCodeBlocks(content, tokens)
  out = extractInlineCode(out, tokens)
  out = extractCustomEmojis(out, tokens)

  // Phase 4: escape all remaining raw text
  // Tokens are \x02…\x03 control characters — not touched by escapeHtml
  out = escapeHtml(out)

  // Phase 5–8: block and inline markdown on escaped text
  out = renderBlockquotes(out)
  out = renderHeadings(out)
  out = renderLists(out)
  out = renderInlineFormatting(out)

  // Phase 9: mentions
  out = resolveMentions(out, ctx.participants)

  // Phase 10: links (plain-text segments only)
  out = renderLinks(out, suppress)

  // Phase 11: restore protected tokens → safe HTML
  out = restoreTokens(out, tokens)

  // Phase 12: newlines → <br> (after block elements are already wrapped)
  out = out.replace(/\n/g, "<br>")

  return out
}
