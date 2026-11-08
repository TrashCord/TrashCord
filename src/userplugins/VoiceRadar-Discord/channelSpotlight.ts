/*
 * TrashCord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ChannelStore } from "@webpack/common";

import { proveWorking, reportBroken } from "./apiHealth";
import { openChannel } from "./channels";
import { T } from "./i18n";

const ITEM_PREFIX = "channels___";
const SPOTLIGHT_CLASS = "vr-channel-spotlight";
const SPOTLIGHT_MS = 3200;
const FIND_WAIT_MS = 2000;
const POLL_MS = 80;

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

function isServerChannel(channelId: string): boolean {
    try {
        return (ChannelStore.getChannel(channelId) as any)?.guild_id != null;
    } catch {
        return false;
    }
}

function channelItem(channelId: string): HTMLElement | null {
    return document.querySelector<HTMLElement>(`[data-list-item-id="${ITEM_PREFIX}${channelId}"]`);
}

function spotlight(item: HTMLElement) {
    // The list item holds the channel and the people sitting in it.
    const block = item.closest("li") ?? item;

    block.classList.remove(SPOTLIGHT_CLASS);
    void block.offsetWidth;
    block.classList.add(SPOTLIGHT_CLASS);
    setTimeout(() => block.classList.remove(SPOTLIGHT_CLASS), SPOTLIGHT_MS);
}

let latest = 0;

/** Opens the channel the way Discord does, which also scrolls its list there, and then highlights it. */
export async function spotlightChannel(channelId: string): Promise<void> {
    const mine = ++latest;
    openChannel(channelId);

    // A call in direct messages has no row in a server's channel list to light up.
    if (!isServerChannel(channelId)) return;

    const deadline = Date.now() + FIND_WAIT_MS;
    let item = channelItem(channelId);
    while (!item && Date.now() < deadline && mine === latest) {
        await sleep(POLL_MS);
        item = channelItem(channelId);
    }
    if (mine !== latest) return;

    if (item) {
        spotlight(item);
        proveWorking(T.apiShowChannel);
    } else if (!document.querySelector(`[data-list-item-id^="${ITEM_PREFIX}"]`)) {
        reportBroken(T.apiShowChannel);
    }
}
