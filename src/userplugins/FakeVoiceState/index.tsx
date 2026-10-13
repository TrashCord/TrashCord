/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { Devs } from "@utils/constants";
import definePlugin, { OptionType } from "@utils/types";
import { findByPropsLazy } from "@webpack";
import { ApplicationStreamingStore, ChannelStore, Menu, SelectedChannelStore, UserStore } from "@webpack/common";

const MediaEngineActions = findByPropsLazy("toggleSelfMute");
const NotificationSettingsStore = findByPropsLazy("getDisableAllSounds", "getState");
const GatewaySocket = findByPropsLazy("getSocket");

let isFakeStreamActive = false;

function hasActiveStream() {
    return ApplicationStreamingStore?.getCurrentUserActiveStream?.() != null;
}

function isFakeStreamOn() {
    return isFakeStreamActive && hasActiveStream();
}

function onGoLiveSource(e?: { settings?: { desktopSettings?: { sourceId?: string; }; }; }) {
    if (e?.settings?.desktopSettings?.sourceId) isFakeStreamActive = false;
}

function sendFakeStreamState() {
    try {
        const channelId = SelectedChannelStore?.getVoiceChannelId?.();
        if (!channelId) return;

        const socket = GatewaySocket?.getSocket?.();
        if (!socket) return;

        const channel = ChannelStore?.getChannel?.(channelId);
        const guildId = channel?.guild_id ?? null;

        if (isFakeStreamActive) {
            socket.send(18, {
                type: guildId ? "guild" : "call",
                guild_id: guildId,
                channel_id: channelId,
                preferred_region: null
            });
        } else {
            const currentUserId = UserStore?.getCurrentUser()?.id;
            if (!currentUserId) return;

            const streamKey = guildId
                ? `guild:${guildId}:${channelId}:${currentUserId}`
                : `call:${channelId}:${currentUserId}`;
            socket.send(19, { stream_key: streamKey });
        }
    } catch { }
}

function update() {
    const state = NotificationSettingsStore.getState();
    const toDisable: string[] = [];
    if (!state.disabledSounds.includes("mute")) toDisable.push("mute");
    if (!state.disabledSounds.includes("unmute")) toDisable.push("unmute");

    state.disabledSounds.push(...toDisable);
    MediaEngineActions.toggleSelfMute();
    MediaEngineActions.toggleSelfMute();
    state.disabledSounds = state.disabledSounds.filter((i: string) => !toDisable.includes(i));
}

export const settings = definePluginSettings({
    autoMute: {
        type: OptionType.BOOLEAN,
        description: "Automatically mute when deafened.",
        default: false
    }
});

const fakeVoiceState = {
    _selfMute: false,
    get selfMute() {
        try {
            if (!settings.store.autoMute) return this._selfMute;
            return this.selfDeaf || this._selfMute;
        } catch (e) {
            return this._selfMute;
        }
    },
    set selfMute(value) {
        this._selfMute = value;
    },
    selfDeaf: false,
    selfVideo: false
};

const StateKeys = ["selfDeaf", "selfMute", "selfVideo"];

export default definePlugin({
    name: "FakeVoiceState",
    description: "Fake mute, deafen, camera and stream while still being able to speak and be heard. Optional AutoMute when fake deafened.",
    authors: [Devs.feelslove, { name: "zfrancesck1", id: 456195985404592149n }],
    tags: ["Voice", "Privacy", "Fun"],
    enabledByDefault: true,
    settings,
    flux: {
        MEDIA_ENGINE_SET_GO_LIVE_SOURCE: onGoLiveSource
    },
    stop() {
        if (isFakeStreamOn()) {
            isFakeStreamActive = false;
            sendFakeStreamState();
        }
    },
    modifyVoiceState(e) {
        for (const key of StateKeys) {
            e[key] = fakeVoiceState[key] || e[key];
        }
        return e;
    },
    contextMenus: {
        "audio-device-context"(children, d) {
            if (d.renderInputDevices) {
                children.push(
                    <Menu.MenuSeparator />,
                    <Menu.MenuCheckboxItem
                        id="fake-mute"
                        label="Fake Mute"
                        checked={fakeVoiceState.selfMute}
                        action={() => {
                            fakeVoiceState.selfMute = !fakeVoiceState.selfMute;
                            update();
                        }}
                    />
                );
            }

            if (d.renderOutputDevices) {
                children.push(
                    <Menu.MenuSeparator />,
                    <Menu.MenuCheckboxItem
                        id="auto-mute-fake-deafen"
                        label="AutoMute (FakeDeafen)"
                        checked={settings.store.autoMute}
                        action={() => {
                            settings.store.autoMute = !settings.store.autoMute;
                        }}
                    />,
                    <Menu.MenuCheckboxItem
                        id="fake-deafen"
                        label="Fake Deafen"
                        checked={fakeVoiceState.selfDeaf}
                        action={() => {
                            fakeVoiceState.selfDeaf = !fakeVoiceState.selfDeaf;
                            update();
                        }}
                    />
                );
            }
        },
        "video-device-context"(children) {
            children.push(
                <Menu.MenuSeparator />,
                <Menu.MenuCheckboxItem
                    id="fake-video"
                    label="Fake Camera"
                    checked={fakeVoiceState.selfVideo}
                    action={() => {
                        fakeVoiceState.selfVideo = !fakeVoiceState.selfVideo;
                        update();
                    }}
                />,
                <Menu.MenuCheckboxItem
                    id="fake-stream"
                    label="Fake Stream"
                    checked={isFakeStreamOn()}
                    disabled={hasActiveStream() && !isFakeStreamOn()}
                    action={() => {
                        if (isFakeStreamOn()) {
                            isFakeStreamActive = false;
                            sendFakeStreamState();
                        } else if (!hasActiveStream()) {
                            isFakeStreamActive = true;
                            sendFakeStreamState();
                        }
                    }}
                />
            );
        }
    },
    patches: [
        {
            find: "voiceServerPing(){",
            replacement: [
                {
                    match: /voiceStateUpdate\((\w+)\){(.{0,10})guildId:/,
                    replace: "voiceStateUpdate($1){$1=$self.modifyVoiceState($1);$2guildId:"
                }
            ]
        }
    ],
});