/**
 * htmlExport/layout.ts
 *
 * HTML shell, sidebar, chat header, and messages container rendering.
 * Responsible for the overall page structure of the standalone export.
 */

import type { ExportDocument } from "../../types/export"
import { escapeHtml, escapeAttribute, isSafeUrl } from "./safety"
import {
  buildParticipantMap,
  buildPopoutDataScript,
  makeSvgAvatarDataUri,
  resolveDmDisplayTarget,
} from "./users"
import { renderMessages } from "./messages"
import { HTML_EXPORT_CSS } from "./styles"
import { HTML_EXPORT_CLIENT_SCRIPT } from "./clientScript"
import { HTML_EXPORT_SEARCH_SCRIPT } from "./searchScript"

// ─── Sidebar ──────────────────────────────────────────────────────────────────

function renderSidebar(
  doc: ExportDocument,
  dmDisplayName: string,
  dmAvatarUrl: string | undefined
): string {
  const messageCount = doc.message_count
  const exportedAt   = escapeHtml(doc.exported_at)
  const channelId    = escapeHtml(doc.channel_id)

  // Build the server/DM icon
  let iconHtml: string
  if (dmAvatarUrl && isSafeUrl(dmAvatarUrl)) {
    const src = escapeAttribute(dmAvatarUrl)
    const alt = escapeAttribute(dmDisplayName)
    iconHtml =
      `<div class="server-icon" aria-hidden="true">` +
      `<img src="${src}" alt="${alt}" loading="lazy" ` +
      `onerror="this.onerror=null;this.parentElement.textContent='${escapeAttribute(dmDisplayName[0]?.toUpperCase() ?? "D")}'">` +
      `</div>`
  } else {
    // SVG fallback in sidebar icon
    const letter = escapeHtml((dmDisplayName[0] ?? "D").toUpperCase())
    iconHtml = `<div class="server-icon" aria-hidden="true">${letter}</div>`
  }

  return (
    `<aside class="sidebar" role="complementary" aria-label="Export info">` +
    iconHtml +
    `<div class="sidebar-dm-name">${escapeHtml(dmDisplayName)}</div>` +
    `<div class="sidebar-meta-row">` +
    `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>` +
    `<span>${messageCount} messages</span>` +
    `</div>` +
    `<div class="sidebar-meta-row">` +
    `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>` +
    `<span>${exportedAt}</span>` +
    `</div>` +
    `<div class="sidebar-section">` +
    `<div class="sidebar-label">Channel ID</div>` +
    `<div class="sidebar-value">${channelId}</div>` +
    `</div>` +
    `<div class="sidebar-section">` +
    `<div class="sidebar-label">Exported by</div>` +
    `<div class="sidebar-value">MultiMessageCopy</div>` +
    `</div>` +
    `</aside>`
  )
}

// ─── Chat header ──────────────────────────────────────────────────────────────

function renderChatHeader(displayName: string, messageCount: number): string {
  return (
    `<header class="chat-header">` +
    `<svg class="chat-header-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>` +
    `<span class="chat-header-title">${escapeHtml(displayName)}</span>` +
    `<span class="chat-header-meta">${messageCount} messages exported</span>` +
    `</header>`
  )
}

// ─── Messages area ────────────────────────────────────────────────────────────

function renderMessagesArea(
  displayName: string,
  messageCount: number,
  messagesHtml: string
): string {
  return (
    `<section class="messages" aria-label="Messages">` +
    `<div class="messages-begin">` +
    `<div class="messages-begin-title">${escapeHtml(displayName)}</div>` +
    `<div class="messages-begin-sub">Beginning of exported messages &middot; ${messageCount} total</div>` +
    `</div>` +
    messagesHtml +
    `</section>`
  )
}

// ─── Search bar ──────────────────────────────────────────────────────────────

const SEARCH_BAR_HTML = `
<div class="search-bar" role="search" aria-label="Search messages">
  <div class="search-row">
    <div class="search-input-wrap">
      <svg class="search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
      <input id="search-input" class="search-input" type="search" placeholder="Search messages…" autocomplete="off" spellcheck="false" aria-label="Search messages">
    </div>
    <select id="search-user-filter" class="search-select" aria-label="Filter by user">
      <option value="">All users</option>
    </select>
    <button id="search-clear" class="search-btn search-btn-icon" aria-label="Clear search" title="Clear search">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
    </button>
  </div>
  <div class="search-row search-filters-row">
    <label class="search-filter-label">
      <input id="filter-attachments" class="search-checkbox" type="checkbox" aria-label="Attachments only">
      Attachments
    </label>
    <label class="search-filter-label">
      <input id="filter-links" class="search-checkbox" type="checkbox" aria-label="Links only">
      Links
    </label>
    <label class="search-filter-label">
      <input id="filter-media" class="search-checkbox" type="checkbox" aria-label="Media only">
      Media
    </label>
    <div class="search-spacer"></div>
    <span id="search-result-count" class="search-result-count" aria-live="polite" aria-atomic="true"></span>
    <button id="search-prev" class="search-btn" aria-label="Previous result" disabled>
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="15 18 9 12 15 6"/></svg>
    </button>
    <button id="search-next" class="search-btn" aria-label="Next result" disabled>
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg>
    </button>
  </div>
</div>`

// ─── Overlay dialogs ──────────────────────────────────────────────────────────

const LIGHTBOX_HTML = `
<div class="lightbox" id="lightbox" hidden role="dialog" aria-modal="true" aria-label="Image preview">
  <img class="lightbox-img" id="lightbox-img" src="" alt="">
  <div class="lightbox-footer">
    <span class="lightbox-filename" id="lightbox-filename"></span>
    <a class="lightbox-btn" id="lightbox-open" href="#" target="_blank" rel="noopener noreferrer">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
      Open original
    </a>
    <button class="lightbox-btn" id="lightbox-close" aria-label="Close preview">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      Close
    </button>
  </div>
</div>`

const POPOUT_HTML = `
<div class="popout-overlay" id="popout-overlay" hidden aria-hidden="true"></div>
<div class="popout" id="popout" hidden role="dialog" aria-modal="true" aria-label="User profile">
  <div class="popout-banner" id="popout-banner"></div>
  <div class="popout-body">
    <div class="popout-avatar-wrap">
      <img class="popout-avatar" id="popout-avatar" src="" alt="">
    </div>
    <div class="popout-display-name" id="popout-display-name"></div>
    <div class="popout-username" id="popout-username"></div>
    <div class="popout-divider"></div>
    <div class="popout-field-label">User ID</div>
    <div class="popout-id-row">
      <span class="popout-field-value" id="popout-user-id"></span>
      <button class="popout-copy-btn" id="popout-copy-id" aria-label="Copy user ID">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
        Copy
      </button>
    </div>
    <div class="popout-msg-count" id="popout-msg-count"></div>
  </div>
</div>`

// ─── Full HTML shell ──────────────────────────────────────────────────────────

export function renderHtmlShell(doc: ExportDocument): string {
  const participants    = buildParticipantMap(doc)
  const dmTarget        = resolveDmDisplayTarget(doc, participants)

  const displayName = dmTarget?.displayName ?? doc.channel_name ?? doc.channel_id
  const dmAvatarUrl = dmTarget?.avatarUrl

  const popoutDataScript = buildPopoutDataScript(participants, doc.messages)
  const messagesHtml     = renderMessages(doc.messages, participants)

  const sidebar          = renderSidebar(doc, displayName, dmAvatarUrl)
  const chatHeader       = renderChatHeader(displayName, doc.message_count)
  const messagesArea     = renderMessagesArea(displayName, doc.message_count, messagesHtml)

  const pageTitle = escapeHtml(`Discord Export \u2014 ${displayName}`)

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${pageTitle}</title>
<style>${HTML_EXPORT_CSS}</style>
</head>
<body>
<div class="app-shell">
${sidebar}
<main class="chat" role="main">
${chatHeader}
${SEARCH_BAR_HTML}
${messagesArea}
</main>
</div>
${LIGHTBOX_HTML}
${POPOUT_HTML}
<script>
${popoutDataScript}
${HTML_EXPORT_CLIENT_SCRIPT}
${HTML_EXPORT_SEARCH_SCRIPT}
</script>
</body>
</html>`
}
