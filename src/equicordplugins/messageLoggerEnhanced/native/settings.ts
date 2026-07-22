/*
 * Vencord, a Discord client mod
 * Copyright (c) 2023 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import fs from "fs/promises";
import path from "path";

<<<<<<< HEAD
import { getDefaultAttachmentFileExtensions, getDefaultNativeDataDir, getDefaultNativeImageDir } from ".";
=======
import { getDefaultNativeDataDir, getDefaultNativeImageDir } from ".";
>>>>>>> 89b0fd2a5 (Update index.tsx)
import { ensureDirectoryExists } from "./utils";

interface MLSettings {
    logsDir: string;
    imageCacheDir: string;
<<<<<<< HEAD
    attachmentFileExtensions?: string;
}

=======
}
>>>>>>> 89b0fd2a5 (Update index.tsx)
export async function getSettings(): Promise<MLSettings> {
    try {
        const settings = await fs.readFile(await getSettingsFilePath(), "utf8");
        return JSON.parse(settings);
    } catch (err) {
<<<<<<< HEAD
        const settings = {
            logsDir: await getDefaultNativeDataDir(),
            imageCacheDir: await getDefaultNativeImageDir(),
            attachmentFileExtensions: await getDefaultAttachmentFileExtensions()
=======
        // probably doesnt exist
        // time to create it
        const settings = {
            logsDir: await getDefaultNativeDataDir(),
            imageCacheDir: await getDefaultNativeImageDir(),
>>>>>>> 89b0fd2a5 (Update index.tsx)
        };
        try {
            await saveSettings(settings);
        } catch (err) { }

        return settings;
    }
}

<<<<<<< HEAD
=======
// dont expose this to renderer future me
>>>>>>> 89b0fd2a5 (Update index.tsx)
export async function saveSettings(settings: MLSettings) {
    if (!settings) return;
    await fs.writeFile(await getSettingsFilePath(), JSON.stringify(settings, null, 4), "utf8");
}

async function getSettingsFilePath() {
<<<<<<< HEAD
    const MlDataDir = await getDefaultNativeDataDir();
    await ensureDirectoryExists(MlDataDir);
    return path.join(MlDataDir, "mlSettings.json");
=======
    // mlSettings.json will always in that folder
    const MlDataDir = await getDefaultNativeDataDir();
    await ensureDirectoryExists(MlDataDir);
    const mlSettingsDir = path.join(MlDataDir, "mlSettings.json");

    return mlSettingsDir;
>>>>>>> 89b0fd2a5 (Update index.tsx)
}
