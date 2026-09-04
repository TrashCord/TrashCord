import { showNotification } from "@api/Notifications";
import { definePluginSettings } from "@api/Settings";
import { Notice } from "@components/Notice";
import definePlugin, { OptionType, PluginNative } from "@utils/types";
import { findByPropsLazy } from "@webpack";
import { Button, ChannelStore, GuildStore, RestAPI, showToast, Toasts, UserStore } from "@webpack/common";

const GiftActions = findByPropsLazy("redeemGiftCode");

function getNative() {
    return (globalThis as any).VencordNative?.pluginHelpers?.NitroSniper as PluginNative<typeof import("./native")> | undefined;
}

interface ClaimRequest {
    code: string;
    source: "discord" | "nighty";
    detectedAccount?: string;
    detectedAccountId?: string;
    authorId?: string;
    authorName?: string;
    authorUsername?: string;
    authorAvatarUrl?: string;
    channelId?: string;
    channelName?: string;
    guildId?: string;
    guildName?: string;
    messageId?: string;
}

interface NightyGiftDetection {
    code: string;
    accountName: string;
    guildName: string;
    channelName: string;
    authorName: string;
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

interface CaptchaProps {
    captchaService?: string;
    sitekey: string;
    captchaSessionId?: string;
    options: { rqdata?: string; rqtoken?: string; };
}

interface CaptchaResult {
    captcha_key: string;
    captcha_rqtoken?: string;
    captcha_session_id?: string;
}

interface VoidSolverTaskResult {
    taskId: string;
    externalTaskId?: string;
    status: string;
    solveTime?: number;
    site?: string;
    createdAt?: string;
    updatedAt?: string;
}

const SUCCESS_COLOR = 0x43b581;
const FAILURE_COLOR = 0xf04747;
const TEST_COLOR = 0x5865f2;
const WEBHOOK_NAME = "NitroSniper";
const SEEN_CAP = 5000;
const GIFT_REGEX = /discord(?:\.gift|\.com\/gifts|app\.com\/gifts)\/([a-zA-Z0-9]{16,24})/g;

const seen = new Set<string>();

let startTime = 0;
let claiming = false;
let attempts = 0;
let successes = 0;
let successAudio: HTMLAudioElement | null = null;
let altListenerId = 0;
let voidSolverTask: VoidSolverTaskResult | undefined;
const queue: ClaimRequest[] = [];

function log(...a: any[]) { if (settings.store.debugLogs) console.log("[NitroSniper]", ...a); }
function warn(...a: any[]) { if (settings.store.debugLogs) console.warn("[NitroSniper]", ...a); }
function err(...a: any[]) { if (settings.store.debugLogs) console.error("[NitroSniper]", ...a); }

function sleep(ms: number) { return new Promise<void>(r => setTimeout(r, ms)); }
function jitter(min: number, max: number) { return min + Math.floor(Math.random() * Math.max(1, max - min)); }

function isCaptchaError(body: any): boolean {
    if (!body) return false;
    if (Array.isArray(body.captcha_key) && body.captcha_key.includes("captcha-required")) return true;
    return typeof body.captcha_sitekey === "string" && body.captcha_sitekey.length > 0;
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

function escapeMarkdown(v: string) { return v.replace(/([\\`*_{}[\]()#+.!|>~-])/g, "\\$1"); }

function buildGiftTypeField(giftType: string | null): WebhookField | null {
    if (!giftType) return null;
    return { name: "Gift Type:", value: escapeMarkdown(giftType), inline: false };
}

function buildDetectionField(r: ClaimRequest): WebhookField {
    const profileUrl = r.detectedAccountId ? `https://discord.com/users/${r.detectedAccountId}` : null;
    const account = r.detectedAccount ?? "Unknown account";
    const source = r.source === "nighty" ? "Nighty alt detector" : "Current Discord client";
    return {
        name: "Detected account:",
        value: `${profileUrl ? `[${escapeMarkdown(account)}](${profileUrl})` : escapeMarkdown(account)}\n${source}`,
        inline: true
    };
}

function buildServerField(r: ClaimRequest): WebhookField {
    return {
        name: "Server:",
        value: escapeMarkdown(r.guildName ?? r.guildId ?? (r.guildId === undefined && r.source === "discord" ? "Direct message" : "Unknown server")),
        inline: true
    };
}

function buildChannelField(r: ClaimRequest): WebhookField {
    const channel = r.channelName
        ? (r.channelName.startsWith("#") ? r.channelName : `#${r.channelName}`)
        : r.channelId ?? (r.guildId ? "Unknown channel" : "Direct message");
    return { name: "Channel:", value: escapeMarkdown(channel), inline: true };
}

function buildAuthorField(r: ClaimRequest): WebhookField | null {
    const label = r.authorName ?? r.authorUsername ?? r.authorId;
    if (!label) return null;
    const profileUrl = r.authorId ? `https://discord.com/users/${r.authorId}` : null;
    return {
        name: "Sender:",
        value: profileUrl ? `[${escapeMarkdown(label)}](${profileUrl})` : escapeMarkdown(label),
        inline: false
    };
}

function buildMessageField(r: ClaimRequest): WebhookField {
    if (r.channelId && r.messageId) {
        const url = `https://discord.com/channels/${r.guildId ?? "@me"}/${r.channelId}/${r.messageId}`;
        return { name: "Jump to message:", value: `[Open original message](${url})`, inline: false };
    }
    return { name: "Jump to message:", value: "Unavailable for Nighty alt detections.", inline: false };
}

function buildClaimLinkField(r: ClaimRequest): WebhookField {
    return { name: "Claim link:", value: `[Open Nitro gift](https://discord.gift/${r.code})`, inline: false };
}

function formatVoidSolverTimestamp(value: string | undefined) {
    if (!value) return "Unknown";
    const timestamp = Date.parse(value);
    return Number.isFinite(timestamp) ? `<t:${Math.floor(timestamp / 1000)}:F>` : escapeMarkdown(value);
}

function buildVoidSolverFields(task: VoidSolverTaskResult | undefined): WebhookField[] {
    if (!task) return [];
    return [
        {
            name: "VoidSolver task:",
            value: `${escapeMarkdown(task.taskId)}${task.externalTaskId ? `\nExternal: ${escapeMarkdown(task.externalTaskId)}` : ""}`,
            inline: false
        },
        {
            name: "Task status:",
            value: `${escapeMarkdown(task.status)}\nToken received: ${task.status === "success" ? "Yes" : "No"}`,
            inline: true
        },
        {
            name: "Solve time:",
            value: task.solveTime === undefined ? "Unknown" : `${task.solveTime.toFixed(2)} seconds`,
            inline: true
        },
        {
            name: "Solved site:",
            value: escapeMarkdown(task.site ?? "Unknown"),
            inline: true
        },
        {
            name: "Task timeline:",
            value: `Created: ${formatVoidSolverTimestamp(task.createdAt)}\nUpdated: ${formatVoidSolverTimestamp(task.updatedAt)}`,
            inline: false
        }
    ];
}

function buildClaimFields(request: ClaimRequest, giftType: string | null, task?: VoidSolverTaskResult) {
    return [
        buildGiftTypeField(giftType),
        buildDetectionField(request),
        buildServerField(request),
        buildChannelField(request),
        buildAuthorField(request),
        buildMessageField(request),
        buildClaimLinkField(request),
        ...buildVoidSolverFields(task)
    ].filter((f): f is WebhookField => f != null);
}

function getResultPresentation(result: WebhookResult) {
    return result === "claimed"
        ? { title: "Yay! Claimed a Nitro!", color: SUCCESS_COLOR }
        : { title: "Failed to claim Nitro..", color: FAILURE_COLOR };
}

function buildClaimEmbed(result: WebhookResult, request: ClaimRequest, giftType: string | null, task?: VoidSolverTaskResult): WebhookEmbed {
    const presentation = getResultPresentation(result);
    const name = request.authorName ?? request.authorUsername;
    return {
        title: presentation.title,
        color: presentation.color,
        fields: buildClaimFields(request, giftType, task),
        timestamp: new Date().toISOString(),
        author: name ? { name, icon_url: request.authorAvatarUrl } : undefined,
        footer: { text: WEBHOOK_NAME }
    };
}

function parseWebhookError(data: string, status: number) {
    if (!data) return `Webhook request failed with status ${status}.`;
    try {
        const body = JSON.parse(data) as { message?: string; errors?: unknown; };
        const detail = [body.message, body.errors ? JSON.stringify(body.errors) : null].filter(Boolean).join(" ");
        return detail ? `Webhook request failed with status ${status}: ${detail}` : `Webhook request failed with status ${status}.`;
    } catch {
        return `Webhook request failed with status ${status}: ${data}`;
    }
}

async function postWebhook(url: URL, payload: WebhookPayload) {
    const native = getNative();
    if (!native) throw new Error("Webhook sending requires desktop native support.");
    const { status, data } = await native.sendWebhook(url.toString(), JSON.stringify(payload));
    if (status < 200 || status >= 300) throw new Error(parseWebhookError(data, status));
}

async function sendClaimWebhook(webhookUrl: string, result: WebhookResult, request: ClaimRequest, giftType: string | null, task?: VoidSolverTaskResult) {
    const url = parseWebhookUrl(webhookUrl);
    if (!url) return;
    await postWebhook(url, {
        username: WEBHOOK_NAME,
        embeds: [buildClaimEmbed(result, request, giftType, task)],
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

function CaptchaWarning() {
    return (
        <Notice.Warning>
            NitroSniper redeems Nitro gift codes automatically, which may violate Discord's Terms of Service. Automatic CAPTCHA solving sends the site key, request data, page URL and user agent to the selected third-party provider and may spend credits. If solving fails or no provider is configured, Discord's normal CAPTCHA modal opens instead.
        </Notice.Warning>
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
    nightyDetection: {
        type: OptionType.BOOLEAN,
        description: "Also snipe codes detected by Nighty Selfbot's Nitro Sniper log (requires Nighty running locally)",
        default: false,
        restartNeeded: false
    },
    captchaProvider: {
        type: OptionType.SELECT,
        description: "Service used to automatically solve redemption hCaptchas",
        options: [
            { label: "NoneCap", value: "nonecap", default: true },
            { label: "NoCaptchaAI", value: "nocaptchaai" },
            { label: "VoidSolver", value: "voidsolver" }
        ]
    },
    noneCapApiKey: {
        type: OptionType.STRING,
        description: "NoneCap API key. Leave empty to use Discord's CAPTCHA modal instead.",
        default: "",
        placeholder: "nc_live_...",
        hidden: () => settings.store.captchaProvider !== "nonecap",
        componentProps: { type: "password", autoComplete: "new-password" }
    },
    noCaptchaAiApiKey: {
        type: OptionType.STRING,
        description: "NoCaptchaAI API key. Leave empty to use Discord's CAPTCHA modal instead.",
        default: "",
        placeholder: "nocap_...",
        hidden: () => settings.store.captchaProvider !== "nocaptchaai",
        componentProps: { type: "password", autoComplete: "new-password" }
    },
    voidSolverApiKey: {
        type: OptionType.STRING,
        description: "VoidSolver API key. Leave empty to use Discord's CAPTCHA modal instead.",
        default: "",
        placeholder: "VoidSolver API key",
        hidden: () => settings.store.captchaProvider !== "voidsolver",
        componentProps: { type: "password", autoComplete: "new-password" }
    },
    voidSolverProxy: {
        type: OptionType.STRING,
        description: "Optional proxy sent to VoidSolver in http://user:pass@ip:port format.",
        default: "",
        placeholder: "http://user:pass@ip:port",
        hidden: () => settings.store.captchaProvider !== "voidsolver"
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
        description: "Log NitroSniper activity to the console.",
        default: false,
        restartNeeded: false
    }
});

function resetState() {
    startTime = Date.now();
    queue.length = 0;
    seen.clear();
    attempts = successes = 0;
    claiming = false;
    voidSolverTask = undefined;
    successAudio = new Audio("https://github.com/d3ad-d3sc3nt/d3ad-d3sc3nt/raw/refs/heads/main/files/omg-poco_ykiLtXO.mp3");
    successAudio.preload = "auto";
}

function buildSummary(...parts: (string | null | undefined)[]): string {
    return parts.filter(Boolean).join(" • ");
}

function buildLocationLabel(r: ClaimRequest): string {
    if (r.source === "nighty") {
        return buildSummary(r.guildName, r.channelName ? `#${r.channelName}` : undefined, r.detectedAccount ? `via ${r.detectedAccount}` : undefined);
    }
    if (!r.guildId) return "DM";
    return buildSummary(r.guildName ?? "Unknown Server", r.channelName ? `#${r.channelName}` : undefined);
}

function notifySuccess(request: ClaimRequest, giftType: string | null, task?: VoidSolverTaskResult) {
    successes++;
    const location = buildLocationLabel(request);
    log(`Redeemed ${request.code} (${successes}/${attempts})`);
    if (settings.store.notifySuccess) {
        showToast(`🎉 Nitro ${successes}/${attempts} | ${buildSummary(request.code.slice(0, 16), giftType, location)}`, Toasts.Type.SUCCESS);
    }
    if (settings.store.notifyNative) {
        showNotification({ title: "NitroSniper - Claimed!", body: buildSummary(`Code: ${request.code.slice(0, 16)}`, giftType, location) });
    }
    if (settings.store.playSound && successAudio) {
        successAudio.currentTime = 0;
        successAudio.play().catch(() => {});
    }
    void sendClaimWebhook(settings.store.webhookUrl, "claimed", request, giftType, task).catch(e => err("claim webhook failed", e));
}

function notifyFailure(request: ClaimRequest, reason: string, giftType: string | null = null, task?: VoidSolverTaskResult) {
    log(`Failed ${request.code}: ${reason}`);
    if (settings.store.notifyFail) {
        showToast(`Failed | ${buildSummary(request.code.slice(0, 16), giftType, reason)}`, Toasts.Type.FAILURE);
    }
    void sendClaimWebhook(settings.store.webhookUrl, "failed", request, giftType, task).catch(e => err("failure webhook failed", e));
}

function extractGiftType(body: any): string | null {
    return body?.subscription_plan?.name ?? body?.store_listing?.sku?.name ?? null;
}

async function fetchGiftType(code: string): Promise<string | null> {
    try {
        const { body } = await RestAPI.get({ url: `/entitlements/gift-codes/${code}?with_application=false&with_subscription_plan=true` });
        return extractGiftType(body);
    } catch {
        return null;
    }
}

async function precheck(code: string): Promise<{ ok: boolean; reason?: string; giftType: string | null; }> {
    try {
        const { body } = await RestAPI.get({ url: `/entitlements/gift-codes/${code}?with_application=false&with_subscription_plan=true` });
        const giftType = extractGiftType(body);
        if (body?.redeemed) return { ok: false, reason: "already claimed", giftType };
        if (body?.uses != null && body?.max_uses != null && body.uses >= body.max_uses) return { ok: false, reason: "already claimed", giftType };
        if (body?.expires_at && Date.parse(body.expires_at) < Date.now()) return { ok: false, reason: "expired", giftType };
        return { ok: true, giftType };
    } catch (e: any) {
        if (isCaptchaError(e?.body)) { warn("captcha on precheck, skipping"); return { ok: true, giftType: null }; }
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
            body: request.channelId ? { channel_id: request.channelId } : {}
        });
        resolvedGiftType = resolvedGiftType ?? await pendingGiftType;
        notifySuccess(request, resolvedGiftType, voidSolverTask);
    } catch (e: any) {
        if (isCaptchaError(e?.body)) {
            warn(`captcha detected for ${request.code}`);
            showToast("NitroSniper: captcha - solving automatically...", Toasts.Type.FAILURE);
            GiftActions?.redeemGiftCode?.({
                code: request.code,
                onRedeemed: async () => notifySuccess(request, resolvedGiftType ?? await pendingGiftType, voidSolverTask),
                onError: async () => notifyFailure(request, "failed after captcha", resolvedGiftType ?? await pendingGiftType, voidSolverTask)
            });
            return;
        }
        if (e?.status === 429) {
            const retryAfter = ((e?.body?.retry_after ?? 5) * 1000) + 250;
            warn(`rate limited, retrying ${request.code} in ${retryAfter}ms`);
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
    if (claiming) return;
    claiming = true;
    try {
        while (queue.length) {
            const item = queue.shift()!;
            await redeemCode(item);
            if (queue.length) await sleep(jitter(5, 25));
        }
    } finally {
        claiming = false;
    }
}

function enqueueNightyDetection(detection: NightyGiftDetection) {
    if (settings.store.antiDuplicate && seen.has(detection.code)) return;
    markSeen(detection.code);
    queue.push({
        code: detection.code,
        source: "nighty",
        detectedAccount: detection.accountName,
        authorName: detection.authorName,
        channelName: detection.channelName,
        guildName: detection.guildName
    });
    void processQueue();
}

async function listenForNightyAltGifts() {
    const native = getNative();
    if (!settings.store.nightyDetection || !native) return;

    const listenerId = ++altListenerId;
    try {
        const error = await native.startNightyAltDetection();
        if (error) { warn(error); return; }

        while (listenerId === altListenerId) {
            const detection = await native.waitForNightyGiftCode();
            if (!detection || listenerId !== altListenerId) return;
            enqueueNightyDetection(detection);
        }
    } catch (e) {
        err("nighty alt detection failed", e);
    }
}

export default definePlugin({
    name: "NitroSniper",
    description: "Advanced Nitro sniper with adaptive logic, auto CAPTCHA solving and Nighty alt detection. ⚠️ Use at your own risk.",
    authors: [{ name: "neoarz", id: 218675193592283137n }, { name: "zfrancesck1", id: 456195985404592149n }],
    tags: ["Utility", "Fun", "Chat", "Nitro"],
    enabledByDefault: false,
    searchTerms: ["nitro", "gift", "redeem", "snipe"],
    settings,
    settingsAboutComponent: CaptchaWarning,
    patches: [{
        find: '"X-Captcha-Key"',
        replacement: {
            match: /return (\i)\.showCaptchaAsync\((\i)\((\i)\.body\)\)/,
            replace: "return $self.solveCaptcha($2($3.body),$1.showCaptchaAsync.bind($1))"
        }
    }],

    async solveCaptcha(props: CaptchaProps, showCaptcha: (props: CaptchaProps) => Promise<CaptchaResult>) {
        const native = getNative();
        const { captchaProvider } = settings.store;
        const apiKey = captchaProvider === "nocaptchaai"
            ? settings.store.noCaptchaAiApiKey.trim()
            : captchaProvider === "voidsolver"
                ? settings.store.voidSolverApiKey.trim()
                : settings.store.noneCapApiKey.trim();
        if (!claiming || !apiKey || props.captchaService !== "hcaptcha" || !native) {
            return showCaptcha(props);
        }

        const result = await native.solveCaptcha(
            captchaProvider,
            apiKey,
            captchaProvider === "voidsolver" ? settings.store.voidSolverProxy.trim() || undefined : undefined,
            props.sitekey,
            props.options.rqdata,
            `${location.origin}/channels/@me`,
            navigator.userAgent
        );
        voidSolverTask = result.task;
        if (!result.success || !result.token) {
            warn(result.error ?? "captcha solve failed");
            return showCaptcha(props);
        }

        return {
            captcha_key: result.token,
            captcha_rqtoken: props.options.rqtoken,
            captcha_session_id: props.captchaSessionId
        };
    },

    start() {
        resetState();
        void listenForNightyAltGifts();
    },

    stop() {
        altListenerId++;
        const native = getNative();
        void native?.stopNightyAltDetection();
        native?.cancelCaptchaSolves();
        resetState();
    },

    flux: {
        MESSAGE_CREATE({ optimistic, type, message }: any) {
            if (optimistic || type !== "MESSAGE_CREATE") return;
            if (!message.content || message.state === "SENDING") return;
            if (!message.content.includes("discord")) return;
            if (Date.parse(message.timestamp) < startTime) return;

            const isDM = !message.guild_id;
            const scope = settings.store.scope;
            if (scope === "guilds" && isDM) return;
            if (scope === "dms" && !isDM) return;

            const currentUser = UserStore.getCurrentUser();
            if (settings.store.ignoreSelf && message.author?.id === currentUser?.id) return;
            if (settings.store.ignoreBots && message.author?.bot) return;

            const codes = [...message.content.matchAll(GIFT_REGEX)].map((m: RegExpMatchArray) => m[1]);
            if (!codes.length) return;

            const authorId = message.author?.id;
            const authorAvatar = message.author?.avatar;
            const guild = message.guild_id ? GuildStore.getGuild(message.guild_id) : undefined;
            const channel = ChannelStore.getChannel(message.channel_id);

            for (const code of codes) {
                if (settings.store.antiDuplicate && seen.has(code)) continue;
                markSeen(code);
                queue.push({
                    code,
                    source: "discord",
                    detectedAccount: currentUser?.globalName ?? currentUser?.username,
                    detectedAccountId: currentUser?.id,
                    authorId,
                    authorName: message.author?.globalName ?? message.author?.username,
                    authorUsername: message.author?.username,
                    authorAvatarUrl: authorId && authorAvatar
                        ? `https://cdn.discordapp.com/avatars/${authorId}/${authorAvatar}.png?size=64`
                        : undefined,
                    channelId: message.channel_id,
                    channelName: channel?.name,
                    guildId: message.guild_id,
                    guildName: guild?.name,
                    messageId: message.id
                });
            }
            void processQueue();
        }
    }
});
