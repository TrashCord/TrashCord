/*
 * TrashCord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { getUserSettingLazy } from "@api/UserSettings";
import definePlugin, { PluginNative } from "@utils/types";
import { UserSettingsProtoStore } from "@webpack/common";

import type { Status } from "./merge";

const Native = VencordNative.pluginHelpers.TaskbarStatus as PluginNative<typeof import("./native")>;
const StatusSettings = getUserSettingLazy<Status>("status", "status")!;

let lastStatus: Status | null = null;

function onSettingsChange() {
    const status = StatusSettings.getSetting();
    if (!status || status === lastStatus) return;
    lastStatus = status;
    Native.update(status);
}

export default definePlugin({
    name: "TaskbarStatus",
    description: "Change your status from the Windows taskbar: buttons in the hover preview and tasks in the right-click jump list",
    authors: [{ name: "yusufaf", id: 0n }],
    tags: ["Utility"],
    enabledByDefault: false,
    dependencies: ["UserSettingsAPI"],
    async setStatus(status: Status) {
        await StatusSettings.updateSetting(status);
        lastStatus = status;
        Native.update(status);
    },

    async start() {
        // Undefined until Discord's settings have synced; the listener picks up the real value then.
        const initial = StatusSettings.getSetting();
        lastStatus = initial ?? null;
        UserSettingsProtoStore.addChangeListener(onSettingsChange);
        const pending = await Native.start(initial ?? "online");
        if (pending && pending !== initial) await this.setStatus(pending);
    },

    stop() {
        UserSettingsProtoStore.removeChangeListener(onSettingsChange);
        Native.stop();
    }
});
