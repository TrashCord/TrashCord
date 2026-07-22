/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

const STREAMABLE_MAX_WAIT_MS = 10 * 60 * 1000;
const STREAMABLE_PROCESSING_POLL_SCHEDULE_MS = [1000, 1500, 2000, 3000, 5000];
const STREAMABLE_PUBLIC_READY_POLL_SCHEDULE_MS = [500, 1000, 1500, 2000, 3000];

function getSafeStorage() {
    try {
        const electron = require("electron");
        return electron?.safeStorage;
    } catch {
        return null;
    }
}

function isSecureStorageAvailable(): boolean {
    const safeStorage = getSafeStorage();
    return Boolean(safeStorage && safeStorage.isEncryptionAvailable && safeStorage.isEncryptionAvailable());
}

function wait(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function getShortcode(uploadResponse: any): string | null {
    const shortcode = uploadResponse?.shortcode || uploadResponse?.data?.shortcode;
    return typeof shortcode === "string" && shortcode.length > 0 ? shortcode : null;
}

function hasPublicEmbedMetadata(html: string): boolean {
    return html.includes('property="og:video"')
        && html.includes('property="og:image"')
        && html.includes('name="twitter:player"');
}

function getPollDelay(schedule: number[], attempt: number): number {
    return schedule[Math.min(attempt, schedule.length - 1)];
}

async function waitForStreamableProcessing(shortcode: string, authHeader: string): Promise<void> {
    const startedAt = Date.now();
    let attempt = 0;

    while (Date.now() - startedAt < STREAMABLE_MAX_WAIT_MS) {
        const statusResponse = await fetch(`https://api.streamable.com/videos/${shortcode}`, {
            method: "GET",
            headers: {
                Authorization: authHeader
            }
        });

        if (!statusResponse.ok) {
            throw new Error(`STREAMABLE_STATUS_HTTP_${statusResponse.status}`);
        }

        const statusJson = await statusResponse.json();
        const status = Number(statusJson?.status);

        if (status === 2) {
            return;
        }

        if (status >= 3 || status < 0) {
            throw new Error(`STREAMABLE_PROCESSING_FAILED_${status}`);
        }

        await wait(getPollDelay(STREAMABLE_PROCESSING_POLL_SCHEDULE_MS, attempt));
        attempt++;
    }

    throw new Error("STREAMABLE_PROCESSING_TIMEOUT");
}

async function waitForPublicEmbedReadiness(shortcode: string): Promise<void> {
    const startedAt = Date.now();
    let attempt = 0;

    while (Date.now() - startedAt < STREAMABLE_MAX_WAIT_MS) {
        const pageResponse = await fetch(`https://streamable.com/${shortcode}`, {
            method: "GET",
            headers: {
                "User-Agent": "Mozilla/5.0 (compatible; Discordbot/2.0; +https://discord.com)"
            }
        });

        if (pageResponse.ok) {
            const pageHtml = await pageResponse.text();
            if (hasPublicEmbedMetadata(pageHtml)) {
                return;
            }
        }

        await wait(getPollDelay(STREAMABLE_PUBLIC_READY_POLL_SCHEDULE_MS, attempt));
        attempt++;
    }

    throw new Error("STREAMABLE_PUBLIC_EMBED_TIMEOUT");
}

export async function uploadFileToStreamableNative(_, fileBuffer: ArrayBuffer, fileName: string, fileType: string, email: string, password: string): Promise<any> {
    try {
        const formData = new FormData();
        const file = new Blob([fileBuffer], { type: fileType || "application/octet-stream" });
        formData.append("file", new File([file], fileName));

        const basicAuth = Buffer.from(`${email}:${password}`).toString("base64");
        const authHeader = `Basic ${basicAuth}`;
        const response = await fetch("https://api.streamable.com/upload", {
            method: "POST",
            headers: {
                Authorization: authHeader
            },
            body: formData
        });

        if (!response.ok) {
            throw new Error(`STREAMABLE_UPLOAD_HTTP_${response.status}`);
        }

        const uploadJson = await response.json();
        const shortcode = getShortcode(uploadJson);

        if (!shortcode) {
            throw new Error("STREAMABLE_SHORTCODE_MISSING");
        }

        await waitForStreamableProcessing(shortcode, authHeader);
        await waitForPublicEmbedReadiness(shortcode);
        return { ...uploadJson, shortcode };
    } catch (error) {
        console.error("Error during Streamable upload:", error);
        throw error;
    }
}

export async function encryptSecretNative(_, plaintext: string): Promise<string> {
    if (!plaintext) return "";
    if (!isSecureStorageAvailable()) {
        throw new Error("SECURE_STORAGE_UNAVAILABLE");
    }

    const safeStorage = getSafeStorage();
    const encrypted = safeStorage.encryptString(plaintext);
    return Buffer.from(encrypted).toString("base64");
}

export async function decryptSecretNative(_, encryptedBase64: string): Promise<string> {
    if (!encryptedBase64) return "";
    if (!isSecureStorageAvailable()) {
        throw new Error("SECURE_STORAGE_UNAVAILABLE");
    }

    const safeStorage = getSafeStorage();
    const encryptedBuffer = Buffer.from(encryptedBase64, "base64");
    return safeStorage.decryptString(encryptedBuffer);
}