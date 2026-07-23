/*
 * WeatherStatus — Equicord userplugin
 * Author: Naxiwow — https://github.com/Naxiwow
 */

import { definePluginSettings } from "@api/Settings";
import definePlugin, { OptionType } from "@utils/types";
import { RestAPI } from "@webpack/common";

// ── Weather code → emoji ───────────────────────────────────────────────────────
const WEATHER_EMOJI: Record<number, string> = {
    113: "☀️", 116: "⛅", 119: "☁️", 122: "☁️",
    143: "🌫️", 176: "🌦️", 179: "🌨️", 182: "🌧️", 185: "🌧️",
    200: "⛈️", 227: "🌨️", 230: "❄️", 248: "🌫️", 260: "🌫️",
    263: "🌦️", 266: "🌦️", 281: "🌧️", 284: "🌧️", 293: "🌧️",
    296: "🌧️", 299: "🌧️", 302: "🌧️", 305: "🌧️", 308: "🌧️",
    311: "🌧️", 314: "🌧️", 317: "🌨️", 320: "🌨️", 323: "🌨️",
    326: "🌨️", 329: "❄️", 332: "❄️", 335: "❄️", 338: "❄️",
    350: "🌨️", 353: "🌧️", 356: "🌧️", 359: "🌧️", 362: "🌨️",
    365: "🌨️", 368: "🌨️", 371: "❄️", 374: "🌨️", 377: "🌨️",
    386: "⛈️", 389: "⛈️", 392: "⛈️", 395: "⛈️",
};

function weatherEmoji(code: number): string {
    return WEATHER_EMOJI[code] ?? "🌡️";
}

// ── Settings ───────────────────────────────────────────────────────────────────
const settings = definePluginSettings({
    city: {
        type: OptionType.STRING,
        description: "City name (e.g. Paris, Tokyo, New York)",
        default: "",
        restartNeeded: false,
    },
    unit: {
        type: OptionType.SELECT,
        description: "Temperature unit",
        options: [
            { label: "Celsius (°C)", value: "C", default: true },
            { label: "Fahrenheit (°F)", value: "F" },
        ],
        restartNeeded: false,
    },
    showCondition: {
        type: OptionType.BOOLEAN,
        description: "Show weather condition text (e.g. Partly Cloudy)",
        default: false,
        restartNeeded: false,
    },
    showCity: {
        type: OptionType.BOOLEAN,
        description: "Show city name in status",
        default: true,
        restartNeeded: false,
    },
    updateIntervalMin: {
        type: OptionType.SLIDER,
        description: "Update interval (minutes)",
        markers: [1, 5, 10, 15, 30, 60],
        default: 15,
        stickToMarkers: true,
        restartNeeded: false,
    },
});

// ── Types ──────────────────────────────────────────────────────────────────────
interface WttrCurrent {
    temp_C: string;
    temp_F: string;
    weatherCode: string;
    weatherDesc: { value: string }[];
}

interface WttrResponse {
    current_condition: WttrCurrent[];
}

// ── State ──────────────────────────────────────────────────────────────────────
let updateTimer: number | null = null;
let lastStatus: string | null = null;
let cspRequested = false;

// ── Helpers ────────────────────────────────────────────────────────────────────
async function ensureCsp() {
    if (cspRequested) return;
    cspRequested = true;
    try {
        const url = "https://wttr.in";
        const allowed = await VencordNative.csp.isDomainAllowed(url, ["connect-src"]);
        if (!allowed) await VencordNative.csp.requestAddOverride(url, ["connect-src"], "WeatherStatus");
    } catch { /* not available in all builds */ }
}

async function fetchWeather(city: string): Promise<WttrCurrent | null> {
    try {
        const res = await fetch(`https://wttr.in/${encodeURIComponent(city)}?format=j1`, {
            headers: { "Accept": "application/json" },
        });
        if (!res.ok) return null;
        const data: WttrResponse = await res.json();
        return data?.current_condition?.[0] ?? null;
    } catch { return null; }
}

function buildStatusText(current: WttrCurrent, city: string): string {
    const useF = settings.store.unit === "F";
    const temp = useF ? `${current.temp_F}°F` : `${current.temp_C}°C`;
    const code = parseInt(current.weatherCode, 10);
    const emoji = weatherEmoji(code);
    const condition = current.weatherDesc?.[0]?.value ?? "";

    const parts: string[] = [`${emoji} ${temp}`];
    if (settings.store.showCondition && condition) parts.push(condition);
    if (settings.store.showCity && city) parts.push(`· ${city}`);

    return parts.join(" ").slice(0, 128);
}

async function setStatus(text: string) {
    if (text === lastStatus) return;
    lastStatus = text;
    try {
        await RestAPI.patch({
            url: "/users/@me/settings",
            body: { custom_status: { text: text.slice(0, 128), emoji_name: null, expires_at: null } },
        });
    } catch { /* rate limited or network error */ }
}

async function clearStatus() {
    if (lastStatus === null) return;
    lastStatus = null;
    try {
        await RestAPI.patch({ url: "/users/@me/settings", body: { custom_status: null } });
    } catch { /* ignore */ }
}

async function update() {
    const city = settings.store.city?.trim();
    if (!city) return;

    const current = await fetchWeather(city);
    if (!current) return;

    await setStatus(buildStatusText(current, city));
}

function startPolling() {
    stopPolling();
    void ensureCsp().then(() => void update());

    const intervalMs = (settings.store.updateIntervalMin ?? 15) * 60_000;
    updateTimer = window.setInterval(() => void update(), intervalMs);
}

function stopPolling() {
    if (updateTimer !== null) { window.clearInterval(updateTimer); updateTimer = null; }
}

// ── Plugin ─────────────────────────────────────────────────────────────────────
export default definePlugin({
    name: "WeatherStatus",
    description: "Auto-updates your Discord custom status with live weather for your city — by Naxiwow (github.com/Naxiwow)",
    authors: [{ name: "Naxiwow", id: 875342291001278504n }],
    tags: ["Weather", "Status", "Utility", "Appearance", "Customisation"],
    enabledByDefault: false,
    settings,
    requiresRestart: false,

    start() {
        startPolling();
    },

    stop() {
        stopPolling();
        void clearStatus();
    },
});