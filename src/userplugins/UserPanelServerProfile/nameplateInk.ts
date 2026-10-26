/*
 * TrashCord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Logger } from "@utils/Logger";
import { findCssClassesLazy } from "@webpack";
import { GuildMemberStore, SelectedGuildStore, UserStore } from "@webpack/common";

const VAR = "--np-plate";
const ASSETS = "https://cdn.discordapp.com/assets/collectibles/";
const SIZE = 32;

const logger = new Logger("UserPanelServerProfile");
const inks = new Map<string, string>();
const PanelClasses = findCssClassesLazy("panels", "sidebarList", "activityPanel");

let current: string | null = null;
let stores: any[] = [];
let sheet: HTMLStyleElement | undefined;

function paint(ink: string | null) {
    sheet!.textContent = ink ? `.${PanelClasses.panels}{${VAR}:${ink}}` : "";
}

function activeAsset() {
    const user = UserStore.getCurrentUser();
    if (!user) return null;

    const guildId = SelectedGuildStore.getGuildId();
    const member = guildId ? GuildMemberStore.getMember(guildId, user.id) as any : null;

    return (member?.collectibles?.nameplate ?? (user as any).collectibles?.nameplate)?.asset ?? null;
}

function toHex(r: number, g: number, b: number) {
    const lift = Math.max(1, 150 / Math.max(r, g, b));
    const channel = (n: number) => Math.min(255, Math.round(n * lift)).toString(16).padStart(2, "0");
    return `#${channel(r)}${channel(g)}${channel(b)}`;
}

function dominant(data: Uint8ClampedArray) {
    let r = 0, g = 0, b = 0, total = 0;
    let softR = 0, softG = 0, softB = 0, soft = 0;

    for (let i = 0; i < data.length; i += 4) {
        const alpha = data[i + 3] / 255;
        if (alpha < 0.5) continue;

        const [red, green, blue] = [data[i], data[i + 1], data[i + 2]];
        const max = Math.max(red, green, blue);
        const saturation = max === 0 ? 0 : (max - Math.min(red, green, blue)) / max;

        const softWeight = saturation * alpha;
        softR += red * softWeight;
        softG += green * softWeight;
        softB += blue * softWeight;
        soft += softWeight;

        if (max < 40 || saturation < 0.15) continue;

        const weight = saturation * saturation * alpha;
        r += red * weight;
        g += green * weight;
        b += blue * weight;
        total += weight;
    }

    if (total > 0) return toHex(r / total, g / total, b / total);
    // a dark or near-grey plate has no pixel saturated enough for the pass above. weighting
    // the rest by saturation keeps what little colour it has, where a flat mean of every
    // opaque pixel just averages the plate into grey.
    return soft > 0 ? toHex(softR / soft, softG / soft, softB / soft) : null;
}

function read(url: string) {
    return new Promise<string | null>((resolve, reject) => {
        const image = new Image();
        image.crossOrigin = "anonymous";

        image.onload = () => {
            const canvas = document.createElement("canvas");
            canvas.width = canvas.height = SIZE;

            const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
            ctx.drawImage(image, 0, 0, SIZE, SIZE);
            resolve(dominant(ctx.getImageData(0, 0, SIZE, SIZE).data));
        };
        image.onerror = () => reject(new Error(`could not load ${url}`));

        image.src = url;
    });
}

async function apply() {
    const asset = activeAsset();
    if (asset === current) return;
    current = asset;

    if (!asset) return paint(null);

    const known = inks.get(asset);
    if (known) return paint(known);

    // drop the previous plate's ink before reading the new one. animated plates have
    // no static.png, and leaving the old value up paints the panel a colour from a
    // nameplate that is no longer worn - worse than the stylesheet's fallback.
    paint(null);

    try {
        const ink = await read(`${ASSETS}${asset}static.png`);
        if (!ink) return;

        inks.set(asset, ink);
        if (current === asset) paint(ink);
    } catch (err) {
        logger.error("could not read the nameplate colour", err);
    }
}

export function startNameplateInk() {
    sheet = document.createElement("style");
    sheet.id = "vc-nameplate-ink";
    document.head.append(sheet);

    stores = [SelectedGuildStore, UserStore, GuildMemberStore];
    for (const store of stores) store.addChangeListener(apply);
    apply();
}

export function stopNameplateInk() {
    for (const store of stores) store.removeChangeListener(apply);

    stores = [];
    current = null;
    sheet?.remove();
    sheet = undefined;
}
