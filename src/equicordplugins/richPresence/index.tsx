/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Devs, EquicordDevs } from "@utils/constants";
import { Logger } from "@utils/Logger";
import definePlugin, { ReporterTestable } from "@utils/types";

import { migrateOldSettings } from "./migration";
import * as abs from "./services/audiobookshelf";
import * as gensokyoRadio from "./services/gensokyoRadio";
import * as jellyfin from "./services/jellyfin";
<<<<<<< HEAD
import * as navidrome from "./services/navidrome";
=======
import * as listenbrainz from "./services/listenbrainz";
>>>>>>> 89b0fd2a5 (Update index.tsx)
import * as statsfm from "./services/statsfm";
import * as tosu from "./services/tosu";
import { setOnServiceChange, settings, SettingsStore } from "./settings";
import { ServiceTab } from "./types";

type SettingsKey = keyof SettingsStore;

const logger = new Logger("RichPresence");

<<<<<<< HEAD
const services: Record<string, { start(): void; stop(): void; forceUpdate?(): void; }> = {
=======
const services: Record<string, { start(): void; stop(): void; }> = {
>>>>>>> 89b0fd2a5 (Update index.tsx)
    [ServiceTab.AudioBookShelf]: abs,
    [ServiceTab.Tosu]: tosu,
    [ServiceTab.StatsFm]: statsfm,
    [ServiceTab.Jellyfin]: jellyfin,
<<<<<<< HEAD
    [ServiceTab.GensokyoRadio]: gensokyoRadio,
    [ServiceTab.Navidrome]: navidrome,
=======
    [ServiceTab.ListenBrainz]: listenbrainz,
    [ServiceTab.GensokyoRadio]: gensokyoRadio,
>>>>>>> 89b0fd2a5 (Update index.tsx)
};

const enableKeys: Record<string, SettingsKey> = {
    [ServiceTab.AudioBookShelf]: "abs_enabled",
    [ServiceTab.Tosu]: "tosu_enabled",
    [ServiceTab.StatsFm]: "sfm_enabled",
    [ServiceTab.Jellyfin]: "jf_enabled",
<<<<<<< HEAD
    [ServiceTab.GensokyoRadio]: "gr_enabled",
    [ServiceTab.Navidrome]: "nd_enabled",
=======
    [ServiceTab.ListenBrainz]: "lb_enabled",
    [ServiceTab.GensokyoRadio]: "gr_enabled",
>>>>>>> 89b0fd2a5 (Update index.tsx)
};

const activeServices = new Set<string>();

function syncServices() {
    const globalEnabled = settings.store.enabled;

    for (const [id, service] of Object.entries(services)) {
        const shouldRun =
            globalEnabled && !!settings.store[enableKeys[id]];
        const isRunning = activeServices.has(id);

        if (shouldRun && !isRunning) {
            logger.info(`Starting ${id} service`);
            service.start();
            activeServices.add(id);
        } else if (!shouldRun && isRunning) {
            logger.info(`Stopping ${id} service`);
            service.stop();
            activeServices.delete(id);
<<<<<<< HEAD
        } else if (shouldRun && isRunning && service.forceUpdate) {
            service.forceUpdate();
=======
>>>>>>> 89b0fd2a5 (Update index.tsx)
        }
    }
}

function stopAllServices() {
    for (const id of activeServices) {
        logger.info(`Stopping ${id} service`);
        services[id].stop();
    }
    activeServices.clear();
}

export default definePlugin({
    name: "RichPresence",
<<<<<<< HEAD
    description: "Unified rich presence hub for AudioBookShelf, osu!, stats.fm, Jellyfin, Navidrome, and Gensokyo Radio.",
=======
    description: "Unified rich presence hub for AudioBookShelf, osu!, stats.fm, Jellyfin, ListenBrainz, and Gensokyo Radio.",
>>>>>>> 89b0fd2a5 (Update index.tsx)
    tags: ["Activity"],
    authors: [
        EquicordDevs.vmohammad,
        Devs.AutumnVN,
        EquicordDevs.Crxa,
        Devs.SerStars,
        EquicordDevs.ZcraftElite,
        EquicordDevs.qouesm,
        Devs.RyanCaoDev,
        EquicordDevs.Prince527,
        EquicordDevs.creations,
<<<<<<< HEAD
        EquicordDevs.Star123451,
=======
>>>>>>> 89b0fd2a5 (Update index.tsx)
    ],
    reporterTestable: ReporterTestable.None,

    settings,

    start() {
        migrateOldSettings();
        syncServices();
        setOnServiceChange(syncServices);
    },

    stop() {
        stopAllServices();
        setOnServiceChange(null);
    },
});
