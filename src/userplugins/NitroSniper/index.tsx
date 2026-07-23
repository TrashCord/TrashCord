import { definePluginSettings } from "@api/Settings";
import { showNotification } from "@api/Notifications";
import { Logger } from "@utils/Logger";
import definePlugin, { OptionType, PluginNative } from "@utils/types";
import { findByPropsLazy } from "@webpack";
import { Button, ChannelStore, GuildStore, RestAPI, showToast, Toasts, UserStore } from "@webpack/common";

const GiftActions = findByPropsLazy("redeemGiftCode");

interface ClaimRequest {
    code: string;
    authorId?: string;
    authorName?: string;
    authorUsername?: string;
    authorAvatarUrl?: string;
    channelId: string;
    guildId?: string;
    messageId: string;
}

type WebhookResult = "claimed" | "failed";

interface WebhookField { name: string; value: string; inline?: boolean; }

interface WebhookEmbed {
    title: string;
    color: number;
    description?: string;
    fields?: WebhookField[];
    timestamp: string;
    author?: { name: string; icon_url?: string; };
    footer?: { text: string; };
}

interface WebhookPayload {
    username: string;
    embeds: WebhookEmbed[];
    allowed_mentions: { parse: string[]; };
}

const SUCCESS_COLOR = 0x43b581;
const FAILURE_COLOR = 0xf04747;
const TEST_COLOR = 0x5865f2;
const WEBHOOK_NAME = "NitroSniper";
const SEEN_CAP = 5000;
const GIFT_REGEX = /discord(?:\.gift|\.com\/gifts|app\.com\/gifts)\/([a-zA-Z0-9]{16,24})/g;

const _logger = new Logger("NitroSniper");
const seen    = new Set<string>();

let startTime = 0;
let processing = false;
let attempts = 0;
let successes = 0;
let successAudio: HTMLAudioElement | null = null;
const queue: ClaimRequest[] = [];

function log(...a: any[]) { if (settings.store.debugLogs) _logger.log(...a); }
function warn(...a: any[]) { if (settings.store.debugLogs) _logger.warn(...a); }
function err(...a: any[]) { if (settings.store.debugLogs) _logger.error(...a); }

function sleep(ms: number) { return new Promise<void>(r => setTimeout(r, ms)); }
function jitter(min: number, max: number) { return min + Math.floor(Math.random() * Math.max(1, max - min)); }

function isCaptchaError(body: any): boolean {
    if (!body) return false;
    if (Array.isArray(body.captcha_key) && body.captcha_key.includes("captcha-required")) return true;
    return typeof body.captcha_sitekey === "string" && body.captcha_sitekey.length > 0;
}

function getLocation(channelId: string, guildId?: string): string {
    if (!guildId) return "DM";
    const guild = GuildStore.getGuild(guildId);
    const channel = ChannelStore.getChannel(channelId);
    const gName = guild?.name ?? "Unknown Server";
    const cName = channel?.name ? `#${channel.name}` : "";
    return cName ? `${gName} / ${cName}` : gName;
}

function markSeen(code: string) {
    if (seen.has(code)) { seen.delete(code); seen.add(code); return; }
    seen.add(code);
    if (seen.size > SEEN_CAP) {
        const evict = Math.floor(SEEN_CAP * 0.1);
        let i = 0;
        for (const k of seen) { if (i++ >= evict) break; seen.delete(k); }
    }
}

function parseWebhookUrl(webhookUrl: string) {
    const trimmed = webhookUrl.trim();
    if (!trimmed) return null;
    try { return new URL(trimmed); }
    catch { throw new Error("Webhook URL is invalid."); }
}

function getNative() {
    const native = (globalThis as any).VencordNative?.pluginHelpers?.NitroSniper as
        PluginNative<typeof import("./native")> | undefined;
    if (!native) throw new Error("Webhook sending requires desktop native support.");
    return native;
}

function escapeMarkdown(v: string) { return v.replace(/([\\`*_{}[\]()#+.!|>~-])/g, "\\$1"); }

function buildAuthorField(r: ClaimRequest): WebhookField | null {
    const label = r.authorName ?? r.authorUsername ?? r.authorId;
    if (!label) return null;
    const profileUrl = r.authorId ? `https://discord.com/users/${r.authorId}` : null;
    return {
        name: "Code sent by:",
        value: profileUrl ? `[${escapeMarkdown(label)}](${profileUrl})` : escapeMarkdown(label),
        inline: false
    };
}

function buildMessageField(r: ClaimRequest): WebhookField | null {
    if (!r.channelId || !r.messageId) return null;
    const url = `https://discordapp.com/channels/${r.guildId ?? "@me"}/${r.channelId}/${r.messageId}`;
    return { name: "Message:", value: `[Posted here!](${url})`, inline: false };
}

function buildGiftTypeField(giftType: string | null): WebhookField | null {
    if (!giftType) return null;
    return { name: "Gift Type:", value: escapeMarkdown(giftType), inline: false };
}

function buildClaimEmbed(result: WebhookResult, r: ClaimRequest, giftType: string | null): WebhookEmbed {
    const name = r.authorName ?? r.authorUsername;
    return {
        title: result === "claimed" ? "Yay! Claimed a Nitro!" : "Failed to claim Nitro..",
        color: result === "claimed" ? SUCCESS_COLOR : FAILURE_COLOR,
        fields: [buildGiftTypeField(giftType), buildAuthorField(r), buildMessageField(r)].filter((f): f is WebhookField => f != null),
        timestamp: new Date().toISOString(),
        author: name ? { name, icon_url: r.authorAvatarUrl } : undefined,
        footer: { text: WEBHOOK_NAME }
    };
}

function parseWebhookError(data: string, status: number) {
    if (!data) return `Webhook request failed with status ${status}.`;
    try {
        const body = JSON.parse(data) as { message?: string; errors?: unknown; };
        const detail = [body.message, body.errors ? JSON.stringify(body.errors) : null].filter(Boolean).join(" ");
        return detail ? `Webhook request failed with status ${status}: ${detail}` : `Webhook request failed with status ${status}.`;
    } catch { return `Webhook request failed with status ${status}: ${data}`; }
}

async function postWebhook(url: URL, payload: WebhookPayload) {
    const { status, data } = await getNative().sendWebhook(url.toString(), JSON.stringify(payload));
    if (status < 200 || status >= 300) throw new Error(parseWebhookError(data, status));
}

async function sendClaimWebhook(webhookUrl: string, result: WebhookResult, request: ClaimRequest, giftType: string | null) {
    const url = parseWebhookUrl(webhookUrl);
    if (!url) return;
    await postWebhook(url, {
        username: WEBHOOK_NAME,
        embeds: [buildClaimEmbed(result, request, giftType)],
        allowed_mentions: { parse: [] }
    });
}

async function sendTestWebhook(webhookUrl: string) {
    const url = parseWebhookUrl(webhookUrl);
    if (!url) throw new Error("Webhook URL is empty.");
    await postWebhook(url, {
        username: WEBHOOK_NAME,
        embeds: [{
            title: "NitroSniper Webhook Test",
            color: TEST_COLOR,
            description: "Your NitroSniper webhook is configured correctly.",
            timestamp: new Date().toISOString(),
            footer: { text: WEBHOOK_NAME }
        }],
        allowed_mentions: { parse: [] }
    });
}

function TestWebhookButton() {
    const { webhookUrl } = settings.use(["webhookUrl"]);
    const disabled = webhookUrl.trim().length === 0;
    return (
        <Button
            disabled={disabled}
            onClick={() => {
                void sendTestWebhook(webhookUrl)
                    .then(() => showToast("Test webhook sent successfully.", Toasts.Type.SUCCESS))
                    .catch((e: unknown) => showToast(e instanceof Error ? e.message : "Failed to send test webhook.", Toasts.Type.FAILURE));
            }}
        >
            Send Test Webhook
        </Button>
    );
}

const settings = definePluginSettings({
    scope: {
        type: OptionType.SELECT,
        description: "Where to snipe codes",
        options: [
            { label: "Servers & DMs", value: "both", default: true },
            { label: "Servers only", value: "guilds" },
            { label: "DMs only", value: "dms" }
        ]
    },
    ignoreSelf: {
        type: OptionType.BOOLEAN,
        description: "Ignore messages sent by you",
        default: true,
        restartNeeded: false
    },
    ignoreBots: {
        type: OptionType.BOOLEAN,
        description: "Ignore bot messages",
        default: false,
        restartNeeded: false
    },
    antiDuplicate: {
        type: OptionType.BOOLEAN,
        description: "Skip already-seen codes (LRU cache, up to 5000 entries)",
        default: true,
        restartNeeded: false
    },
    delay: {
        type: OptionType.NUMBER,
        description: "Redeem delay in milliseconds",
        default: 0,
        restartNeeded: false
    },
    prevalidate: {
        type: OptionType.BOOLEAN,
        description: "Pre-check codes before redeeming (reduces captchas, slightly slower)",
        default: false,
        restartNeeded: false
    },
    notifySuccess: {
        type: OptionType.BOOLEAN,
        description: "Show toast on successful redeem",
        default: true,
        restartNeeded: false
    },
    notifyFail: {
        type: OptionType.BOOLEAN,
        description: "Show toast on failed/invalid codes",
        default: false,
        restartNeeded: false
    },
    notifyNative: {
        type: OptionType.BOOLEAN,
        description: "Show native desktop notification on success",
        default: true,
        restartNeeded: false
    },
    playSound: {
        type: OptionType.BOOLEAN,
        description: "Play sound on successful redeem",
        default: true,
        restartNeeded: false
    },
    webhookUrl: {
        type: OptionType.STRING,
        description: "Discord webhook URL for redeem notifications. Leave empty to disable.",
        default: "",
        restartNeeded: false
    },
    testWebhook: {
        type: OptionType.COMPONENT,
        description: "Send a test message to the configured webhook.",
        component: TestWebhookButton
    },
    debugLogs: {
        type: OptionType.BOOLEAN,
        description: "Enable debug logs in console.",
        default: false,
        restartNeeded: false
    }
});

function resetState() {
    startTime = Date.now();
    queue.length = 0;
    seen.clear();
    attempts = successes = 0;
    processing = false;
    successAudio = new Audio("https://github.com/d3ad-d3sc3nt/d3ad-d3sc3nt/raw/refs/heads/main/files/omg-poco_ykiLtXO.mp3");
    successAudio.preload = "auto";
}

function buildSummary(...parts: (string | null | undefined)[]): string {
    return parts.filter(Boolean).join(" • ");
}

function notifySuccess(request: ClaimRequest, giftType: string | null) {
    successes++;
    const location = getLocation(request.channelId, request.guildId);
    log(`Successfully redeemed code: ${request.code}`);
    if (settings.store.notifySuccess)
        showToast(`🎉 Nitro ${successes}/${attempts} | ${buildSummary(request.code.slice(0, 16), giftType, location)}`, Toasts.Type.SUCCESS);
    if (settings.store.notifyNative)
        showNotification({ title: "NitroSniper - Claimed!", body: buildSummary(`Code: ${request.code.slice(0, 16)}`, giftType, location) });
    if (settings.store.playSound && successAudio) {
        successAudio.currentTime = 0;
        successAudio.play().catch(() => {});
    }
    void sendClaimWebhook(settings.store.webhookUrl, "claimed", request, giftType).catch(e => { err("Claim webhook failed", e); });
}

function notifyFailure(request: ClaimRequest, reason: string, giftType: string | null = null) {
    log(`Failed to redeem: ${request.code} - ${reason}`);
    if (settings.store.notifyFail)
        showToast(`Failed | ${buildSummary(request.code.slice(0, 16), giftType, reason)}`, Toasts.Type.FAILURE);
    void sendClaimWebhook(settings.store.webhookUrl, "failed", request, giftType).catch(e => { err("Failure webhook failed", e); });
}

function extractGiftType(body: any): string | null {
    return body?.subscription_plan?.name ?? body?.store_listing?.sku?.name ?? null;
}

async function fetchGiftType(code: string): Promise<string | null> {
    try {
        const { body } = await RestAPI.get({
            url: `/entitlements/gift-codes/${code}?with_application=false&with_subscription_plan=true`
        });
        return extractGiftType(body);
    } catch {
        return null;
    }
}

async function precheck(code: string): Promise<{ ok: boolean; reason?: string; giftType: string | null; }> {
    try {
        const { body } = await RestAPI.get({
            url: `/entitlements/gift-codes/${code}?with_application=false&with_subscription_plan=true`
        });
        const giftType = extractGiftType(body);
        if (body?.redeemed) return { ok: false, reason: "already claimed", giftType };
        if (body?.uses != null && body?.max_uses != null && body.uses >= body.max_uses) return { ok: false, reason: "already claimed", giftType };
        if (body?.expires_at && Date.parse(body.expires_at) < Date.now()) return { ok: false, reason: "expired", giftType };
        return { ok: true, giftType };
    } catch (e: any) {
        if (isCaptchaError(e?.body)) {
            warn("Captcha on precheck, skipping precheck");
            return { ok: true, giftType: null };
        }
        if (e?.status === 404) return { ok: false, reason: "invalid", giftType: null };
        return { ok: true, giftType: null };
    }
}

async function redeemCode(request: ClaimRequest, isRetry = false, giftTypePromise?: Promise<string | null>) {
    if (!isRetry) attempts++;
    let resolvedGiftType: string | null = null;
    let pendingGiftType: Promise<string | null>;

    if (settings.store.prevalidate) {
        const pre = await precheck(request.code);
        resolvedGiftType = pre.giftType;
        pendingGiftType = Promise.resolve(pre.giftType);
        if (!pre.ok) { notifyFailure(request, pre.reason ?? "invalid", pre.giftType); return; }
    } else {
        const needsGiftType = settings.store.webhookUrl.trim() !== ""
            || settings.store.notifySuccess
            || settings.store.notifyFail
            || settings.store.notifyNative;
        pendingGiftType = giftTypePromise ?? (needsGiftType ? fetchGiftType(request.code) : Promise.resolve(null));
    }

    if (settings.store.delay > 0) await sleep(settings.store.delay);
    try {
        await RestAPI.post({
            url: `/entitlements/gift-codes/${request.code}/redeem`,
            body: { channel_id: request.channelId }
        });
        resolvedGiftType = resolvedGiftType ?? await pendingGiftType;
        notifySuccess(request, resolvedGiftType);
    } catch (e: any) {
        if (isCaptchaError(e?.body)) {
            warn("Captcha detected, delegating to Discord native handler");
            showToast("NitroSniper: captcha - solve it in Discord!", Toasts.Type.FAILURE);
            GiftActions?.redeemGiftCode?.({
                code: request.code,
                onRedeemed: async () => notifySuccess(request, resolvedGiftType ?? await pendingGiftType),
                onError: async () => notifyFailure(request, "failed after captcha", resolvedGiftType ?? await pendingGiftType)
            });
            return;
        }
        if (e?.status === 429) {
            const retryAfter = ((e?.body?.retry_after ?? 5) * 1000) + 250;
            warn(`Rate limited, retrying in ${retryAfter}ms`);
            showToast(`NitroSniper: rate limited, retrying in ${Math.ceil(retryAfter / 1000)}s...`, Toasts.Type.FAILURE);
            await sleep(retryAfter);
            await redeemCode(request, true, pendingGiftType);
            return;
        }
        resolvedGiftType = resolvedGiftType ?? await pendingGiftType;
        notifyFailure(request, e?.body?.message ?? "unknown error", resolvedGiftType);
    }
}

async function processQueue() {
    if (processing) return;
    processing = true;
    try {
        while (queue.length) {
            const item = queue.shift()!;
            await redeemCode(item);
            if (queue.length) await sleep(jitter(5, 25));
        }
    } finally {
        processing = false;
    }
}

export default definePlugin({
    name: "NitroSniper",
    description: "Advanced Nitro sniper with adaptive logic and full control. ⚠️ Use at your own risk.",
    authors: [{ name: "neoarz", id: 218675193592283137n },{ name: "zfrancesck1", id: 456195985404592149n }],
    tags: ["Utility", "Fun", "Chat", "Nitro"],
    enabledByDefault: false,
    searchTerms: ["nitro", "gift", "redeem", "snipe"],
    settings,

    start() { resetState(); },
    stop() { resetState(); },

    flux: {
        MESSAGE_CREATE({ optimistic, type, message }: any) {
            if (optimistic || type !== "MESSAGE_CREATE") return;
            if (!message.content || message.state === "SENDING") return;
            if (!message.content.includes("discord")) return;
            if (Date.parse(message.timestamp) < startTime) return;

            const isDM  = !message.guild_id;
            const scope = settings.store.scope;
            if (scope === "guilds" && isDM) return;
            if (scope === "dms" && !isDM) return;

            if (settings.store.ignoreSelf && message.author?.id === UserStore.getCurrentUser()?.id) return;
            if (settings.store.ignoreBots && message.author?.bot) return;

            const codes = [...message.content.matchAll(GIFT_REGEX)].map((m: RegExpMatchArray) => m[1]);
            if (!codes.length) return;

            const authorId = message.author?.id;
            const authorAvatar = message.author?.avatar;

            for (const code of codes) {
                if (settings.store.antiDuplicate && seen.has(code)) continue;
                markSeen(code);
                queue.push({
                    code,
                    authorId,
                    authorName: message.author?.globalName ?? message.author?.username,
                    authorUsername: message.author?.username,
                    authorAvatarUrl: authorId && authorAvatar
                        ? `https://cdn.discordapp.com/avatars/${authorId}/${authorAvatar}.png?size=64`
                        : undefined,
                    channelId: message.channel_id,
                    guildId: message.guild_id,
                    messageId: message.id
                });
            }
            void processQueue();
        }
    }
});