/*
 * TrashCord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { createReadStream, createWriteStream, WriteStream } from "node:fs";
import { copyFile, type FileHandle, mkdir, open, rename, unlink, writeFile } from "node:fs/promises";
import * as path from "node:path";
import { pipeline } from "node:stream/promises";

import { app, BrowserWindow, desktopCapturer, dialog, globalShortcut, IpcMainInvokeEvent, shell } from "electron";

import { detectContainer, FIX_HEAD_BYTES, type HeadPatch, patchMp4Head, patchWebmHead } from "./mediaFixer";

interface SaveResult {
    status: "saved" | "canceled" | "error";
    path?: string;
}

const SAVE_FILTERS = [
    { name: "MP4 Video/Audio", extensions: ["mp4", "m4a"] },
    { name: "WebM / MKV", extensions: ["webm", "mkv"] },
    { name: "OGG Audio", extensions: ["ogg"] },
    { name: "All Files", extensions: ["*"] }
];

const hotkeys = new Map<string, string>();

let activeStream: WriteStream | null = null;
let activeTempPath: string | null = null;

function getDefaultSaveFolder(): string {
    for (const name of ["videos", "downloads", "home"] as const) {
        try {
            const p = app.getPath(name).trim();
            if (p) return path.join(p, "Discord");
        } catch { }
    }
    return path.join(process.cwd(), "Discord");
}

function resolveFolder(folderPath: string | null | undefined, sub: string): string {
    const trimmed = folderPath?.trim();
    return trimmed ? path.resolve(trimmed) : path.join(getDefaultSaveFolder(), sub);
}

function releaseKey(id: string) {
    const key = hotkeys.get(id);
    if (!key) return;
    try {
        globalShortcut.unregister(key);
    } catch { }
    hotkeys.delete(id);
}

function closeStream(stream: WriteStream | null): Promise<void> {
    return new Promise(resolve => {
        if (!stream || stream.closed) return resolve();
        stream.once("close", () => resolve());
        stream.once("error", () => resolve());
        if (!stream.destroyed) stream.end();
    });
}

async function moveFile(sourcePath: string, destPath: string) {
    try {
        await rename(sourcePath, destPath);
    } catch {
        await copyFile(sourcePath, destPath);
        await unlink(sourcePath).catch(() => { });
    }
}

async function patchInPlace(filePath: string, durationMs: number): Promise<HeadPatch | null> {
    let handle: FileHandle | null = null;
    try {
        handle = await open(filePath, "r+");
        const { size } = await handle.stat();
        const length = Math.min(size, FIX_HEAD_BYTES);
        const head = Buffer.alloc(length);
        await handle.read(head, 0, length, 0);

        const kind = detectContainer(head);

        if (kind === "mp4") {
            if (patchMp4Head(head, durationMs)) await handle.write(head, 0, length, 0);
            return null;
        }

        if (kind === "webm") {
            const patch = patchWebmHead(head, durationMs);
            if (!patch) return null;
            if (patch.bytes.length === patch.end - patch.start) {
                await handle.write(patch.bytes, 0, patch.bytes.length, patch.start);
                return null;
            }
            return patch;
        }

        return null;
    } catch {
        return null;
    } finally {
        if (handle) await handle.close().catch(() => { });
    }
}

async function* streamWithHead(head: Uint8Array, filePath: string, from: number) {
    yield head;
    for await (const chunk of createReadStream(filePath, { start: from, highWaterMark: 524288 })) {
        yield chunk;
    }
}

async function placeFile(sourcePath: string, destPath: string, durationMs: number) {
    const rewrite = durationMs > 0 ? await patchInPlace(sourcePath, durationMs) : null;

    if (rewrite) {
        try {
            await pipeline(
                streamWithHead(rewrite.bytes, sourcePath, rewrite.end),
                createWriteStream(destPath)
            );
            await unlink(sourcePath).catch(() => { });
            return;
        } catch {
            await unlink(destPath).catch(() => { });
        }
    }

    await moveFile(sourcePath, destPath);
}

export async function getDesktopSources(_event: IpcMainInvokeEvent): Promise<Array<{ id: string; name: string; }>> {
    try {
        const sources = await desktopCapturer.getSources({
            types: ["screen"],
            thumbnailSize: { width: 0, height: 0 }
        });
        return sources.map(s => ({ id: s.id, name: s.name }));
    } catch {
        return [];
    }
}

export async function getWindowSourceId(event: IpcMainInvokeEvent): Promise<string | null> {
    try {
        return BrowserWindow.fromWebContents(event.sender)?.getMediaSourceId() ?? null;
    } catch {
        return null;
    }
}

export async function pickDirectory(_event: IpcMainInvokeEvent): Promise<string | null> {
    const res = await dialog.showOpenDialog({
        title: "Choose Folder",
        properties: ["openDirectory", "createDirectory"]
    });

    if (res.canceled || !res.filePaths.length) return null;
    return res.filePaths[0];
}

export async function initStreamRecording(_event: IpcMainInvokeEvent, filename: string): Promise<boolean> {
    try {
        const previous = activeStream;
        activeStream = null;
        activeTempPath = null;
        await closeStream(previous);

        const tempDir = path.join(app.getPath("temp"), "callcapture-recordings");
        await mkdir(tempDir, { recursive: true });

        const tempPath = path.join(tempDir, path.basename(filename));
        const stream = createWriteStream(tempPath, { flags: "w" });
        stream.on("error", () => { });

        activeStream = stream;
        activeTempPath = tempPath;
        return true;
    } catch {
        activeStream = null;
        activeTempPath = null;
        return false;
    }
}

export async function appendRecordingChunk(_event: IpcMainInvokeEvent, chunk: Uint8Array): Promise<boolean> {
    const stream = activeStream;
    if (!stream || stream.destroyed) return false;

    try {
        const ok = stream.write(Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength));
        if (!ok) {
            await new Promise<void>(resolve => {
                const done = () => {
                    stream.off("drain", done);
                    stream.off("close", done);
                    stream.off("error", done);
                    resolve();
                };
                stream.once("drain", done);
                stream.once("close", done);
                stream.once("error", done);
            });
        }
        return true;
    } catch {
        return false;
    }
}

export async function abortStreamRecording(_event: IpcMainInvokeEvent): Promise<boolean> {
    const stream = activeStream;
    const tempPath = activeTempPath;
    activeStream = null;
    activeTempPath = null;

    await closeStream(stream);
    if (tempPath) await unlink(tempPath).catch(() => { });
    return true;
}

export async function finalizeStreamRecording(
    _event: IpcMainInvokeEvent,
    folderPath: string | null,
    filename: string,
    durationMs = 0,
    prompt = false,
    sub = "Recordings"
): Promise<SaveResult> {
    const stream = activeStream;
    const sourcePath = activeTempPath;
    activeStream = null;
    activeTempPath = null;

    if (!sourcePath) return { status: "error" };

    try {
        await closeStream(stream);

        const safeName = path.basename(filename);
        const folder = resolveFolder(folderPath, sub);
        let destPath: string;

        if (prompt) {
            const res = await dialog.showSaveDialog({
                title: "Save Call Recording",
                defaultPath: path.join(folder, safeName),
                filters: SAVE_FILTERS
            });

            if (res.canceled || !res.filePath) {
                await unlink(sourcePath).catch(() => { });
                return { status: "canceled" };
            }
            destPath = res.filePath;
        } else {
            await mkdir(folder, { recursive: true });
            destPath = path.join(folder, safeName);
        }

        await placeFile(sourcePath, destPath, durationMs);
        return { status: "saved", path: destPath };
    } catch {
        return { status: "error" };
    }
}

export async function saveRecording(_event: IpcMainInvokeEvent, buffer: Uint8Array, folderPath: string, filename: string, sub = "Recordings"): Promise<SaveResult> {
    try {
        const folder = resolveFolder(folderPath, sub);
        await mkdir(folder, { recursive: true });
        const destPath = path.join(folder, path.basename(filename));
        await writeFile(destPath, Buffer.from(buffer.buffer, buffer.byteOffset, buffer.byteLength));
        return { status: "saved", path: destPath };
    } catch {
        return { status: "error" };
    }
}

export async function promptSaveRecording(_event: IpcMainInvokeEvent, buffer: Uint8Array, folderPath: string, filename: string, sub = "Recordings"): Promise<SaveResult> {
    try {
        const res = await dialog.showSaveDialog({
            title: "Save Call Recording",
            defaultPath: path.join(resolveFolder(folderPath, sub), path.basename(filename)),
            filters: SAVE_FILTERS
        });

        if (res.canceled || !res.filePath) return { status: "canceled" };

        await writeFile(res.filePath, Buffer.from(buffer.buffer, buffer.byteOffset, buffer.byteLength));
        return { status: "saved", path: res.filePath };
    } catch {
        return { status: "error" };
    }
}

export async function writeClip(_event: IpcMainInvokeEvent, folderPath: string | null, filename: string, bytes: Uint8Array): Promise<string | null> {
    try {
        const folder = resolveFolder(folderPath, "Clips");
        await mkdir(folder, { recursive: true });
        const destPath = path.join(folder, path.basename(filename));
        await writeFile(destPath, Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength));
        return destPath;
    } catch {
        return null;
    }
}

export function showInFolder(_event: IpcMainInvokeEvent, filePath: string): void {
    if (typeof filePath === "string" && path.isAbsolute(filePath)) shell.showItemInFolder(path.normalize(filePath));
}

export function openSoundSettings(_event: IpcMainInvokeEvent): void {
    shell.openExternal("ms-settings:sound").catch(() => { });
}

export function registerKeybind(event: IpcMainInvokeEvent, id: string, accelerator: string): boolean {
    if (id !== "clip" && id !== "record") return false;

    releaseKey(id);

    const key = typeof accelerator === "string" ? accelerator.trim() : "";
    if (!key) return false;

    const contents = event.sender;

    try {
        if (globalShortcut.isRegistered(key)) return false;

        const ok = globalShortcut.register(key, () => {
            if (contents.isDestroyed()) return;
            contents.executeJavaScript(`Vencord?.Plugins?.plugins?.CallCapture?.hotkey?.(${JSON.stringify(id)})`).catch(() => { });
        });
        if (ok) hotkeys.set(id, key);
        return ok;
    } catch {
        return false;
    }
}

export function unregisterKeybind(_event: IpcMainInvokeEvent, id: string): boolean {
    releaseKey(id);
    return true;
}

export function unregisterAllKeybinds(_event: IpcMainInvokeEvent): boolean {
    for (const id of [...hotkeys.keys()]) releaseKey(id);
    return true;
}