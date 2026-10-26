/*
 * TrashCord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { PluginInfo } from "../../betterMicrophone.desktop/constants";
import { logger } from "../../betterMicrophone.desktop/logger";
import { microphoneStore } from "../../betterMicrophone.desktop/stores";
import { Emitter, MediaEngineStore, Patcher, types } from "../../philsPluginLibrary";
import { patchConnectionAudioTransportOptions } from "../../philsPluginLibrary/patches/audio";

export class MicrophonePatcher extends Patcher {
    private mediaEngineStore: types.MediaEngineStore;
    private mediaEngine: types.MediaEngine;
    public connection?: types.Connection;
    public oldSetTransportOptions: (...args: any[]) => void;
    public oldSetVoiceBitRate: types.Connection["setVoiceBitRate"];
    public forceUpdateTransportationOptions: () => void;

    constructor() {
        super();
        this.mediaEngineStore = MediaEngineStore;
        this.mediaEngine = this.mediaEngineStore.getMediaEngine();
        this.oldSetTransportOptions = () => void 0;
        this.oldSetVoiceBitRate = () => void 0;
        this.forceUpdateTransportationOptions = () => void 0;
    }

    public patch(): this {
        this.unpatch();

        const { get } = microphoneStore;

        const connectionEventFunction =
            (connection: types.Connection) => {
                if (connection.context !== "default") return;
                if (this.connection === connection) return;

                this.connection = connection;

                const { oldSetTransportOptions, oldSetVoiceBitRate, forceUpdateTransportationOptions } = patchConnectionAudioTransportOptions(connection, get, logger);

                this.oldSetTransportOptions = oldSetTransportOptions;
                this.oldSetVoiceBitRate = oldSetVoiceBitRate;
                this.forceUpdateTransportationOptions = forceUpdateTransportationOptions;

                const restoreConnection = () => {
                    connection.conn.setTransportOptions = oldSetTransportOptions;
                    connection.setVoiceBitRate = oldSetVoiceBitRate;
                };
                let didCleanupConnection = false;
                let removeConnectedListener: () => void = () => void 0;
                let removeDestroyListener: () => void = () => void 0;
                const cleanupConnection = () => {
                    if (didCleanupConnection) return;
                    didCleanupConnection = true;
                    restoreConnection();
                    removeConnectedListener();
                    removeDestroyListener();
                    this.unpatchFunctions = this.unpatchFunctions.filter(fn => fn !== cleanupConnection);
                };
                this.unpatchFunctions.push(cleanupConnection);

                removeConnectedListener = Emitter.addListener(connection.emitter, "on", "connected", () => {
                    this.forceUpdateTransportationOptions();
                }, PluginInfo.PLUGIN_NAME);

                removeDestroyListener = Emitter.addListener(connection.emitter, "on", "destroy", () => {
                    cleanupConnection();
                    if (this.connection === connection)
                        this.connection = undefined;

                    this.forceUpdateTransportationOptions = () => void 0;
                    this.oldSetTransportOptions = () => void 0;
                    this.oldSetVoiceBitRate = () => void 0;
                }, PluginInfo.PLUGIN_NAME);
            };

        this.unpatchFunctions.push(Emitter.addListener(
            this.mediaEngine.emitter,
            "on",
            "connection",
            connectionEventFunction,
            PluginInfo.PLUGIN_NAME
        ));

        return this;
    }

    public unpatch(): this {
        this._unpatch();
        this.connection = undefined;
        this.forceUpdateTransportationOptions = () => void 0;
        this.oldSetTransportOptions = () => void 0;
        this.oldSetVoiceBitRate = () => void 0;

        return this;
    }
}
