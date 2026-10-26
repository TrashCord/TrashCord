/*
 * TrashCord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { execFile } from "child_process";
import { existsSync } from "fs";
import { promisify } from "util";

const exec = promisify(execFile);

const BLACKHOLE_DRIVER_PATHS = [
    "/Library/Audio/Plug-Ins/HAL/BlackHole2ch.driver",
    "/Library/Audio/Plug-Ins/HAL/BlackHole16ch.driver"
];

export async function checkBlackHole(): Promise<{ installed: boolean; }> {
    const installed = BLACKHOLE_DRIVER_PATHS.some(p => existsSync(p));
    return { installed };
}

export function getInstallCommand(): string {
    return "brew install blackhole-2ch";
}

/** Opens Audio MIDI Setup, where the user can build a Multi-Output Device combining BlackHole + their speakers. */
export async function openAudioMidiSetup(): Promise<void> {
    try {
        await exec("open", ["-a", "Audio MIDI Setup"]);
    } catch (e: any) {
        throw new Error(`Could not open Audio MIDI Setup: ${e?.message ?? e}`);
    }
}

/** Opens System Settings > Sound, as a fallback entry point. */
export async function openSoundSettings(): Promise<void> {
    try {
        await exec("open", ["x-apple.systempreferences:com.apple.preference.sound"]);
    } catch (e: any) {
        throw new Error(`Could not open Sound settings: ${e?.message ?? e}`);
    }
}

export async function isSupported(): Promise<boolean> {
    return process.platform === "darwin";
}
