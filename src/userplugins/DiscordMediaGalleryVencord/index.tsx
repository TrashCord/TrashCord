/*
 * TrashCord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import managedStyle from "./styles.css?managed";

import { definePluginSettings } from "@api/Settings";
import ErrorBoundary from "@components/ErrorBoundary";
import { ImageIcon } from "@components/Icons";
import { Devs } from "@utils/constants";
import definePlugin, { OptionType } from "@utils/types";
import { Channel } from "@vencord/discord-types";
import { ApplicationCommandInputType } from "@vencord/discord-types/enums";
import { findComponentByCodeLazy } from "@webpack";
import { Menu, openModal, SelectedChannelStore } from "@webpack/common";
import type { PropsWithChildren } from "react";

import { MediaGalleryModal } from "./components/MediaGallery";
import { FilterType } from "./types";

const settings = definePluginSettings({
    defaultFilter: {
        type: OptionType.SELECT,
        description: "Default media filter when opening the gallery",
        options: [
            { label: "All Media", value: "all", default: true },
            { label: "Images", value: "images" },
            { label: "Videos", value: "videos" },
            { label: "GIFs", value: "gifs" }
        ]
    },
    downloadConcurrency: {
        type: OptionType.SLIDER,
        description: "Number of concurrent downloads (1 to 5)",
        markers: [1, 2, 3, 4, 5],
        default: 3
    },
    confirmDownload: {
        type: OptionType.BOOLEAN,
        description: "Show confirmation dialog before bulk downloading",
        default: true
    }
});

const HeaderBarIcon = findComponentByCodeLazy(".HEADER_BAR_BADGE_BOTTOM,", 'position:"bottom"');

function GalleryIcon() {
    return (
        <svg viewBox="0 0 24 24" width={18} height={18} fill="currentColor" aria-hidden="true">
            <path d="M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Zm0 2v9.5l4.2-4.2a1.5 1.5 0 0 1 2.1 0l2.7 2.7 1.7-1.7a1.5 1.5 0 0 1 2.1 0l3.2 3.2V6H4Zm0 12h16v-1.7l-4.2-4.2-1.7 1.7a1.5 1.5 0 0 1-2.1 0l-2.7-2.7L4 17.3V18Zm4-8.5A1.5 1.5 0 1 0 8 6.5a1.5 1.5 0 0 0 0 3Z" />
        </svg>
    );
}

function openMediaGallery(channelId?: string) {
    const targetChannelId = channelId || SelectedChannelStore.getChannelId();
    if (!targetChannelId) return;

    openModal(modalProps => (
        <MediaGalleryModal
            initialChannelId={targetChannelId}
            modalProps={modalProps}
            defaultFilter={settings.store.defaultFilter as FilterType}
            concurrency={settings.store.downloadConcurrency}
            confirmDownload={settings.store.confirmDownload}
        />
    ));
}

function patchChannelMenu(children: any[], { channel }: { channel?: Channel; }) {
    if (!channel?.id) return;

    children.push(
        <Menu.MenuItem
            id="vc-open-media-gallery"
            key="vc-open-media-gallery"
            label="Open Media Gallery"
            icon={ImageIcon}
            action={() => openMediaGallery(channel.id)}
        />
    );
}

export default definePlugin({
    name: "MediaGallery",
    description: "Browse images, videos and GIFs in a Telegram-style gallery and selectively download only chosen media.",
    authors: [Devs.Ven],
    tags: ["Media", "Utility", "Customisation"],
    enabledByDefault: false,
    managedStyle,
    settings,
    patches: [
        {
            find: '?"BACK_FORWARD_NAVIGATION":',
            replacement: {
                match: /(trailing:.{0,50}?)\i\.Fragment,(?=\{children:\[)/,
                replace: "$1$self.TrailingWrapper,"
            }
        }
    ],

    TrailingWrapper({ children }: PropsWithChildren) {
        return (
            <>
                {children}
                <ErrorBoundary key="vc-media-gallery" noop>
                    <HeaderBarIcon
                        onClick={() => openMediaGallery(SelectedChannelStore.getChannelId() || undefined)}
                        tooltip="Open Media Gallery"
                        icon={GalleryIcon}
                    />
                </ErrorBoundary>
            </>
        );
    },

    contextMenus: {
        "channel-context": patchChannelMenu,
        "thread-context": patchChannelMenu,
        "gdm-context": patchChannelMenu
    },

    commands: [
        {
            inputType: ApplicationCommandInputType.BUILT_IN,
            name: "media-gallery",
            description: "Open Telegram-style Media Gallery for current channel",
            execute: (_, ctx) => {
                openMediaGallery(ctx.channel.id);
            }
        }
    ]
});
