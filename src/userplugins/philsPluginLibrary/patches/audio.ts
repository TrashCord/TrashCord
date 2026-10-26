/*
 * TrashCord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Logger } from "@utils/Logger";
import { lodash } from "@webpack/common";

import { MicrophoneProfile, MicrophoneStore } from "../../betterMicrophone.desktop/stores";
import { ProfilableStore, replaceObjectValuesIfExist, types } from "../../philsPluginLibrary";

export function getDefaultAudioTransportationOptions(connection: types.Connection) {
    return {
        audioEncoder: {
            ...connection.getCodecOptions("opus").audioEncoder,
        },
        encodingVoiceBitRate: 64000
    };
}

export function getReplaceableAudioTransportationOptions(connection: types.Connection, get: ProfilableStore<MicrophoneStore, MicrophoneProfile>["get"]) {
    const { currentProfile } = get();
    const {
        channels,
        channelsEnabled,
        freq,
        freqEnabled,
        pacsize,
        pacsizeEnabled,
        rate,
        rateEnabled,
        voiceBitrate,
        voiceBitrateEnabled
    } = currentProfile;

    return {
        ...(voiceBitrateEnabled && voiceBitrate
            ? {
                encodingVoiceBitRate: voiceBitrate * 1000
            }
            : {}
        ),
        audioEncoder: {
            ...connection.getCodecOptions("opus").audioEncoder,
            ...(rateEnabled && rate ? { rate } : {}),
            ...(pacsizeEnabled && pacsize ? { pacsize } : {}),
            ...(freqEnabled && freq ? { freq } : {}),
            ...(channelsEnabled && channels ? { channels } : {})
        }
    };
}

function getVoiceBitRate(target: number, get: ProfilableStore<MicrophoneStore, MicrophoneProfile>["get"]) {
    const { currentProfile } = get();
    const { voiceBitrate, voiceBitrateEnabled } = currentProfile;

    return voiceBitrateEnabled && voiceBitrate ? voiceBitrate * 1000 : target;
}

export function patchConnectionAudioTransportOptions(
    connection: types.Connection,
    get: ProfilableStore<MicrophoneStore, MicrophoneProfile>["get"],
    logger?: Logger
) {
    const oldSetTransportOptions = connection.conn.setTransportOptions;
    const oldSetVoiceBitRate = connection.setVoiceBitRate;

    connection.conn.setTransportOptions = function (this: any, options: Record<string, any>) {
        replaceObjectValuesIfExist(options, getReplaceableAudioTransportationOptions(connection, get));

        return Reflect.apply(oldSetTransportOptions, this, [options]);
    };

    connection.setVoiceBitRate = function (target: number) {
        const voiceBitRate = getVoiceBitRate(target, get);

        logger?.info("Overridden Voice Bitrate", voiceBitRate);

        return Reflect.apply(oldSetVoiceBitRate, this, [voiceBitRate]);
    };

    const forceUpdateTransportationOptions = () => {
        const transportOptions = lodash.merge({ ...getDefaultAudioTransportationOptions(connection) }, getReplaceableAudioTransportationOptions(connection, get));
        const voiceBitRate = getVoiceBitRate(transportOptions.encodingVoiceBitRate ?? 64000, get);

        logger?.info("Overridden Transport Options", transportOptions);

        Reflect.apply(oldSetTransportOptions, connection.conn, [transportOptions]);
        Reflect.apply(oldSetVoiceBitRate, connection, [voiceBitRate]);
    };

    return { oldSetTransportOptions, oldSetVoiceBitRate, forceUpdateTransportationOptions };
}
