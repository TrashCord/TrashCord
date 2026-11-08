/*
 * TrashCord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import definePlugin, { OptionType } from "@utils/types";

const STYLE_ID = "vc-media-go-bye-bye";
const REVEALED = "data-mgbb-revealed";

type Mode = "blur" | "spoiler" | "byebye";

const MEDIA = {
    videos: {
        label: "Videos",
        selectors: [
            '[class*="messageAttachment_"]:has(video)',
            '[class*="embedVideo_"]',
            '[class*="embedWrapper_"]:has(video)',
        ],
    },
    images: {
        label: "Images",
        selectors: [
            '[class*="imageWrapper_"]:not(:has(video)):not(:has(img[src*=".gif"])):not(:has(img[src*="tenor"])):not(:has(img[src*="giphy"]))',
            '[class*="messageAttachment_"]:has(img):not(:has(video)):not(:has(img[src*=".gif"]))',
        ],
    },
    gifs: {
        label: "GIFs",
        selectors: [
            '[class*="embedGIFV"]',
            '[class*="imageWrapper_"]:has(img[src*=".gif"])',
            '[class*="imageWrapper_"]:has(img[src*="tenor"])',
            '[class*="imageWrapper_"]:has(img[src*="giphy"])',
        ],
    },
    stickers: {
        label: "Stickers",
        selectors: ['[class*="stickerAsset"]'],
    },
    embeds: {
        label: "Link embeds",
        selectors: [
            '[class*="embedWrapper_"]:not(:has(video))',
            '[class*="embedFull_"]:not(:has(video))',
        ],
    },
} as const;

type MediaKey = keyof typeof MEDIA;
const KEYS = Object.keys(MEDIA) as MediaKey[];

let spoilerSelector = "";

function buildCss() {
    const s = settings.store as Record<string, any>;
    const groups: Record<Mode, string[]> = { blur: [], spoiler: [], byebye: [] };

    for (const key of KEYS) {
        if (!s[`${key}Enabled`]) continue;
        const mode = (s[`${key}UseGlobal`] ? s.globalMode : s[`${key}Mode`]) as Mode;
        groups[mode].push(...MEDIA[key].selectors);
    }

    spoilerSelector = groups.spoiler.join(",");
    const blur = s.blurStrength as number;
    let css = "";

    if (groups.byebye.length) {
        css += `${groups.byebye.join(",\n")} { display: none !important; }\n`;
    }

    if (groups.blur.length) {
        css += `
${groups.blur.join(",\n")} {
    filter: blur(${blur}px) !important;
    transition: filter 0.15s ease;
}
${groups.blur.map(x => `${x}:hover`).join(",\n")} {
    filter: none !important;
}
`;
    }

    if (groups.spoiler.length) {
        const unrevealed = groups.spoiler.map(x => `${x}:not([${REVEALED}])`);
        css += `
${unrevealed.join(",\n")} {
    position: relative !important;
    overflow: hidden !important;
    cursor: pointer !important;
}
${unrevealed.map(x => `${x}::after`).join(",\n")} {
    content: "SPOILER";
    position: absolute;
    inset: 0;
    z-index: 10;
    display: flex;
    align-items: center;
    justify-content: center;
    font: 700 14px sans-serif;
    letter-spacing: 0.12em;
    color: #fff;
    background: rgba(20, 20, 24, 0.55);
    backdrop-filter: blur(${blur}px);
    -webkit-backdrop-filter: blur(${blur}px);
}
`;
    }

    return css;
}

function applyStyle() {
    let el = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
    if (!el) {
        el = document.createElement("style");
        el.id = STYLE_ID;
        document.head.appendChild(el);
    }
    el.textContent = buildCss();
}

function removeStyle() {
    document.getElementById(STYLE_ID)?.remove();
    document.querySelectorAll(`[${REVEALED}]`).forEach(n => n.removeAttribute(REVEALED));
    spoilerSelector = "";
}

function reveal(el: Element) {
    el.setAttribute(REVEALED, "1");
    el.querySelectorAll(spoilerSelector).forEach(n => n.setAttribute(REVEALED, "1"));
    let parent = el.parentElement?.closest(spoilerSelector);
    while (parent) {
        parent.setAttribute(REVEALED, "1");
        parent = parent.parentElement?.closest(spoilerSelector);
    }
}

function onClick(e: MouseEvent) {
    if (!spoilerSelector) return;
    const el = (e.target as Element | null)?.closest?.(spoilerSelector);
    if (!el || el.hasAttribute(REVEALED)) return;

    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    reveal(el);
}

const modeOptions = (def: Mode) => [
    { label: "Blur (hover to reveal)", value: "blur", default: def === "blur" },
    { label: "Spoiler (click to reveal)", value: "spoiler", default: def === "spoiler" },
    { label: "Bye Bye (hidden completely)", value: "byebye", default: def === "byebye" },
];

const enabledOpt = (label: string, def: boolean) => ({
    type: OptionType.BOOLEAN as const,
    description: `Enable for: ${label}`,
    default: def,
    onChange: applyStyle,
});

const useGlobalOpt = (label: string) => ({
    type: OptionType.BOOLEAN as const,
    description: `${label}: use the global mode (turn off to pick a separate mode below)`,
    default: true,
    onChange: applyStyle,
});

const modeOpt = (label: string) => ({
    type: OptionType.SELECT as const,
    description: `${label}: own mode (only used when "use global mode" is off)`,
    options: modeOptions("spoiler"),
    onChange: applyStyle,
});

const settings = definePluginSettings({
    globalMode: {
        type: OptionType.SELECT,
        description: "Global mode, used by every enabled media type that follows it",
        options: modeOptions("spoiler"),
        onChange: applyStyle,
    },
    blurStrength: {
        type: OptionType.SLIDER,
        description: "Blur strength in pixels (Blur and Spoiler modes)",
        markers: [4, 8, 16, 24, 32, 48],
        default: 24,
        stickToMarkers: false,
        onChange: applyStyle,
    },

    videosEnabled: enabledOpt(MEDIA.videos.label, true),
    videosUseGlobal: useGlobalOpt(MEDIA.videos.label),
    videosMode: modeOpt(MEDIA.videos.label),

    imagesEnabled: enabledOpt(MEDIA.images.label, false),
    imagesUseGlobal: useGlobalOpt(MEDIA.images.label),
    imagesMode: modeOpt(MEDIA.images.label),

    gifsEnabled: enabledOpt(MEDIA.gifs.label, false),
    gifsUseGlobal: useGlobalOpt(MEDIA.gifs.label),
    gifsMode: modeOpt(MEDIA.gifs.label),

    stickersEnabled: enabledOpt(MEDIA.stickers.label, false),
    stickersUseGlobal: useGlobalOpt(MEDIA.stickers.label),
    stickersMode: modeOpt(MEDIA.stickers.label),

    embedsEnabled: enabledOpt(MEDIA.embeds.label, false),
    embedsUseGlobal: useGlobalOpt(MEDIA.embeds.label),
    embedsMode: modeOpt(MEDIA.embeds.label),
});

export default definePlugin({
    name: "MediaGoByeBye",
    description: "Blur, spoiler-cover or completely remove videos, images, GIFs, stickers and embeds in chat",
    authors: [{ name: "ItzMeShadow999", id: 1065604516399026176n }],
    tags: ["Chat", "Media", "Appearance", "Utility"],
    enabledByDefault: false,
    settings,
    start() {
        applyStyle();
        document.addEventListener("click", onClick, true);
    },

    stop() {
        document.removeEventListener("click", onClick, true);
        removeStyle();
    },
});
