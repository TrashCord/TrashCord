/**
 * htmlExport/styles.ts
 *
 * All CSS for the standalone HTML export. Kept in one place so it is easy
 * to update without touching logic files.
 */

export const HTML_EXPORT_CSS = `
/* ── Reset ── */
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

/* ── App shell ── */
html, body { height: 100%; }

body {
  background: #313338;
  color: #dbdee1;
  font-family: "gg sans", "Noto Sans", "Helvetica Neue", Helvetica, Arial, sans-serif;
  font-size: 16px;
  line-height: 1.375;
  overflow: hidden;
}

.app-shell {
  display: flex;
  height: 100vh;
  overflow: hidden;
}

/* ── Sidebar ── */
.sidebar {
  width: 240px;
  min-width: 240px;
  background: #2b2d31;
  display: flex;
  flex-direction: column;
  padding: 16px 12px;
  gap: 12px;
  overflow-y: auto;
  border-right: 1px solid #1e1f22;
}

.server-icon {
  width: 48px;
  height: 48px;
  border-radius: 50%;
  background: #5865f2;
  color: #fff;
  font-size: 18px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  margin-bottom: 4px;
  overflow: hidden;
}

.server-icon img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  border-radius: 50%;
}

.sidebar-section { padding: 4px 8px; }

.sidebar-label {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: #949ba4;
  margin-bottom: 4px;
}

.sidebar-value {
  font-size: 13px;
  color: #dbdee1;
  word-break: break-word;
}

.sidebar-dm-name {
  font-size: 15px;
  font-weight: 600;
  color: #f2f3f5;
  padding: 4px 8px;
}

.sidebar-meta-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 8px;
  border-radius: 4px;
  font-size: 13px;
  color: #949ba4;
}

.sidebar-meta-row svg { flex-shrink: 0; color: #6d6f78; }

/* ── Chat area ── */
.chat {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: #313338;
}

/* ── Chat header ── */
.chat-header {
  height: 48px;
  min-height: 48px;
  background: #313338;
  border-bottom: 1px solid #1e1f22;
  display: flex;
  align-items: center;
  padding: 0 16px;
  gap: 12px;
}

.chat-header-icon { color: #949ba4; flex-shrink: 0; }

.chat-header-title {
  font-size: 16px;
  font-weight: 600;
  color: #f2f3f5;
  flex: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.chat-header-meta {
  font-size: 12px;
  color: #6d6f78;
  white-space: nowrap;
}

/* ── Messages container ── */
.messages {
  flex: 1;
  overflow-y: auto;
  padding: 16px 0 32px;
  display: flex;
  flex-direction: column;
}

/* ── Scrollbar ── */
.messages::-webkit-scrollbar { width: 8px; }
.messages::-webkit-scrollbar-track { background: transparent; }
.messages::-webkit-scrollbar-thumb { background: #1a1b1e; border-radius: 4px; }
.messages::-webkit-scrollbar-thumb:hover { background: #111214; }

/* ── Begin-of-chat marker ── */
.messages-begin {
  padding: 16px 16px 24px;
  border-bottom: 1px solid #3f4147;
  margin-bottom: 16px;
}

.messages-begin-title {
  font-size: 28px;
  font-weight: 700;
  color: #f2f3f5;
  margin-bottom: 4px;
}

.messages-begin-sub { font-size: 14px; color: #949ba4; }

/* ── Message layout — stable two-column grid ── */
/*
 * Every <article class="message"> is a two-column flex row:
 *   col 1  .avatar-slot    — fixed 72px (16px padding + 40px avatar + 16px gap)
 *   col 2  .message-main   — flex: 1, all text/media/embeds inside
 *
 * Grouped messages have the same col 1 width (empty slot) so everything
 * aligns perfectly. No negative margins. No absolute positioning hacks.
 */

.message {
  display: flex;
  align-items: flex-start;
  padding: 2px 16px;
  transition: background 80ms;
  position: relative;
  gap: 0;
}

.message:hover { background: rgba(255,255,255,0.03); }

.message-grouped {
  padding-top: 1px;
  padding-bottom: 1px;
}

/* Avatar column — always 56px wide (40px avatar + 16px right margin) */
.avatar-slot {
  width: 56px;
  min-width: 56px;
  flex-shrink: 0;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding-top: 2px;
}

.avatar-slot-grouped {
  align-items: center;
  justify-content: flex-end;
  padding-right: 12px;
}

/* Compact timestamp visible on row hover for grouped messages */
.grouped-timestamp {
  font-size: 11px;
  color: #6d6f78;
  line-height: 1.375rem;
  opacity: 0;
  transition: opacity 80ms;
  pointer-events: none;
  user-select: none;
  white-space: nowrap;
  text-align: right;
  font-style: normal;
}

.message:hover .grouped-timestamp { opacity: 1; }

/* Message main column */
.message-main {
  flex: 1;
  min-width: 0;
  padding-top: 2px;
  padding-bottom: 2px;
}

.message-header {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin-bottom: 2px;
  flex-wrap: wrap;
}

/* ── Avatar ── */
.avatar {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  overflow: hidden;
  transition: opacity 80ms;
}

.avatar:hover { opacity: 0.85; }
.avatar:focus { outline: 2px solid #5865f2; outline-offset: 2px; }

.avatar-img {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  object-fit: cover;
  display: block;
}

/* ── Author + time ── */
.msg-author {
  font-size: 15px;
  font-weight: 600;
  color: #f2f3f5;
  cursor: pointer;
  line-height: 1.375;
}

.msg-author:hover { text-decoration: underline; }

.msg-time {
  font-size: 12px;
  color: #6d6f78;
  line-height: 1.375;
  font-style: normal;
}

/* ── Message content ── */
.message-content {
  font-size: 15px;
  color: #dbdee1;
  word-break: break-word;
  line-height: 1.375rem;
}

/* ── Media container (attachments + CDN media) ── */
.media-container {
  margin-top: 4px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

/* ── Embeds container ── */
.embeds {
  margin-top: 4px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

/* ── Stickers container ── */
.stickers { margin-top: 4px; }

/* ── Reply preview ── */
.reply-preview {
  display: flex;
  align-items: center;
  gap: 6px;
  padding-left: 72px;
  margin-bottom: 2px;
  font-size: 13px;
  color: #949ba4;
}

.reply-icon { flex-shrink: 0; color: #6d6f78; }

.reply-text {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* ── Inline formatting ── */
.mention {
  background: rgba(88,101,242,0.3);
  color: #c9cdfb;
  border-radius: 3px;
  padding: 0 2px;
  cursor: default;
  font-weight: 500;
}

.mention:hover { background: rgba(88,101,242,0.6); color: #fff; }

.role-mention { background: rgba(250,166,26,0.2); color: #faa61a; }
.role-mention:hover { background: rgba(250,166,26,0.4); color: #ffd580; }

.link { color: #00a8fc; text-decoration: none; }
.link:hover { text-decoration: underline; }
.muted-link { color: #6d6f78; font-size: 12px; }
.suppressed-url { display: none; }

.inline-code {
  background: #2b2d31;
  border: 1px solid #1e1f22;
  border-radius: 3px;
  padding: 0 4px;
  font-family: "Consolas", "Andale Mono WT", "Andale Mono", "Lucida Console", monospace;
  font-size: 87.5%;
  color: #dbdee1;
}

.code-block {
  background: #1e1f22;
  border: 1px solid #111214;
  border-radius: 4px;
  padding: 8px 12px;
  margin: 4px 0;
  overflow-x: auto;
  font-family: "Consolas", "Andale Mono WT", "Andale Mono", "Lucida Console", monospace;
  font-size: 87.5%;
  color: #dbdee1;
  white-space: pre;
  line-height: 1.5;
}

.code-block code { background: none; border: none; padding: 0; }

/* ── Custom emoji ── */
.custom-emoji {
  display: inline-block;
  width: 22px;
  height: 22px;
  vertical-align: middle;
  object-fit: contain;
  border-radius: 3px;
  margin: 0 1px;
}

/* ── Attachments ── */
.msg-attachments {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

/* Image grid */
.media-grid { display: grid; gap: 4px; }
.media-grid-1 { grid-template-columns: 1fr; max-width: 420px; }
.media-grid-2 { grid-template-columns: 1fr 1fr; max-width: 420px; }
.media-grid-many { grid-template-columns: 1fr 1fr; max-width: 420px; }

.media-preview {
  position: relative;
  display: inline-flex;
  flex-direction: column;
  cursor: pointer;
  border-radius: 4px;
  overflow: hidden;
  background: #1e1f22;
}

.media-preview:focus { outline: 2px solid #5865f2; outline-offset: 2px; }

.media-img {
  display: block;
  max-width: 100%;
  max-height: 320px;
  width: 100%;
  height: auto;
  object-fit: contain;
  border-radius: 4px;
}

.media-grid-2 .media-img,
.media-grid-many .media-img {
  max-height: 200px;
  object-fit: cover;
}

.media-filename {
  font-size: 11px;
  color: #6d6f78;
  padding: 2px 4px;
  text-align: center;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
}

/* GIF badge */
.media-badge {
  position: absolute;
  bottom: 6px;
  left: 6px;
  padding: 2px 5px;
  border-radius: 3px;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.04em;
  pointer-events: none;
}

.gif-badge { background: rgba(0,0,0,0.7); color: #fff; }

/* Video */
.video-wrap { display: flex; flex-direction: column; gap: 4px; max-width: 420px; }

.media-video {
  display: block;
  max-width: 100%;
  max-height: 320px;
  border-radius: 4px;
  background: #1e1f22;
}

.att-fallback-link { font-size: 12px; color: #00a8fc; text-decoration: none; }
.att-fallback-link:hover { text-decoration: underline; }

/* Audio */
.audio-wrap {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  background: #2b2d31;
  border: 1px solid #1e1f22;
  border-radius: 4px;
  padding: 10px 14px;
  max-width: 420px;
}

.audio-icon { color: #5865f2; flex-shrink: 0; margin-top: 2px; }
.audio-info { display: flex; flex-direction: column; gap: 6px; flex: 1; }
.audio-player { width: 100%; }

/* Generic file card */
.att-card {
  display: flex;
  align-items: center;
  gap: 12px;
  background: #2b2d31;
  border: 1px solid #1e1f22;
  border-radius: 4px;
  padding: 10px 14px;
  max-width: 420px;
  text-decoration: none;
  transition: background 80ms;
}

.att-card:hover { background: #32353b; }
.att-icon { color: #5865f2; flex-shrink: 0; }
.att-meta { display: flex; flex-direction: column; gap: 2px; min-width: 0; }

.att-filename {
  font-size: 14px;
  font-weight: 500;
  color: #00a8fc;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.att-size { font-size: 12px; color: #6d6f78; }

/* ── Embeds ── */
.embed {
  border-left: 4px solid #5865f2;
  background: #2b2d31;
  border-radius: 0 4px 4px 0;
  padding: 10px 14px;
  max-width: 520px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  overflow: hidden;
}

.embed-gif { padding: 0; border-left: none; background: transparent; max-width: 420px; }
.embed-gif-card { padding: 10px 14px; max-width: 420px; }

.embed-provider { font-size: 12px; color: #949ba4; text-decoration: none; }
a.embed-provider:hover { text-decoration: underline; }

.embed-author {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 2px;
}

.embed-author-icon { width: 24px; height: 24px; border-radius: 50%; object-fit: cover; }

.embed-author-name { font-size: 14px; font-weight: 600; color: #f2f3f5; text-decoration: none; }
a.embed-author-name:hover { text-decoration: underline; }

.embed-thumbnail {
  float: right;
  max-width: 80px;
  max-height: 80px;
  border-radius: 4px;
  margin-left: 8px;
  object-fit: cover;
}

.embed-title { font-size: 15px; font-weight: 600; color: #00a8fc; text-decoration: none; }
a.embed-title:hover { text-decoration: underline; }

.embed-desc { font-size: 14px; color: #dbdee1; white-space: pre-wrap; word-break: break-word; }

.embed-url { font-size: 12px; color: #00a8fc; word-break: break-all; text-decoration: none; }
.embed-url:hover { text-decoration: underline; }

.embed-image {
  margin-top: 4px;
  max-width: 100%;
  max-height: 300px;
  border-radius: 4px;
  display: block;
  object-fit: contain;
  clear: both;
}

.embed-video {
  max-width: 100%;
  max-height: 260px;
  border-radius: 4px;
  display: block;
  margin-top: 4px;
  clear: both;
}

.embed-footer {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 4px;
  font-size: 12px;
  color: #949ba4;
  clear: both;
}

.embed-footer-icon { width: 20px; height: 20px; border-radius: 50%; object-fit: cover; }
.embed-footer-sep { color: #6d6f78; }
.embed-footer-ts { color: #6d6f78; }

/* GIF embed */
.gif-video {
  display: block;
  max-width: 100%;
  max-height: 320px;
  border-radius: 4px;
  background: #1e1f22;
}

.gif-img { border-radius: 4px; }

.gif-footer {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 8px;
  font-size: 12px;
  background: #2b2d31;
  border-radius: 0 0 4px 4px;
}

.gif-provider {
  font-weight: 600;
  color: #949ba4;
  text-transform: uppercase;
  font-size: 11px;
  letter-spacing: 0.05em;
}

.gif-title { color: #dbdee1; }
.gif-link { margin-left: auto; }

/* ── Stickers ── */
.msg-stickers { display: flex; gap: 6px; flex-wrap: wrap; }

.sticker-preview {
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
}

.sticker-img {
  max-width: 160px;
  max-height: 160px;
  border-radius: 6px;
  display: block;
  object-fit: contain;
}

.sticker-fallback-card { display: flex; align-items: center; }

.sticker-chip {
  background: #2b2d31;
  border: 1px solid #3f4147;
  border-radius: 12px;
  padding: 3px 10px;
  font-size: 12px;
  color: #b5bac1;
}

/* ── Lightbox ── */
.lightbox {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.85);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  z-index: 9999;
  padding: 24px;
}

.lightbox[hidden] { display: none; }

.lightbox-img {
  max-width: 100%;
  max-height: calc(100vh - 120px);
  border-radius: 4px;
  object-fit: contain;
  display: block;
}

.lightbox-footer {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 12px;
}

.lightbox-filename { font-size: 14px; color: #dbdee1; }

.lightbox-btn {
  background: #4e505a;
  color: #f2f3f5;
  border: none;
  border-radius: 4px;
  padding: 6px 14px;
  font-size: 13px;
  cursor: pointer;
  text-decoration: none;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  transition: background 80ms;
}

.lightbox-btn:hover { background: #6d6f78; }

/* ── User profile popout ── */
.popout-overlay { position: fixed; inset: 0; z-index: 8888; }
.popout-overlay[hidden] { display: none; }

.popout {
  position: fixed;
  z-index: 8889;
  background: #232428;
  border-radius: 8px;
  border: 1px solid #1e1f22;
  box-shadow: 0 8px 32px rgba(0,0,0,0.6);
  width: 260px;
  overflow: hidden;
}

.popout[hidden] { display: none; }

.popout-banner { height: 60px; background: #5865f2; }

.popout-body { padding: 0 16px 16px; position: relative; }

.popout-avatar-wrap {
  position: relative;
  margin-top: -28px;
  margin-bottom: 8px;
  display: inline-block;
}

.popout-avatar {
  width: 80px;
  height: 80px;
  border-radius: 50%;
  border: 6px solid #232428;
  object-fit: cover;
  display: block;
}

.popout-display-name { font-size: 20px; font-weight: 700; color: #f2f3f5; line-height: 1.2; margin-bottom: 2px; }
.popout-username { font-size: 14px; color: #949ba4; margin-bottom: 8px; }
.popout-divider { height: 1px; background: #3f4147; margin: 8px 0; }

.popout-field-label {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: #949ba4;
  margin-bottom: 4px;
}

.popout-field-value { font-size: 13px; color: #dbdee1; word-break: break-all; }

.popout-id-row { display: flex; align-items: center; gap: 8px; margin-top: 2px; }

.popout-copy-btn {
  background: #4e505a;
  color: #f2f3f5;
  border: none;
  border-radius: 3px;
  padding: 3px 8px;
  font-size: 11px;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 4px;
  transition: background 80ms;
  white-space: nowrap;
}

.popout-copy-btn:hover { background: #5865f2; }
.popout-copy-btn.copied { background: #3ba55c; }

.popout-msg-count { font-size: 12px; color: #949ba4; margin-top: 6px; }

/* ── Missing / deleted content card ── */
.missing-content-card {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  background: #1e1f22;
  border: 1px solid #3f4147;
  border-radius: 6px;
  padding: 10px 14px;
  max-width: 420px;
  margin: 2px 0;
}

.missing-content-icon {
  color: #6d6f78;
  flex-shrink: 0;
  margin-top: 1px;
}

.missing-content-body {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.missing-content-text {
  font-size: 13px;
  color: #6d6f78;
  font-style: italic;
}

.missing-link {
  font-size: 11px;
  color: #4f93c0;
  word-break: break-all;
}

/* Sticker wrap — wrapper element for img + fallback pair */
.sticker-wrap {
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
}

/* ── Custom emoji error fallback pill ── */
.emoji-fallback-pill {
  display: inline-block;
  vertical-align: middle;
  background: #2b2d31;
  border: 1px solid #3f4147;
  border-radius: 4px;
  padding: 1px 5px;
  font-size: 13px;
  color: #b5bac1;
  font-family: "Consolas", "Andale Mono WT", "Andale Mono", "Lucida Console", monospace;
  margin: 0 1px;
  cursor: default;
}

/* ── Discord Markdown ── */

/* Inline code */
.inline-code {
  font-family: "Consolas", "Andale Mono WT", "Andale Mono", "Lucida Console", monospace;
  font-size: 0.875em;
  background: #2b2d31;
  border: 1px solid #1e1f22;
  border-radius: 3px;
  padding: 0 4px;
  color: #f2f3f5;
  white-space: pre-wrap;
}

/* Code block */
.code-block-wrap {
  position: relative;
  background: #1e1f22;
  border: 1px solid #3f4147;
  border-radius: 4px;
  margin: 4px 0;
  max-width: 100%;
  overflow: hidden;
}

.code-language {
  display: block;
  font-family: "Consolas", "Andale Mono WT", "Andale Mono", "Lucida Console", monospace;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: #949ba4;
  padding: 6px 12px 0;
  user-select: none;
}

.code-block {
  margin: 0;
  padding: 8px 12px 10px;
  overflow-x: auto;
  white-space: pre;
  font-family: "Consolas", "Andale Mono WT", "Andale Mono", "Lucida Console", monospace;
  font-size: 14px;
  line-height: 1.5;
  color: #dbdee1;
  background: transparent;
  border: none;
  border-radius: 0;
  tab-size: 2;
}

/* Blockquote */
.blockquote {
  border-left: 4px solid #4e505a;
  padding: 2px 0 2px 12px;
  margin: 2px 0;
  color: #dbdee1;
}

.blockquote-inline {
  display: block;
}

/* Headings */
.markdown-heading {
  color: #f2f3f5;
  font-weight: 700;
  line-height: 1.2;
  margin: 6px 0 2px;
}

.markdown-h1 { font-size: 1.5em; border-bottom: 1px solid #3f4147; padding-bottom: 4px; }
.markdown-h2 { font-size: 1.25em; }
.markdown-h3 { font-size: 1.05em; }

/* Lists */
.markdown-list {
  padding-left: 20px;
  margin: 4px 0;
  color: #dbdee1;
}

.markdown-ul { list-style-type: disc; }
.markdown-ol { list-style-type: decimal; }
.markdown-list li { margin: 2px 0; line-height: 1.4; }

/* Inline formatting */
.markdown-bold  { font-weight: 700; }
.markdown-italic { font-style: italic; }
.markdown-underline { text-decoration: underline; }
.markdown-strike { text-decoration: line-through; color: #949ba4; }

/* Spoiler */
.spoiler {
  background: #202225;
  color: transparent;
  border-radius: 3px;
  padding: 0 2px;
  cursor: pointer;
  transition: background 150ms, color 150ms;
  user-select: none;
}

.spoiler:hover,
.spoiler.revealed {
  background: #40444b;
  color: #dbdee1;
}

/* ── Search bar ── */
.search-bar {
  background: #2b2d31;
  border-bottom: 1px solid #1e1f22;
  padding: 8px 16px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  flex-shrink: 0;
}

.search-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.search-input-wrap {
  display: flex;
  align-items: center;
  flex: 1;
  min-width: 160px;
  background: #1e1f22;
  border: 1px solid #3f4147;
  border-radius: 4px;
  padding: 0 10px;
  gap: 8px;
}

.search-input-wrap:focus-within {
  border-color: #5865f2;
}

.search-icon { color: #6d6f78; flex-shrink: 0; }

.search-input {
  background: transparent;
  border: none;
  outline: none;
  color: #dbdee1;
  font-size: 14px;
  padding: 6px 0;
  flex: 1;
  min-width: 0;
}

.search-input::placeholder { color: #4e505a; }

/* Hide the native clear button from type=search */
.search-input::-webkit-search-cancel-button { display: none; }

.search-select {
  background: #1e1f22;
  border: 1px solid #3f4147;
  border-radius: 4px;
  color: #dbdee1;
  font-size: 13px;
  padding: 6px 8px;
  outline: none;
  cursor: pointer;
  min-width: 110px;
  max-width: 180px;
}

.search-select:focus { border-color: #5865f2; }

.search-filters-row { gap: 8px; }

.search-filter-label {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 13px;
  color: #949ba4;
  cursor: pointer;
  user-select: none;
  white-space: nowrap;
}

.search-filter-label:hover { color: #dbdee1; }

.search-checkbox {
  width: 14px;
  height: 14px;
  accent-color: #5865f2;
  cursor: pointer;
}

.search-spacer { flex: 1; }

.search-result-count {
  font-size: 12px;
  color: #949ba4;
  white-space: nowrap;
  min-width: 80px;
  text-align: right;
}

.search-btn {
  background: #1e1f22;
  border: 1px solid #3f4147;
  border-radius: 4px;
  color: #949ba4;
  padding: 5px 8px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 80ms, color 80ms;
  line-height: 1;
}

.search-btn:hover:not(:disabled) { background: #3f4147; color: #dbdee1; }
.search-btn:disabled { opacity: 0.35; cursor: default; }

.search-btn-icon { padding: 5px 6px; }

/* ── Search result highlighting ── */

/* Hidden messages: remove from visual flow but keep in DOM */
.search-hidden { display: none !important; }

/* Currently focused search result */
.search-current {
  outline: 2px solid #5865f2 !important;
  outline-offset: -1px !important;
  background: rgba(88,101,242,0.08) !important;
}

/* ── Responsive ── */
@media (max-width: 680px) {
  body { overflow: auto; }
  .app-shell { flex-direction: column; height: auto; overflow: visible; }
  .sidebar { width: 100%; min-width: 0; flex-direction: row; flex-wrap: wrap; border-right: none; border-bottom: 1px solid #1e1f22; }
  .chat { overflow: visible; }
  .messages { overflow: visible; }
  .media-grid-1, .media-grid-2, .media-grid-many { max-width: 100%; }
  .att-card, .video-wrap, .audio-wrap { max-width: 100%; }
  .embed { max-width: 100%; }
  .embed-gif, .embed-gif-card { max-width: 100%; }
  .search-bar { padding: 8px 10px; }
  .search-select { min-width: 80px; }
}
`
