/*
 * Profile Presets Native Helper - Save & Load Presets directly to/from disk.
 */

import { mkdir, readdir, readFile, rm, writeFile } from "fs/promises";
import { join } from "path";

const PRESETS_DIR = join(__dirname, "Presets");

function sanitizeFolderName(name: string): string {
    return (name || "preset")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "") || "preset";
}

export async function loadDiskPresets() {
    try {
        await mkdir(PRESETS_DIR, { recursive: true });
        const entries = await readdir(PRESETS_DIR, { withFileTypes: true });
        const presets: any[] = [];

        for (const entry of entries) {
            if (entry.isDirectory()) {
                const infoPath = join(PRESETS_DIR, entry.name, "preset_info.json");
                try {
                    const content = await readFile(infoPath, "utf-8");
                    const parsed = JSON.parse(content);
                    if (parsed && typeof parsed === "object" && parsed.name) {
                        presets.push(parsed);
                    }
                } catch {
                    // ignore invalid/incomplete folders
                }
            }
        }
        return { success: true, presets };
    } catch (err: any) {
        console.error("[ProfilePresets Native] Failed to load disk presets", err);
        return { success: false, presets: [] };
    }
}

export async function savePresetFiles(_: any, preset: any) {
    if (!preset || typeof preset !== "object" || !preset.name) {
        return { success: false, error: "Invalid preset object" };
    }

    try {
        await mkdir(PRESETS_DIR, { recursive: true });

        const safePresetName = sanitizeFolderName(preset.name);
        const targetFolderName = `${safePresetName}_${String(preset.id || "").slice(0, 8)}`;
        const targetFolderPath = join(PRESETS_DIR, targetFolderName);

        // Delete any existing folders for the same preset name (case-insensitive) or same safePresetName
        const entries = await readdir(PRESETS_DIR, { withFileTypes: true });
        for (const entry of entries) {
            if (entry.isDirectory()) {
                const folderName = entry.name.toLowerCase();
                const isSameSafeName = folderName.startsWith(`${safePresetName}_`) || folderName === safePresetName;

                let isSamePresetName = false;
                try {
                    const infoPath = join(PRESETS_DIR, entry.name, "preset_info.json");
                    const raw = await readFile(infoPath, "utf-8");
                    const info = JSON.parse(raw);
                    if (info?.name?.toLowerCase() === preset.name.toLowerCase() || info?.id === preset.id) {
                        isSamePresetName = true;
                    }
                } catch {}

                if ((isSameSafeName || isSamePresetName) && entry.name !== targetFolderName) {
                    const oldPath = join(PRESETS_DIR, entry.name);
                    await rm(oldPath, { recursive: true, force: true });
                }
            }
        }

        await mkdir(targetFolderPath, { recursive: true });

        // Save preset info JSON
        const infoPath = join(targetFolderPath, "preset_info.json");
        await writeFile(infoPath, JSON.stringify(preset, null, 2), "utf-8");

        // Save avatar image/gif if data URI exists
        if (preset.avatar && typeof preset.avatar === "string" && preset.avatar.startsWith("data:image/")) {
            const ext = preset.avatar.includes("image/gif") ? "gif" : "png";
            const base64Data = preset.avatar.split(",")[1];
            if (base64Data) {
                const avatarPath = join(targetFolderPath, `avatar.${ext}`);
                await writeFile(avatarPath, Buffer.from(base64Data, "base64"));
            }
        }

        // Save banner image/gif if data URI exists
        if (preset.banner && typeof preset.banner === "string" && preset.banner.startsWith("data:image/")) {
            const ext = preset.banner.includes("image/gif") ? "gif" : "png";
            const base64Data = preset.banner.split(",")[1];
            if (base64Data) {
                const bannerPath = join(targetFolderPath, `banner.${ext}`);
                await writeFile(bannerPath, Buffer.from(base64Data, "base64"));
            }
        }

        return { success: true, folderPath: targetFolderPath };
    } catch (err: any) {
        console.error("[ProfilePresets Native] Failed to save preset to disk", err);
        return { success: false, error: String(err?.message ?? err) };
    }
}

export async function deletePresetFile(_: any, preset: any) {
    if (!preset || typeof preset !== "object") return { success: false, error: "Invalid preset" };
    try {
        await mkdir(PRESETS_DIR, { recursive: true });
        const entries = await readdir(PRESETS_DIR, { withFileTypes: true });
        const presetIdShort = String(preset.id || "").slice(0, 8);
        const presetIdFull = String(preset.id || "");
        const safeName = sanitizeFolderName(preset.name || "");

        for (const entry of entries) {
            if (entry.isDirectory()) {
                const folderName = entry.name.toLowerCase();
                let match = false;

                if ((presetIdShort && folderName.includes(presetIdShort)) || (presetIdFull && folderName.includes(presetIdFull))) {
                    match = true;
                } else if (safeName && (folderName.startsWith(`${safeName}_`) || folderName === safeName)) {
                    match = true;
                } else {
                    try {
                        const infoPath = join(PRESETS_DIR, entry.name, "preset_info.json");
                        const raw = await readFile(infoPath, "utf-8");
                        const info = JSON.parse(raw);
                        if (info?.name?.toLowerCase() === preset.name?.toLowerCase()) {
                            match = true;
                        }
                    } catch {}
                }

                if (match) {
                    const fullPath = join(PRESETS_DIR, entry.name);
                    await rm(fullPath, { recursive: true, force: true });
                }
            }
        }
        return { success: true };
    } catch (err: any) {
        console.error("[ProfilePresets Native] Failed to delete preset folder", err);
        return { success: false, error: String(err?.message ?? err) };
    }
}

export async function syncAllToDisk(_: any, activePresets: any[]) {
    if (!Array.isArray(activePresets)) return { success: false };
    try {
        await mkdir(PRESETS_DIR, { recursive: true });

        const activeMap = new Map<string, any>();
        for (const p of activePresets) {
            if (p && p.name) {
                // Ensure only ONE preset per name
                activeMap.set(p.name.toLowerCase(), p);
            }
        }

        const activeShortIds = new Set([...activeMap.values()].map(p => String(p.id || "").slice(0, 8)).filter(Boolean));
        const activeNamesLower = new Set([...activeMap.keys()]);

        const entries = await readdir(PRESETS_DIR, { withFileTypes: true });
        for (const entry of entries) {
            if (entry.isDirectory()) {
                let keep = false;
                try {
                    const infoPath = join(PRESETS_DIR, entry.name, "preset_info.json");
                    const raw = await readFile(infoPath, "utf-8");
                    const info = JSON.parse(raw);
                    if (info && info.name && activeNamesLower.has(info.name.toLowerCase())) {
                        keep = true;
                    }
                } catch {}

                if (!keep) {
                    const folderName = entry.name;
                    const matchesActiveId = [...activeShortIds].some(shortId => shortId && folderName.includes(shortId));
                    if (!matchesActiveId) {
                        const fullPath = join(PRESETS_DIR, folderName);
                        await rm(fullPath, { recursive: true, force: true });
                    }
                }
            }
        }

        // Save/update files for all active presets
        for (const preset of activeMap.values()) {
            await savePresetFiles(null, preset);
        }

        return { success: true };
    } catch (err) {
        console.error("[ProfilePresets Native] Failed to sync disk folders", err);
        return { success: false };
    }
}
