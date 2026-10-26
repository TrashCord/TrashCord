/*
 * TrashCord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { UserStore } from "@webpack/common";

import { PluginInfo } from "../../betterScreenshare.desktop/constants";
import { logger } from "../../betterScreenshare.desktop/logger";
import { screenshareStore } from "../../betterScreenshare.desktop/stores";
import { Emitter, MediaEngineStore, Patcher, types } from "../../philsPluginLibrary";
import { patchConnectionVideoSetDesktopSourceWithOptions, patchConnectionVideoTransportOptions } from "../../philsPluginLibrary/patches/video";

export class ScreensharePatcher extends Patcher {
    private mediaEngineStore: types.MediaEngineStore;
    private mediaEngine: types.MediaEngine;
    public connection?: types.Connection;
    public oldGetQuality: types.Connection["videoQualityManager"]["getQuality"];
    public oldOnDesktopEncodingOptionsSet: types.Connection["onDesktopEncodingOptionsSet"];
    public oldSetDesktopEncodingOptions: types.Connection["setDesktopEncodingOptions"];
    public oldSetDesktopSourceWithOptions: (...args: any[]) => void;
    public oldSetTransportOptions: (...args: any[]) => void;
    public forceUpdateDesktopEncodingOptions: () => void;
    public forceUpdateTransportationOptions: () => void;
    public forceUpdateDesktopSourceOptions: () => void;

    constructor() {
        super();
        this.mediaEngineStore = MediaEngineStore;
        this.mediaEngine = this.mediaEngineStore.getMediaEngine();
        this.oldGetQuality = () => void 0;
        this.oldOnDesktopEncodingOptionsSet = () => void 0;
        this.oldSetDesktopEncodingOptions = () => void 0;
        this.forceUpdateDesktopEncodingOptions = () => void 0;
        this.forceUpdateTransportationOptions = () => void 0;
        this.forceUpdateDesktopSourceOptions = () => void 0;
        this.oldSetDesktopSourceWithOptions = () => void 0;
        this.oldSetTransportOptions = () => void 0;
    }

    public hasActiveDesktopSource(): boolean {
        const { connection } = this;

        return Boolean(connection && !connection.destroyed && connection.connectionState === "CONNECTED" && connection.hasDesktopSource());
    }

    public patch(): this {
        this.unpatch();

        const { get } = screenshareStore;

        const connectionEventFunction =
            (connection: types.Connection) => {
                if (!(connection.context === "stream" && connection.streamUserId === UserStore.getCurrentUser().id)) return;
                if (this.connection === connection) return;

                this.connection = connection;

                const {
                    oldGetQuality,
                    oldOnDesktopEncodingOptionsSet,
                    oldSetDesktopEncodingOptions,
                    oldSetDesktopSourceWithOptions,
                    oldSetTransportOptions,
                    forceUpdateDesktopEncodingOptions,
                    forceUpdateDesktopSourceOptions,
                    forceUpdateTransportationOptions
                } = {
                    ...patchConnectionVideoTransportOptions(connection, get, logger),
                    ...patchConnectionVideoSetDesktopSourceWithOptions(connection, get, logger)
                };

                this.oldGetQuality = oldGetQuality;
                this.oldOnDesktopEncodingOptionsSet = oldOnDesktopEncodingOptionsSet;
                this.oldSetDesktopEncodingOptions = oldSetDesktopEncodingOptions;
                this.oldSetDesktopSourceWithOptions = oldSetDesktopSourceWithOptions;
                this.oldSetTransportOptions = oldSetTransportOptions;
                this.forceUpdateDesktopEncodingOptions = forceUpdateDesktopEncodingOptions;
                this.forceUpdateDesktopSourceOptions = forceUpdateDesktopSourceOptions;
                this.forceUpdateTransportationOptions = forceUpdateTransportationOptions;

                const restoreConnection = () => {
                    connection.conn.setTransportOptions = oldSetTransportOptions;
                    connection.conn.setDesktopSourceWithOptions = oldSetDesktopSourceWithOptions;
                    connection.setDesktopEncodingOptions = oldSetDesktopEncodingOptions;
                    connection.onDesktopEncodingOptionsSet = oldOnDesktopEncodingOptionsSet;
                    connection.videoQualityManager.getQuality = oldGetQuality;
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
                    this.forceUpdateDesktopEncodingOptions();
                    if (this.hasActiveDesktopSource()) this.forceUpdateDesktopSourceOptions();
                }, PluginInfo.PLUGIN_NAME);

                removeDestroyListener = Emitter.addListener(connection.emitter, "on", "destroy", () => {
                    cleanupConnection();
                    if (this.connection === connection)
                        this.connection = undefined;

                    this.forceUpdateTransportationOptions = () => void 0;
                    this.forceUpdateDesktopEncodingOptions = () => void 0;
                    this.forceUpdateDesktopSourceOptions = () => void 0;
                    this.oldGetQuality = () => void 0;
                    this.oldOnDesktopEncodingOptionsSet = () => void 0;
                    this.oldSetTransportOptions = () => void 0;
                    this.oldSetDesktopEncodingOptions = () => void 0;
                    this.oldSetDesktopSourceWithOptions = () => void 0;
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
        this.forceUpdateDesktopEncodingOptions = () => void 0;
        this.forceUpdateDesktopSourceOptions = () => void 0;
        this.oldGetQuality = () => void 0;
        this.oldOnDesktopEncodingOptionsSet = () => void 0;
        this.oldSetTransportOptions = () => void 0;
        this.oldSetDesktopEncodingOptions = () => void 0;
        this.oldSetDesktopSourceWithOptions = () => void 0;

        return this;
    }
}