/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

<<<<<<< HEAD
import { ensureSafePath } from "@main/ipcMain";
import { THEMES_DIR } from "@main/utils/constants";
import { IpcMainInvokeEvent } from "electron";
import { existsSync, writeFileSync } from "fs";

import type { Theme } from "./types";

function getThemePath(theme: Theme): string | null {
    if (!theme?.name) return null;
    return ensureSafePath(THEMES_DIR, `${theme.name}.theme.css`);
}

export async function themeExists(_: IpcMainInvokeEvent, theme: Theme) {
    const path = getThemePath(theme);
    return path ? existsSync(path) : false;
}

export async function downloadTheme(_: IpcMainInvokeEvent, theme: Theme) {
    if (!theme?.content || !theme?.name || !theme?.id) return;

    const path = getThemePath(theme);
    if (!path) throw new Error("Invalid theme name");

    const download = await fetch(`https://themes.equicord.org/api/download/${encodeURIComponent(theme.id)}`);
=======
import { IpcMainInvokeEvent } from "electron";
import { existsSync, type PathLike, writeFileSync } from "fs";
import { join } from "path";

import type { Theme } from "./types";

export async function themeExists(_: IpcMainInvokeEvent, dir: PathLike, theme: Theme) {
    return existsSync(join(dir.toString(), `${theme.name}.theme.css`));
}

export function getThemesDir(_: IpcMainInvokeEvent, dir: PathLike, theme: Theme) {
    return join(dir.toString(), `${theme.name}.theme.css`);
}

export async function downloadTheme(_: IpcMainInvokeEvent, dir: PathLike, theme: Theme) {
    if (!theme.content || !theme.name) return;
    const path = join(dir.toString(), `${theme.name}.theme.css`);
    const download = await fetch(`https://themes.equicord.org/api/download/${theme.id}`);
>>>>>>> 89b0fd2a5 (Update index.tsx)
    const content = await download.text();
    writeFileSync(path, content);
}
