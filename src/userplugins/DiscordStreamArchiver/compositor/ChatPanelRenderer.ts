import type { ChatAttachment, ChatMessage, ChatReaction, ChatReplyContext } from "../types";
import { ImageCache } from "./chat/ImageCache";
import { AnimatedEmoteCache } from "./chat/AnimatedEmoteCache";
import { VideoFrameCache } from "./chat/VideoFrameCache";
import { parseContent, type MentionResolvers, type ContentToken } from "./chat/ContentParser";
import { layoutContent, setFontForStyle, type LayoutOp, type RowMeta } from "./chat/ContentLayout";
import { classify, EMOTE_SIZE_DEFAULT, EMOTE_SIZE_JUMBO } from "./chat/MessageSizer";
import { drawEmbed, embedHeight, embedVariant } from "./chat/EmbedRenderer";
import { drawSticker, stickerHeight, STICKER_SIZE } from "./chat/StickerRenderer";
import { drawReactions, reactionsHeight, reactionEmoteUrl } from "./chat/ReactionsRenderer";
import { resolveChatAnimate, type ChatAnimationMode } from "./frameClock";

const PANEL_BG = "#2f3136";
const AUTHOR_COLOR = "#ffffff";
const CONTENT_COLOR = "#dcddde";
const TIMESTAMP_COLOR = "#72767d";
const REPLY_COLOR = "#b9bbbe";
const LINK_COLOR = "#00b0f4";
const CODE_BG = "#2b2d31";

const MESSAGE_PADDING = 12;
const AVATAR_SIZE = 32;
const REPLY_AVATAR_SIZE = 16;
// Emotes inside the reply preview render at line height — small, never jumbo,
// regardless of how the replied-to message itself was sized.
const REPLY_EMOTE_SIZE = 16;
const ATTACHMENT_MAX_WIDTH = 280;
const ATTACHMENT_MAX_HEIGHT = 200;

const AUTHOR_FONT = "bold 15px Whitney, 'Helvetica Neue', Helvetica, Arial, sans-serif";
const TIMESTAMP_FONT = "12px Whitney, 'Helvetica Neue', Helvetica, Arial, sans-serif";
const REPLY_FONT = "12px Whitney, 'Helvetica Neue', Helvetica, Arial, sans-serif";
const CODE_BLOCK_FONT = "13px Consolas, 'Courier New', monospace";

const LINE_HEIGHT = 20;
const SMALL_LINE_HEIGHT = 16;
const ROW_GAP = 10;

export class ChatPanelRenderer {
    private messages: ChatMessage[] = [];
    private messageHeights = new Map<string, number>();
    private messageTokens = new Map<string, ContentToken[]>();
    // Parallel to messageTokens but holds the originalContent's parsed
    // tokens — only populated for edited messages. The renderer draws
    // these in gray above the current content as edit history.
    private messageOriginalTokens = new Map<string, ContentToken[]>();
    // Parsed tokens for the reply preview's snippet, so custom emotes/mentions
    // in a replied-to message render inline instead of as raw "<:name:id>".
    private messageReplyTokens = new Map<string, ContentToken[]>();
    private dirty = true;
    private animationMode: ChatAnimationMode;
    private streamActive = false;
    private images: ImageCache;
    // Avatars get their own cache so the constant churn of large attachment /
    // embed images flowing through `images` can never evict a participant's
    // avatar out from under a message that's about to render it. Avatars are
    // few (bounded by participants) and tiny, so this costs almost nothing.
    private avatars: ImageCache;
    private animated: AnimatedEmoteCache;
    private videos: VideoFrameCache;
    private lastVisibleIds = new Set<string>();
    private mentionResolvers: MentionResolvers;

    constructor(
        private readonly canvas: HTMLCanvasElement,
        resolvers?: MentionResolvers,
        animationMode: ChatAnimationMode = "always"
    ) {
        this.animationMode = animationMode;
        this.images = new ImageCache(() => { this.dirty = true; });
        this.avatars = new ImageCache(() => { this.dirty = true; });
        this.animated = new AnimatedEmoteCache(() => { this.dirty = true; });
        this.videos = new VideoFrameCache(() => { this.dirty = true; });
        this.mentionResolvers = resolvers ?? {
            resolveUser: id => ({ label: `<@${id}>`, color: undefined }),
            resolveRole: id => ({ label: `<@&${id}>`, color: undefined }),
            resolveChannel: id => ({ label: `<#${id}>`, color: undefined })
        };
    }

    setMentionResolvers(resolvers: MentionResolvers): void {
        this.mentionResolvers = resolvers;
        this.messageTokens.clear();
        this.messageOriginalTokens.clear();
        this.messageReplyTokens.clear();
        this.messageHeights.clear();
        for (const m of this.messages) this.cacheTokens(m);
        for (const m of this.messages) this.messageHeights.set(m.id, this.computeHeight(m));
        this.dirty = true;
    }

    pushMessage(msg: ChatMessage): void {
        const idx = this.messages.findIndex(m => m.id === msg.id);
        if (idx >= 0) this.messages[idx] = msg;
        else this.messages.push(msg);
        this.cacheTokens(msg);
        this.preloadMessageImages(msg);
        this.messageHeights.set(msg.id, this.computeHeight(msg));
        this.dirty = true;
    }

    editMessage(msg: ChatMessage): void {
        const idx = this.messages.findIndex(m => m.id === msg.id);
        if (idx < 0) { this.pushMessage(msg); return; }
        this.messages[idx] = msg;
        this.cacheTokens(msg);
        this.preloadMessageImages(msg);
        this.messageHeights.set(msg.id, this.computeHeight(msg));
        this.dirty = true;
    }

    deleteMessage(id: string): void {
        const idx = this.messages.findIndex(m => m.id === id);
        if (idx < 0) return;
        this.messages.splice(idx, 1);
        this.messageHeights.delete(id);
        this.messageTokens.delete(id);
        this.messageOriginalTokens.delete(id);
        this.messageReplyTokens.delete(id);
        this.dirty = true;
    }

    updateReactions(id: string, mutate: (current: ChatReaction[]) => ChatReaction[]): void {
        const m = this.messages.find(x => x.id === id);
        if (!m) return;
        m.reactions = mutate(m.reactions ?? []);
        this.messageHeights.set(id, this.computeHeight(m));
        this.dirty = true;
    }

    getVisibleMessageIds(): ReadonlySet<string> {
        return this.lastVisibleIds;
    }

    hasVisibleAnimation(): boolean {
        if (!this.animationsActive) return false;
        for (const id of this.lastVisibleIds) {
            const m = this.messages.find(x => x.id === id);
            if (m?.hasAnimated) return true;
        }
        return false;
    }

    markDirty(): void { this.dirty = true; }

    private get animationsActive(): boolean {
        return resolveChatAnimate(this.animationMode, this.streamActive);
    }

    setStreamActive(active: boolean): void {
        if (this.streamActive === active) return;
        this.streamActive = active;
        this.dirty = true; // repaint with/without animated frames
    }

    hasPendingRender(): boolean {
        return this.dirty;
    }

    // All animated/video frame draws route through these so a single flag
    // freezes them to their static fallback when animation is inactive.
    private animatedFrame(url: string): CanvasImageSource | null {
        return this.animationsActive ? this.animated.getFrame(url) : null;
    }
    private videoFrame(url: string): CanvasImageSource | null {
        return this.animationsActive ? this.videos.getFrame(url) : null;
    }

    getBitmap(): HTMLCanvasElement {
        if (this.dirty) this.render();
        return this.canvas;
    }

    dispose(): void {
        this.animated.dispose();
        this.videos.dispose();
        // Release the <img> elements these caches parked in the shared DOM
        // container; otherwise they accumulate across sessions and load the
        // compositor (confirmed via the domImgCache debug counter).
        this.images.dispose();
        this.avatars.dispose();
    }

    private cacheTokens(msg: ChatMessage): void {
        this.messageTokens.set(msg.id, parseContent(msg.content, this.mentionResolvers));
        if (msg.originalContent !== undefined) {
            this.messageOriginalTokens.set(msg.id, parseContent(msg.originalContent, this.mentionResolvers));
        } else {
            this.messageOriginalTokens.delete(msg.id);
        }
        if (msg.replyTo) {
            this.messageReplyTokens.set(msg.id, parseContent(msg.replyTo.contentSnippet, this.mentionResolvers));
        } else {
            this.messageReplyTokens.delete(msg.id);
        }
    }

    private preloadMessageImages(msg: ChatMessage): void {
        this.avatars.preload(msg.avatarUrl);
        if (msg.replyTo) {
            this.avatars.preload(msg.replyTo.avatarUrl);
            // Custom emotes in the reply preview share the same CDN URL (and
            // thus cache entry) as emotes in normal message content, so this is
            // a no-op when the emote was already seen elsewhere.
            for (const tok of this.messageReplyTokens.get(msg.id) ?? []) {
                if (tok.kind === "emote") this.preloadMaybeAnimated(tok.url, tok.animated);
            }
        }
        const tokens = this.messageTokens.get(msg.id) ?? [];
        for (const tok of tokens) {
            if (tok.kind === "emote") {
                this.preloadMaybeAnimated(tok.url, tok.animated);
            }
        }
        for (const att of msg.attachments) {
            if (att.isImage) {
                this.preloadMaybeAnimated(att.url, /\.gif(\?|$)/i.test(att.url));
            }
        }
        for (const emb of msg.embeds ?? []) {
            if (emb.author?.iconUrl) this.images.preload(emb.author.iconUrl);
            if (emb.thumbnail?.url) {
                // Image embeds from pasted Discord-CDN GIF links land in
                // emb.thumbnail (Discord's API uses thumbnail for the
                // small preview, even when there's no separate image
                // field). Route through animated cache when the URL looks
                // like it could be animated — .gif, or a /stickers/
                // URL (which is APNG and often animated even with a .png
                // extension).
                if (isUrlLikelyAnimated(emb.thumbnail.url)) this.preloadMaybeAnimated(emb.thumbnail.url, true);
                else this.images.preload(emb.thumbnail.url);
            }
            if (emb.footer?.iconUrl) this.images.preload(emb.footer.iconUrl);
            const isAnimatedEmbed = emb.type === "gifv";
            if (emb.image?.url) {
                this.preloadMaybeAnimated(emb.image.url, isAnimatedEmbed || isUrlLikelyAnimated(emb.image.url));
            }
            if (emb.video?.url) {
                // MP4/WebM (Tenor/Giphy/Twitter gifv) can't go through
                // HTMLImageElement at all — route them to VideoFrameCache
                // which mounts a hidden <video> element and plays it on
                // loop. The drawMedia path will pick it up via the
                // frame-lookup chain.
                if (/\.(mp4|webm|mov)(\?|$)/i.test(emb.video.url)) {
                    this.videos.preload(emb.video.url);
                    // Poster fallback so the embed isn't blank while the
                    // video is still loading (or if it fails).
                    const poster = emb.image?.url ?? emb.thumbnail?.url;
                    if (poster) this.images.preload(poster);
                } else {
                    this.preloadMaybeAnimated(emb.video.url, isAnimatedEmbed);
                }
            }
        }
        for (const st of msg.stickers ?? []) {
            const url = st.formatType === 4
                ? `https://media.discordapp.net/stickers/${st.id}.gif`
                : st.formatType !== 3
                    ? `https://media.discordapp.net/stickers/${st.id}.png`
                    : null;
            if (!url) continue;
            // formatType 2 = APNG (served at `.png` URL). It is animated and
            // must go through AnimatedEmoteCache, same as GIF (formatType 4).
            this.preloadMaybeAnimated(url, st.formatType === 4 || st.formatType === 2);
        }
        for (const r of msg.reactions ?? []) {
            const url = reactionEmoteUrl(r);
            if (!url) continue;
            this.preloadMaybeAnimated(url, !!r.emoji.animated);
        }
    }

    // Animated URLs always go into the static image cache as well: the DOM
    // HTMLImageElement auto-plays GIFs, and with the compositor's periodic
    // dirty-flip each drawImage samples the current frame. That gives a
    // working animation even when ImageDecoder is unavailable or the fetch
    // is blocked. When ImageDecoder does work, getFrame() wins over the
    // static fallback in the draw path.
    private preloadMaybeAnimated(url: string, animated: boolean): void {
        this.images.preload(url);
        if (animated && this.animationMode !== "never") this.animated.preload(url);
    }

    render(): void {
        const ctx = this.canvas.getContext("2d");
        if (!ctx) return;
        const { width, height } = this.canvas;

        ctx.save();
        ctx.fillStyle = PANEL_BG;
        ctx.fillRect(0, 0, width, height);

        const visible: ChatMessage[] = [];
        let usedHeight = 0;
        // Index of the first message that did NOT fully fit (sits just above
        // the top of the visible window), or -1 if every message fit.
        let partialIdx = -1;
        for (let i = this.messages.length - 1; i >= 0; i--) {
            const msg = this.messages[i];
            const h = this.messageHeights.get(msg.id) ?? this.computeHeight(msg);
            if (usedHeight + h + ROW_GAP > height) { partialIdx = i; break; }
            usedHeight += h + ROW_GAP;
            visible.unshift(msg);
        }

        const y0 = height - usedHeight;

        // Partial top message: when a message overflowed the top edge and
        // there's empty space above the first fully-visible message, draw that
        // message's bottom portion into the gap, clipped at the canvas top
        // (negative y — the canvas discards the off-top pixels). Without this a
        // tall message (e.g. a big GIF) vanishes the instant its top crosses
        // the panel border, leaving a blank band until it fully scrolls off.
        const partial = partialIdx >= 0 && y0 > 0 ? this.messages[partialIdx] : null;

        this.lastVisibleIds = new Set(visible.map(m => m.id));
        if (partial) this.lastVisibleIds.add(partial.id);

        if (partial) {
            const hPartial = this.messageHeights.get(partial.id) ?? this.computeHeight(partial);
            // Bottom-align its lower edge to ROW_GAP above the first visible
            // message; its top lands above y=0 and is clipped.
            this.drawMessage(ctx, partial, y0 - ROW_GAP - hPartial, width);
        }

        let y = y0;
        for (const msg of visible) {
            y += this.drawMessage(ctx, msg, y, width);
            y += ROW_GAP;
        }

        ctx.restore();
        this.dirty = false;
    }

    private computeHeight(msg: ChatMessage): number {
        const ctx = this.canvas.getContext("2d");
        if (!ctx) return 50;
        const contentX = MESSAGE_PADDING + AVATAR_SIZE + MESSAGE_PADDING;
        const contentWidth = Math.max(1, this.canvas.width - contentX - MESSAGE_PADDING);

        const tokens = this.messageTokens.get(msg.id) ?? [];
        const kind = classify(msg, tokens);
        const emoteSize = kind === "jumbo-emote" ? EMOTE_SIZE_JUMBO : EMOTE_SIZE_DEFAULT;

        let h = 0;
        if (msg.replyTo) h += SMALL_LINE_HEIGHT + 4;

        h += LINE_HEIGHT;
        if (kind !== "sticker-only" && kind !== "link-only-embed") {
            const origTokens = this.messageOriginalTokens.get(msg.id);
            if (origTokens && origTokens.length > 0) {
                const origLaid = layoutContent(ctx, origTokens, contentWidth, emoteSize);
                for (const meta of origLaid.rowMeta) h += meta.height;
            }
            const laid = layoutContent(ctx, tokens, contentWidth, emoteSize);
            for (const meta of laid.rowMeta) h += meta.height;
        }

        for (const att of msg.attachments) {
            if (att.isImage) h += attachmentDisplayHeight(att) + 6;
            else h += SMALL_LINE_HEIGHT + 4;
        }

        const linkOnly = kind === "link-only-embed";
        for (const emb of msg.embeds ?? []) {
            const v = embedVariant(linkOnly);
            h += embedHeight(ctx, emb, v, contentWidth) + 6;
        }

        if (msg.stickers && msg.stickers.length > 0) {
            h += stickerHeight() + 6;
        }

        if (msg.reactions && msg.reactions.length > 0) {
            h += reactionsHeight(ctx, msg.reactions, contentWidth) + 4;
        }

        return Math.max(h, AVATAR_SIZE);
    }

    private drawMessage(ctx: CanvasRenderingContext2D, msg: ChatMessage, y: number, width: number): number {
        const contentX = MESSAGE_PADDING + AVATAR_SIZE + MESSAGE_PADDING;
        const contentWidth = Math.max(1, width - contentX - MESSAGE_PADDING);
        const tokens = this.messageTokens.get(msg.id) ?? [];
        const kind = classify(msg, tokens);
        const emoteSize = kind === "jumbo-emote" ? EMOTE_SIZE_JUMBO : EMOTE_SIZE_DEFAULT;
        let offset = 0;

        if (msg.replyTo) {
            const replyTokens = this.messageReplyTokens.get(msg.id) ?? [];
            offset += this.drawReplyHeader(ctx, msg.replyTo, replyTokens, y, contentX, contentWidth) + 4;
        }

        const avatarTop = y + offset;
        this.drawAvatar(ctx, msg.avatarUrl, MESSAGE_PADDING, avatarTop, AVATAR_SIZE);

        ctx.font = AUTHOR_FONT;
        ctx.fillStyle = msg.roleColor ?? AUTHOR_COLOR;
        ctx.textBaseline = "top";
        ctx.fillText(msg.authorName, contentX, avatarTop);
        const authorW = ctx.measureText(msg.authorName).width;

        ctx.font = TIMESTAMP_FONT;
        ctx.fillStyle = TIMESTAMP_COLOR;
        // Local wall-clock + timezone, then VOD-relative time in parens, so a
        // viewer can line a chat message up against both real time and the
        // recording's playhead: "14:03:27 UTC-4 (00:01)".
        ctx.fillText(
            `${formatLocalTime(msg.timestampMs)} (${formatRel(msg.relativeMs)})`,
            contentX + authorW + 8,
            avatarTop + 2
        );

        offset += LINE_HEIGHT;

        if (kind !== "sticker-only" && kind !== "link-only-embed") {
            // Edit history: render the original (pre-edit) content above the
            // current content, dimmed via globalAlpha. Mirrors how
            // MessageLogger surfaces edits.
            const origTokens = this.messageOriginalTokens.get(msg.id);
            if (origTokens && origTokens.length > 0) {
                const origLaid = layoutContent(ctx, origTokens, contentWidth, emoteSize);
                ctx.save();
                ctx.globalAlpha = 0.45;
                for (let i = 0; i < origLaid.rows.length; i++) {
                    const row = origLaid.rows[i];
                    const meta = origLaid.rowMeta[i];
                    if (meta.kind === "inline") {
                        this.drawContentRow(ctx, row, contentX, y + offset, meta.height);
                    } else if (meta.kind === "codeBlock" && meta.code) {
                        this.drawCodeBlock(ctx, meta.code.text, contentX, y + offset, contentWidth);
                    } else if (meta.kind === "blockquote" && meta.blockquote) {
                        this.drawBlockquote(ctx, meta.blockquote, contentX, y + offset, meta.height);
                    }
                    offset += meta.height;
                }
                ctx.restore();
            }

            const laid = layoutContent(ctx, tokens, contentWidth, emoteSize);
            // Track the last inline row so we can append "(edit time)"
            // immediately after the final visible character without a
            // line break.
            let lastInlineEndX = -1;
            let lastInlineY = 0;
            let lastInlineHeight = LINE_HEIGHT;
            for (let i = 0; i < laid.rows.length; i++) {
                const row = laid.rows[i];
                const meta = laid.rowMeta[i];
                if (meta.kind === "inline") {
                    this.drawContentRow(ctx, row, contentX, y + offset, meta.height);
                    lastInlineEndX = meta.endX ?? 0;
                    lastInlineY = y + offset;
                    lastInlineHeight = meta.height;
                } else if (meta.kind === "codeBlock" && meta.code) {
                    this.drawCodeBlock(ctx, meta.code.text, contentX, y + offset, contentWidth);
                } else if (meta.kind === "blockquote" && meta.blockquote) {
                    this.drawBlockquote(ctx, meta.blockquote, contentX, y + offset, meta.height);
                }
                offset += meta.height;
            }

            if (msg.editedAtMs !== undefined && lastInlineEndX >= 0) {
                // Compute the edit time relative to the recording start. We
                // don't store relativeMs for edits, but timestampMs and
                // relativeMs together pin the session start point:
                // sessionStart = timestampMs - relativeMs.
                const editRel = msg.editedAtMs - (msg.timestampMs - msg.relativeMs);
                ctx.font = TIMESTAMP_FONT;
                ctx.fillStyle = TIMESTAMP_COLOR;
                ctx.textBaseline = "top";
                // Vertically align with the row's text baseline (matches the
                // text positioning in drawContentRow).
                const textY = lastInlineY + (lastInlineHeight - 14) / 2 + 2;
                ctx.fillText(` (${formatRel(editRel)})`, contentX + lastInlineEndX, textY);
            }
        }

        for (const att of msg.attachments) {
            offset += 4;
            if (att.isImage) {
                const h = attachmentDisplayHeight(att);
                const w = att.width && att.height ? Math.round(att.width * (h / att.height)) : ATTACHMENT_MAX_WIDTH;
                this.drawAttachmentImage(ctx, att.url, contentX, y + offset, Math.min(w, ATTACHMENT_MAX_WIDTH), h);
                offset += h;
            } else {
                ctx.font = "14px Whitney, sans-serif";
                ctx.fillStyle = LINK_COLOR;
                ctx.fillText(`📎 ${att.filename}`, contentX, y + offset);
                offset += SMALL_LINE_HEIGHT;
            }
        }

        const linkOnly = kind === "link-only-embed";
        // Composed frame lookup: video (MP4/WebM) first, then decoded
        // animated (ImageDecoder), then fall through to the static image.
        // First hit wins; the static HTMLImageElement path itself animates
        // GIFs thanks to the DOM-attached container in ImageCache.
        const frameLookup = {
            getFrame: (url: string) =>
                this.videoFrame(url) ?? this.animatedFrame(url)
        };
        for (const emb of msg.embeds ?? []) {
            offset += 6;
            const v = embedVariant(linkOnly);
            offset += drawEmbed(ctx, emb, contentX, y + offset, contentWidth, v, this.images, frameLookup);
        }

        if (msg.stickers) {
            for (const st of msg.stickers) {
                offset += 6;
                drawSticker(ctx, st, contentX, y + offset, this.images, frameLookup);
                offset += STICKER_SIZE;
            }
        }

        if (msg.reactions && msg.reactions.length > 0) {
            offset += 4;
            offset += drawReactions(ctx, msg.reactions, contentX, y + offset, contentWidth, this.images);
        }

        return Math.max(offset, AVATAR_SIZE);
    }

    private drawReplyHeader(
        ctx: CanvasRenderingContext2D,
        reply: ChatReplyContext,
        replyTokens: ContentToken[],
        y: number,
        contentX: number,
        contentWidth: number
    ): number {
        ctx.strokeStyle = "#4f545c";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(MESSAGE_PADDING + AVATAR_SIZE / 2, y + SMALL_LINE_HEIGHT);
        ctx.lineTo(MESSAGE_PADDING + AVATAR_SIZE / 2, y + SMALL_LINE_HEIGHT - 8);
        ctx.lineTo(contentX - 4, y + SMALL_LINE_HEIGHT - 8);
        ctx.stroke();

        this.drawAvatar(ctx, reply.avatarUrl, contentX, y, REPLY_AVATAR_SIZE);

        const textX = contentX + REPLY_AVATAR_SIZE + 6;
        const textW = Math.max(1, contentWidth - REPLY_AVATAR_SIZE - 6);
        ctx.font = REPLY_FONT;
        ctx.fillStyle = REPLY_COLOR;
        ctx.textBaseline = "top";
        const authorLabel = `@${reply.authorName}`;
        ctx.fillText(authorLabel, textX, y + 1);
        const authorW = ctx.measureText(authorLabel).width;
        const snippetX = textX + authorW + 6;
        this.drawReplySnippet(ctx, replyTokens, snippetX, y + 1, Math.max(1, textW - authorW - 6));

        return SMALL_LINE_HEIGHT;
    }

    // Single-line reply preview: text inline with small (line-height) custom
    // emotes, truncated with an ellipsis when it overruns the available width.
    // Distinct from the main content layout — that path wraps and can render
    // jumbo; a reply preview never does either.
    private drawReplySnippet(
        ctx: CanvasRenderingContext2D,
        tokens: ContentToken[],
        x: number, y: number, maxWidth: number
    ): void {
        const right = x + maxWidth;
        const emoteY = y + (SMALL_LINE_HEIGHT - REPLY_EMOTE_SIZE) / 2;
        let cx = x;
        for (const part of flattenReplyTokens(tokens)) {
            if (cx >= right) break;
            if (part.kind === "emote") {
                if (cx + REPLY_EMOTE_SIZE > right) { ctx.fillStyle = "#999"; ctx.fillText("…", cx, y); break; }
                const img = this.animatedFrame(part.url) ?? this.images.get(part.url);
                if (img) ctx.drawImage(img, cx, emoteY, REPLY_EMOTE_SIZE, REPLY_EMOTE_SIZE);
                else { ctx.fillStyle = "#444"; ctx.fillRect(cx, emoteY, REPLY_EMOTE_SIZE, REPLY_EMOTE_SIZE); }
                cx += REPLY_EMOTE_SIZE + 2;
                continue;
            }
            ctx.font = REPLY_FONT;
            ctx.fillStyle = part.color ?? "#999";
            const w = ctx.measureText(part.text).width;
            if (cx + w <= right) {
                ctx.fillText(part.text, cx, y);
                cx += w + 1;
            } else {
                ctx.fillText(truncate(ctx, part.text, Math.max(1, right - cx)), cx, y);
                break;
            }
        }
    }

    private drawContentRow(
        ctx: CanvasRenderingContext2D,
        row: LayoutOp[],
        baseX: number,
        y: number,
        rowHeight: number = LINE_HEIGHT
    ): void {
        ctx.textBaseline = "top";
        // Center each op within the row's true height. For jumbo rows
        // (rowHeight=48) this pushes 14px text down 17px so it sits centered
        // rather than glued to the top.
        const textY = y + (rowHeight - 14) / 2;
        for (const op of row) {
            if (op.op === "text") {
                setFontForStyle(ctx, op.style);
                if (op.style.code) {
                    const w = ctx.measureText(op.text).width + 4;
                    ctx.fillStyle = CODE_BG;
                    ctx.fillRect(baseX + op.x - 2, textY - 2, w, 18);
                }
                ctx.fillStyle = op.style.code ? "#e0e0e0" : CONTENT_COLOR;
                ctx.fillText(op.text, baseX + op.x, textY);
                if (op.style.underline) {
                    const w = ctx.measureText(op.text).width;
                    ctx.fillRect(baseX + op.x, textY + 14, w, 1);
                }
                if (op.style.strike) {
                    const w = ctx.measureText(op.text).width;
                    ctx.fillRect(baseX + op.x, textY + 7, w, 1);
                }
            } else if (op.op === "emote") {
                const size = op.size;
                const emoteY = y + (rowHeight - size) / 2;
                const frame = this.animatedFrame(op.url);
                if (frame) {
                    ctx.drawImage(frame, baseX + op.x, emoteY, size, size);
                } else {
                    const img = this.images.get(op.url);
                    if (img) ctx.drawImage(img, baseX + op.x, emoteY, size, size);
                    else {
                        ctx.fillStyle = "#444";
                        ctx.fillRect(baseX + op.x, emoteY, size, size);
                    }
                }
            } else if (op.op === "unicodeEmoji") {
                // Scale font roughly with size: normal rows get 14px, jumbo
                // rows get size-8 (so 48 → 40px glyphs which visually match
                // jumbo custom emotes). Vertical center within the row.
                const fontSize = op.size <= 22 ? 14 : op.size - 8;
                ctx.font = `${fontSize}px "Twemoji Mozilla","Apple Color Emoji","Segoe UI Emoji","Segoe UI Symbol",sans-serif`;
                ctx.fillStyle = CONTENT_COLOR;
                ctx.fillText(op.char, baseX + op.x, y + (rowHeight - fontSize) / 2);
            } else if (op.op === "mention") {
                ctx.font = "500 14px Whitney, sans-serif";
                ctx.fillStyle = op.color ?? LINK_COLOR;
                ctx.fillText(op.label, baseX + op.x, textY);
            } else if (op.op === "link") {
                ctx.font = "14px Whitney, sans-serif";
                ctx.fillStyle = LINK_COLOR;
                ctx.fillText(op.text, baseX + op.x, textY);
            }
        }
    }

    private drawCodeBlock(
        ctx: CanvasRenderingContext2D,
        text: string,
        x: number, y: number, width: number
    ): void {
        const lines = text.split("\n");
        const h = lines.length * 18 + 12;
        ctx.fillStyle = CODE_BG;
        if ("roundRect" in ctx) {
            // beginPath() is mandatory: roundRect() appends to the current
            // path, so without it fill() would also paint any leftover
            // sub-path (e.g. the avatar clip arc) drawn earlier this message.
            ctx.beginPath();
            (ctx as any).roundRect(x, y, width, h, 4);
            ctx.fill();
        } else {
            ctx.fillRect(x, y, width, h);
        }
        ctx.font = CODE_BLOCK_FONT;
        ctx.fillStyle = "#e0e0e0";
        ctx.textBaseline = "top";
        let cy = y + 6;
        for (const line of lines) {
            ctx.fillText(line, x + 8, cy);
            cy += 18;
        }
    }

    private drawBlockquote(
        ctx: CanvasRenderingContext2D,
        inner: { rows: LayoutOp[][]; rowMeta: RowMeta[] },
        x: number, y: number, h: number
    ): void {
        ctx.fillStyle = "#4f545c";
        ctx.fillRect(x, y, 4, h);
        let cy = y;
        for (let i = 0; i < inner.rows.length; i++) {
            const innerMeta = inner.rowMeta[i];
            // Only the inline case makes sense inside a blockquote; code
            // blocks and nested blockquotes aren't produced by the parser
            // here. Treat everything inline-style with its own height.
            this.drawContentRow(ctx, inner.rows[i], x + 8, cy, innerMeta.height);
            cy += innerMeta.height;
        }
    }

    private drawAvatar(ctx: CanvasRenderingContext2D, url: string, x: number, y: number, size: number): void {
        ctx.save();
        ctx.beginPath();
        ctx.arc(x + size / 2, y + size / 2, size / 2, 0, Math.PI * 2);
        ctx.closePath();
        ctx.clip();
        const img = this.avatars.get(url);
        if (img) ctx.drawImage(img, x, y, size, size);
        else {
            ctx.fillStyle = "#444";
            ctx.fillRect(x, y, size, size);
        }
        ctx.restore();
        // restore() does NOT reset the current path — the clip arc above
        // would otherwise linger as the active sub-path and get filled by the
        // next roundRect-based draw (reaction pill, code block). Clear it so
        // no later fill() can accidentally paint over the avatar.
        ctx.beginPath();
    }

    private drawAttachmentImage(
        ctx: CanvasRenderingContext2D,
        url: string,
        x: number, y: number, w: number, h: number
    ): void {
        ctx.save();
        ctx.fillStyle = "#202225";
        ctx.fillRect(x, y, w, h);
        const frame = this.animatedFrame(url);
        if (frame) ctx.drawImage(frame, x, y, w, h);
        else {
            const img = this.images.get(url);
            if (img) ctx.drawImage(img, x, y, w, h);
        }
        ctx.restore();
    }
}

// Flatten parsed content tokens into a simple inline sequence for the reply
// preview: custom emotes stay as drawable images, everything else collapses to
// styled text (mentions/links keep their accent color, blockquotes flatten in
// place). Code blocks render as plain inline text since the preview is a single
// line.
type ReplyPart = { kind: "emote"; url: string } | { kind: "text"; text: string; color?: string };
function flattenReplyTokens(tokens: ContentToken[]): ReplyPart[] {
    const out: ReplyPart[] = [];
    for (const t of tokens) {
        switch (t.kind) {
            case "emote": out.push({ kind: "emote", url: t.url }); break;
            case "unicodeEmoji": out.push({ kind: "text", text: t.char }); break;
            case "text": out.push({ kind: "text", text: t.text }); break;
            case "mention": out.push({ kind: "text", text: t.label, color: t.color ?? LINK_COLOR }); break;
            case "link": out.push({ kind: "text", text: t.text, color: LINK_COLOR }); break;
            case "codeBlock": out.push({ kind: "text", text: t.text }); break;
            case "blockquote": out.push(...flattenReplyTokens(t.inner)); break;
        }
    }
    return out;
}

// URL-heuristic for "could this be animated media?". .gif is obvious; the
// trickier case is Discord's /stickers/<id>.<ext> URLs, which are usually
// APNG even with a .png extension — we route those through the animated
// decoder and let the decoder itself decide (it skips recursive scheduling
// when the file turns out to be single-frame, so the cost of a false
// positive is just one decode).
function isUrlLikelyAnimated(url: string): boolean {
    if (/\.gif(\?|$)/i.test(url)) return true;
    if (/\/stickers\/\d+\.(png|webp|gif)(\?|$|%)/i.test(url)) return true;
    return false;
}

function attachmentDisplayHeight(att: ChatAttachment): number {
    if (!att.width || !att.height) return ATTACHMENT_MAX_HEIGHT;
    const scale = Math.min(ATTACHMENT_MAX_WIDTH / att.width, ATTACHMENT_MAX_HEIGHT / att.height, 1);
    return Math.round(att.height * scale);
}

function truncate(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
    if (!text) return "";
    if (ctx.measureText(text).width <= maxWidth) return text;
    let lo = 0, hi = text.length;
    while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (ctx.measureText(text.slice(0, mid) + "…").width <= maxWidth) lo = mid; else hi = mid - 1;
    }
    return text.slice(0, lo) + "…";
}

function formatRel(ms: number): string {
    const totalSec = Math.floor(ms / 1000);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    const pad = (n: number) => n.toString().padStart(2, "0");
    return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

// Wall-clock time of a message in the viewer's local timezone, e.g.
// "14:03:27 UTC-4". getTimezoneOffset() returns minutes *behind* UTC (positive
// when behind), so negate it to get the conventional UTC offset sign.
function formatLocalTime(epochMs: number): string {
    const d = new Date(epochMs);
    const pad = (n: number) => n.toString().padStart(2, "0");
    const clock = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
    const offMin = -d.getTimezoneOffset();
    const sign = offMin >= 0 ? "+" : "-";
    const offH = Math.floor(Math.abs(offMin) / 60);
    const offM = Math.abs(offMin) % 60;
    const tz = offM === 0 ? `UTC${sign}${offH}` : `UTC${sign}${offH}:${pad(offM)}`;
    return `${clock} ${tz}`;
}
