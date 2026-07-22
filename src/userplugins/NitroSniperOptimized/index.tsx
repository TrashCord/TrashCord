import { definePluginSettings } from "@api/Settings";
import { Toasts } from "@webpack/common";
import definePlugin, { OptionType } from "@utils/types";
import { UserStore, ChannelStore, GuildStore, RestAPI } from "@webpack/common";
import { showNotification } from "@api/Notifications";

const GIFT_REGEX = /discord(?:\.gift|\.com\/gifts|app\.com\/gifts)\/([a-zA-Z0-9]{16,24})/g;

const settings = definePluginSettings({
    enabled: {
        type: OptionType.BOOLEAN,
        description: "Enable NitroSniper",
        default: true
    },
    scope: {
        type: OptionType.SELECT,
        description: "Where to snipe codes",
        options: [
            { label: "Servers & DMs", value: "both", default: true },
            { label: "Servers only", value: "guilds" },
            { label: "DMs only", value: "dms" }
        ]
    },
    delay: {
        type: OptionType.NUMBER,
        description: "Redeem delay (ms)",
        default: 300
    },
    prevalidate: {
        type: OptionType.BOOLEAN,
        description: "Pre-check codes before redeeming (reduces captchas)",
        default: true
    },
    ignoreSelf: {
        type: OptionType.BOOLEAN,
        description: "Ignore your own messages",
        default: true
    },
    ignoreBots: {
        type: OptionType.BOOLEAN,
        description: "Ignore bot messages",
        default: false
    },
    antiDuplicate: {
        type: OptionType.BOOLEAN,
        description: "Avoid duplicate codes",
        default: true
    },
    notifyToast: {
        type: OptionType.BOOLEAN,
        description: "Toast on success",
        default: true
    },
    notifyFail: {
        type: OptionType.BOOLEAN,
        description: "Toast on failed/invalid codes",
        default: false
    },
    notifyNative: {
        type: OptionType.BOOLEAN,
        description: "Native notifications",
        default: true
    },
    playSound: {
        type: OptionType.BOOLEAN,
        description: "Play success sound",
        default: true
    },
    maxPing: {
        type: OptionType.SLIDER,
        description: "Max ping before pause (ms)",
        default: 300,
        markers: [0, 50, 100, 150, 200, 250, 300, 350, 400, 450, 500],
        stickToMarkers: false,
        componentProps: {
            onValueChange: (v: number) => { settings.store.maxPing = Math.floor(v); },
            onValueRender: (v: number): string => `${Math.floor(v)}`
        }
    }
});

interface QueueEntry {
    code: string;
    channelId: string;
    messageId: string;
    guildId?: string;
}

let startTime = 0;
let processing = false;
let captchaPaused = false;
let pauseToastShown = false;
const SEEN_CAP = 5000;
const seen = new Set<string>();

function markSeen(code: string) {
    if (seen.has(code)) { seen.delete(code); seen.add(code); return; }
    seen.add(code);
    if (seen.size > SEEN_CAP) {
        const toEvict = Math.floor(SEEN_CAP * 0.1);
        let i = 0;
        for (const k of seen) { if (i++ >= toEvict) break; seen.delete(k); }
    }
}
let queue: QueueEntry[] = [];
let attempts = 0;
let successes = 0;

function sleep(ms: number) {
    return new Promise<void>(r => setTimeout(r, ms));
}

function jitter(min: number, max: number) {
    return min + Math.floor(Math.random() * Math.max(1, max - min));
}

function isCaptchaError(body: any): boolean {
    if (!body) return false;
    if (Array.isArray(body.captcha_key) && body.captcha_key.includes("captcha-required")) return true;
    if (typeof body.captcha_sitekey === "string" && body.captcha_sitekey.length > 0) return true;
    return false;
}

function getLocation(channelId: string, guildId?: string): string {
    if (!guildId) return "DM";
    const guild = GuildStore.getGuild(guildId);
    const channel = ChannelStore.getChannel(channelId);
    const guildName = guild?.name ?? "Unknown Server";
    const channelName = channel?.name ? `#${channel.name}` : "";
    return channelName ? `${guildName} / ${channelName}` : guildName;
}

async function getPing(): Promise<number> {
    const start = performance.now();
    try {
        await fetch("https://discord.com/api/v9/experiments");
        return Math.round(performance.now() - start);
    } catch { return 999; }
}

function notifySuccess(code: string, location: string) {
    const msg = `🎉 Nitro ${successes}/${attempts} | ${code.slice(0, 16)}... | ${location}`;
    if (settings.store.notifyToast) {
        Toasts.show({ message: msg, id: Toasts.genId(), type: Toasts.Type.SUCCESS });
    }
    if (settings.store.notifyNative) {
        showNotification({ title: "NitroSniper - Success!", body: `Code: ${code.slice(0, 16)}...\n${location}` });
    }
}

function notifyFail(code: string, reason: string) {
    if (settings.store.notifyFail) {
        Toasts.show({ message: `❌ Failed ${code.slice(0, 16)}...: ${reason}`, id: Toasts.genId(), type: Toasts.Type.FAILURE });
    }
}

function pauseSniper(reason: string) {
    captchaPaused = true;
    queue.length = 0;
    if (pauseToastShown) return;
    pauseToastShown = true;
    Toasts.show({ message: `NitroSniper paused: ${reason}`, id: Toasts.genId(), type: Toasts.Type.FAILURE });
}

async function precheck(code: string): Promise<{ ok: boolean; reason?: string; }> {
    try {
        const { body } = await RestAPI.get({
            url: `/entitlements/gift-codes/${code}?with_application=false&with_subscription_plan=true`
        });
        if (body?.redeemed) return { ok: false, reason: "already claimed" };
        if (body?.uses != null && body?.max_uses != null && body.uses >= body.max_uses) return { ok: false, reason: "already claimed" };
        if (body?.expires_at && Date.parse(body.expires_at) < Date.now()) return { ok: false, reason: "expired" };
        return { ok: true };
    } catch (e: any) {
        if (isCaptchaError(e?.body)) { pauseSniper("captcha on precheck"); return { ok: false, reason: "captcha" }; }
        if (e?.status === 404) return { ok: false, reason: "invalid" };
        return { ok: true };
    }
}

async function redeemCode(item: QueueEntry) {
    const { code, channelId, guildId } = item;
    attempts++;

    if (settings.store.prevalidate) {
        const pre = await precheck(code);
        if (!pre.ok) {
            notifyFail(code, pre.reason ?? "invalid");
            return;
        }
    }

    await sleep(settings.store.delay);

    try {
        await RestAPI.post({
            url: `/entitlements/gift-codes/${code}/redeem`,
            body: { channel_id: channelId }
        });
        successes++;
        notifySuccess(code, getLocation(channelId, guildId));
        if (settings.store.playSound) {
            new Audio("https://github.com/zFrxncesck1/zFrxncesck1/raw/refs/heads/main/host/sounds/omg-poco_ykiLtXO.mp3").play().catch(() => {});
        }
    } catch (e: any) {
        if (isCaptchaError(e?.body)) { pauseSniper("captcha on redeem"); return; }
        if (e?.status === 429) {
            const retryAfter = Number(e?.body?.retry_after ?? 5);
            pauseSniper(`rate limited (${retryAfter}s)`);
            return;
        }
        notifyFail(code, e?.body?.message ?? "Unknown error");
    }
}

async function processQueue() {
    if (processing || !settings.store.enabled) return;
    processing = true;
    try {
        while (queue.length && !captchaPaused && settings.store.enabled) {
            const ping = await getPing();
            if (ping > settings.store.maxPing) { await sleep(3000); continue; }
            const item = queue.shift()!;
            await redeemCode(item);
            if (queue.length && !captchaPaused) await sleep(jitter(400, 1200));
        }
    } finally {
        processing = false;
    }
}

export default definePlugin({
    name: "NitroSniperOptimized",
    description: "Advanced Nitro sniper with adaptive logic and full control. ⚠️ Use at your own risk.",
    authors: [{ name: "zFrxncesck1", id: 456195985404592149n }],
    tags: ["Utility", "Fun", "Chat", "Nitro"],
    enabledByDefault: false,
    settings,

    start() {
        startTime = Date.now();
        queue.length = 0;
        seen.clear();
        attempts = successes = 0;
        processing = captchaPaused = pauseToastShown = false;
    },

    stop() {
        queue.length = 0;
        processing = false;
        captchaPaused = false;
        pauseToastShown = false;
    },

    flux: {
        MESSAGE_CREATE({ optimistic, type, message, guildId }: any) {
            if (optimistic || type !== "MESSAGE_CREATE") return;
            if (!settings.store.enabled || !message.content) return;
            if (message.state === "SENDING") return;
            if (captchaPaused) return;

            const isDM = !message.guild_id;
            const scope = settings.store.scope;
            if (scope === "guilds" && isDM) return;
            if (scope === "dms" && !isDM) return;

            if (settings.store.ignoreSelf && message.author?.id === UserStore.getCurrentUser()?.id) return;
            if (settings.store.ignoreBots && message.author?.bot) return;
            if (new Date(message.timestamp).getTime() < startTime) return;

            const codes = [...message.content.matchAll(GIFT_REGEX)].map(m => m[1]);
            if (!codes.length) return;

            for (const code of codes) {
                if (settings.store.antiDuplicate && seen.has(code)) continue;
                markSeen(code);
                queue.push({ code, channelId: message.channel_id, messageId: message.id, guildId: message.guild_id });
            }
            void processQueue();
        }
    }
});