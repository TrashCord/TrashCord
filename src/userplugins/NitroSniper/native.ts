/*
 * TrashCord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { IpcMainInvokeEvent } from "electron";
import { type FSWatcher, watch } from "fs";
import { open } from "fs/promises";
import { resolve, sep } from "path";
import { setTimeout as sleep } from "timers/promises";

interface NativeWebhookResponse {
    status: number;
    data: string;
}

interface NativeCaptchaResponse {
    success: boolean;
    token?: string;
    error?: string;
}

interface CaptchaSolverOptions {
    provider: "nonecap" | "bruxsolver";
    proxy?: string;
    powType?: "" | "hsw" | "hsl";
}

interface NativeSolverAccountResponse {
    success: boolean;
    remainingSolves?: number;
    threadLimit?: number;
    threadsInUse?: number;
    availableThreads?: number;
    error?: string;
}

interface NightyGiftDetection {
    code: string;
    accountName: string;
    guildName: string;
    channelName: string;
    authorName: string;
}

const NONECAP_SOLVES_URL = "https://api.nonecap.com/v1/solves";
const BRUXSOLVER_API_URL = "https://bruxsolver.org";
const BRUXSOLVER_ERRORS: Record<string, string> = {
    MISSING_API_KEY: "BruxSolver API key is missing.",
    INVALID_API_KEY: "BruxSolver API key is invalid or revoked.",
    INSUFFICIENT_BALANCE: "No BruxSolver solves remaining.",
    THREAD_LIMIT_REACHED: "BruxSolver concurrent request limit reached.",
    MISSING_PROXY: "BruxSolver requires a proxy for this request."
};
const MAX_RESPONSE_BYTES = 64 * 1024;
const SOLVE_TIMEOUT_MS = 115_000;
const activeSolves = new Set<AbortController>();

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}

function validatePageUrl(pageUrl: string) {
    if (pageUrl.length > 2048) return null;
    try {
        const url = new URL(pageUrl);
        if (url.protocol !== "https:" || url.hostname !== "discord.com" && !url.hostname.endsWith(".discord.com")) return null;
        return url.toString();
    } catch {
        return null;
    }
}

function getErrorMessage(body: unknown, fallback: string) {
    if (!isRecord(body)) return fallback;
    if (typeof body.error === "string") return body.error;
    if (isRecord(body.error) && typeof body.error.message === "string") return body.error.message;
    if (typeof body.errorDescription === "string") return body.errorDescription;
    if (typeof body.msg === "string") return body.msg;
    return fallback;
}

async function readJson(response: Response): Promise<unknown> {
    if (!response.body) return null;

    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        size += value.byteLength;
        if (size > MAX_RESPONSE_BYTES) {
            await reader.cancel();
            throw new Error("Response is too large.");
        }

        chunks.push(value);
    }

    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
    }

    const text = new TextDecoder().decode(bytes);
    return text ? JSON.parse(text) : null;
}

async function requestNoneCap(url: string, apiKey: string, signal: AbortSignal, body?: string) {
    const response = await fetch(url, {
        method: body ? "POST" : "GET",
        headers: {
            Authorization: `Bearer ${apiKey}`,
            ...(body ? { "Content-Type": "application/json" } : {})
        },
        body,
        redirect: "error",
        signal
    });
    const data = await readJson(response);

    if (!response.ok) throw new Error(getErrorMessage(data, `NoneCap returned status ${response.status}.`));
    return data;
}

async function requestBruxSolver(endpoint: "solve" | "balance" | "threads", apiKey: string, signal: AbortSignal, body?: string) {
    const response = await fetch(`${BRUXSOLVER_API_URL}/${endpoint}`, {
        method: body ? "POST" : "GET",
        headers: {
            "x-api-key": apiKey,
            ...(body ? { "Content-Type": "application/json" } : {})
        },
        body,
        redirect: "error",
        signal
    });
    const data = await readJson(response);
    if (!isRecord(data) || !response.ok || data.success !== true) {
        const errorCode = isRecord(data) && typeof data.error_code === "string" ? data.error_code : "";
        throw new Error(BRUXSOLVER_ERRORS[errorCode] ?? (response.ok
            ? "BruxSolver returned an invalid response."
            : `BruxSolver returned status ${response.status}.`));
    }
    return data;
}

function parseSolve(data: unknown) {
    if (!isRecord(data)) throw new Error("NoneCap returned an invalid response.");

    return {
        id: typeof data.id === "string" ? data.id : null,
        status: typeof data.status === "string" ? data.status : null,
        token: typeof data.token === "string" ? data.token : null,
        error: getErrorMessage(data, "NoneCap could not solve the CAPTCHA.")
    };
}

async function solveWithNoneCap(apiKey: string, sitekey: string, rqdata: string | undefined, url: string, userAgent: string, signal: AbortSignal): Promise<NativeCaptchaResponse> {
    let solve = parseSolve(await requestNoneCap(
        `${NONECAP_SOLVES_URL}?wait=90`,
        apiKey,
        signal,
        JSON.stringify({
            type: rqdata ? "hcaptcha_enterprise" : "hcaptcha",
            sitekey,
            url,
            ...(rqdata ? { rqdata } : {}),
            user_agent: userAgent
        })
    ));

    while (solve.status === "pending" || solve.status === "solving") {
        if (!solve.id || !/^solve_[a-zA-Z0-9_-]+$/.test(solve.id)) {
            return { success: false, error: "NoneCap returned an invalid solve ID." };
        }

        await sleep(2000, undefined, { signal });
        solve = parseSolve(await requestNoneCap(`${NONECAP_SOLVES_URL}/${encodeURIComponent(solve.id)}`, apiKey, signal));
    }

    if (solve.status !== "solved" || !solve.token) return { success: false, error: solve.error };
    return { success: true, token: solve.token };
}

export async function solveCaptcha(
    _: IpcMainInvokeEvent,
    apiKey: string,
    sitekey: string,
    rqdata: string | undefined,
    pageUrl: string,
    userAgent: string,
    options: CaptchaSolverOptions
): Promise<NativeCaptchaResponse> {
    const key = typeof apiKey === "string" ? apiKey.trim() : "";
    const url = typeof pageUrl === "string" ? validatePageUrl(pageUrl) : null;
    if (!key || key.length > 512 || /[\r\n]/.test(key)) return { success: false, error: "CAPTCHA API key is invalid." };
    if (typeof sitekey !== "string" || !sitekey || sitekey.length > 256) return { success: false, error: "CAPTCHA site key is invalid." };
    if (rqdata !== undefined && (typeof rqdata !== "string" || rqdata.length > 20_000)) return { success: false, error: "CAPTCHA request data is invalid." };
    if (!url) return { success: false, error: "Discord page URL is invalid." };
    if (typeof userAgent !== "string" || userAgent.length > 512 || /[\r\n]/.test(userAgent)) return { success: false, error: "User agent is invalid." };
    if (!isRecord(options) || options.provider !== "nonecap" && options.provider !== "bruxsolver") return { success: false, error: "CAPTCHA provider is invalid." };
    if (options.provider === "bruxsolver") {
        if (options.proxy !== undefined && (typeof options.proxy !== "string" || options.proxy.length > 2048 || /[\r\n]/.test(options.proxy))) {
            return { success: false, error: "BruxSolver proxy URL is invalid." };
        }
        if (options.proxy) {
            try {
                const proxy = new URL(options.proxy);
                if (proxy.protocol !== "http:" && proxy.protocol !== "https:" || !proxy.hostname) {
                    return { success: false, error: "BruxSolver proxy must use HTTP or HTTPS." };
                }
            } catch {
                return { success: false, error: "BruxSolver proxy URL is invalid." };
            }
        }
        if (options.powType !== undefined && options.powType !== "" && options.powType !== "hsw" && options.powType !== "hsl") {
            return { success: false, error: "BruxSolver proof of work type must be HSW or HSL." };
        }
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), SOLVE_TIMEOUT_MS);
    activeSolves.add(controller);

    try {
        if (options.provider === "bruxsolver") {
            const data = await requestBruxSolver("solve", key, controller.signal, JSON.stringify({
                ...(options.proxy ? { proxy: options.proxy } : {}),
                sitekey,
                href: url,
                ...(rqdata ? { rqdata } : {}),
                ...(options.powType ? { pow_type: options.powType } : {})
            }));
            const token = typeof data.token === "string" && data.token ? data.token : data.solution;
            if (data.status !== "challenge_pass" || typeof token !== "string" || !token) {
                return { success: false, error: "BruxSolver could not solve the CAPTCHA." };
            }
            return { success: true, token };
        }
        return await solveWithNoneCap(key, sitekey, rqdata, url, userAgent, controller.signal);
    } catch (error) {
        return {
            success: false,
            error: error instanceof Error && error.name === "AbortError"
                ? "CAPTCHA request was cancelled or timed out."
                : error instanceof Error
                    ? error.message
                    : "CAPTCHA solve failed."
        };
    } finally {
        clearTimeout(timeout);
        activeSolves.delete(controller);
    }
}

export async function getBruxSolverAccount(_: IpcMainInvokeEvent, apiKey: string): Promise<NativeSolverAccountResponse> {
    const key = typeof apiKey === "string" ? apiKey.trim() : "";
    if (!key || key.length > 512 || /[\r\n]/.test(key)) return { success: false, error: "BruxSolver API key is invalid." };
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    activeSolves.add(controller);
    try {
        const [balance, threads] = await Promise.all([
            requestBruxSolver("balance", key, controller.signal),
            requestBruxSolver("threads", key, controller.signal)
        ]);
        if (![balance.remaining_solves, threads.thread_limit, threads.threads_in_use, threads.available_threads]
            .every(value => typeof value === "number" && Number.isSafeInteger(value) && value >= 0)) {
            return { success: false, error: "BruxSolver returned invalid account details." };
        }
        return {
            success: true,
            remainingSolves: balance.remaining_solves as number,
            threadLimit: threads.thread_limit as number,
            threadsInUse: threads.threads_in_use as number,
            availableThreads: threads.available_threads as number
        };
    } catch {
        return { success: false, error: "Could not check the BruxSolver account. Check your API key and try again." };
    } finally {
        clearTimeout(timeout);
        activeSolves.delete(controller);
    }
}

export function cancelCaptchaSolves() {
    for (const controller of activeSolves) controller.abort();
    activeSolves.clear();
}

export async function sendWebhook(_: IpcMainInvokeEvent, webhookUrl: string, payload: string): Promise<NativeWebhookResponse> {
    try {
        const url = new URL(webhookUrl);
        url.searchParams.set("wait", "true");

        const response = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: payload,
            signal: AbortSignal.timeout(30_000)
        });

        return { status: response.status, data: await response.text() };
    } catch (error) {
        return { status: -1, data: error instanceof Error ? error.message : String(error) };
    }
}

const GIFT_LOG_REGEX = /\[GIFT DETECTED\] Account: (.{1,100}?) \| Code: ([a-zA-Z0-9]{16,24}) \| Server: (.{1,500}?) \| Channel: (.{1,200}?) \| Author: (.{1,100}?)\s*$/;
const MAX_READ_BYTES = 1024 * 1024;

let watcher: FSWatcher | undefined;
let logPath = "";
let logOffset = 0;
let pendingText = "";
let reading = false;
let readAgain = false;
const giftQueue: NightyGiftDetection[] = [];
const seenCodes = new Set<string>();
const waiters: Array<(detection: NightyGiftDetection | null) => void> = [];

function enqueueGift(detection: NightyGiftDetection) {
    if (seenCodes.has(detection.code)) return;
    seenCodes.add(detection.code);
    if (seenCodes.size > 500) seenCodes.delete(seenCodes.values().next().value!);

    const waiter = waiters.shift();
    if (waiter) waiter(detection);
    else giftQueue.push(detection);
}

async function readNewLogEntries() {
    if (reading) {
        readAgain = true;
        return;
    }

    reading = true;
    try {
        const file = await open(logPath, "r");
        try {
            const { size } = await file.stat();
            if (size < logOffset) {
                logOffset = 0;
                pendingText = "";
            }
            if (size === logOffset) return;

            const length = Math.min(size - logOffset, MAX_READ_BYTES);
            const position = size - length;
            if (position > logOffset) pendingText = "";

            const buffer = Buffer.alloc(length);
            const { bytesRead } = await file.read(buffer, 0, length, position);
            logOffset = size;
            pendingText += buffer.toString("utf8", 0, bytesRead);

            const lines = pendingText.split(/\r?\n/);
            pendingText = lines.pop() ?? "";
            for (const line of lines) {
                const match = line.match(GIFT_LOG_REGEX);
                if (!match) continue;

                enqueueGift({
                    accountName: match[1].trim(),
                    code: match[2],
                    guildName: match[3].trim(),
                    channelName: match[4].trim(),
                    authorName: match[5].trim()
                });
            }
        } finally {
            await file.close();
        }
    } catch (error) {
        if ((error as { code?: string; })?.code === "ENOENT") {
            logOffset = 0;
            pendingText = "";
        }
    } finally {
        reading = false;
        if (readAgain) {
            readAgain = false;
            void readNewLogEntries();
        }
    }
}

function handleLogChange() {
    void readNewLogEntries();
}

function stopWatcher() {
    watcher?.close();
    watcher = undefined;
    logPath = "";
    logOffset = 0;
    pendingText = "";
    reading = false;
    readAgain = false;
    giftQueue.length = 0;
    seenCodes.clear();
    for (const waiter of waiters.splice(0)) waiter(null);
}

export async function startNightyAltDetection(_: IpcMainInvokeEvent): Promise<string | null> {
    stopWatcher();

    const appData = process.env.APPDATA;
    if (!appData) return "Nighty's data folder could not be found.";

    const logsRoot = resolve(appData, "Nighty Selfbot", "data", "scripts", "logs");
    logPath = resolve(logsRoot, "nitro_sniper.log");
    if (!logPath.startsWith(`${logsRoot}${sep}`)) return "Nighty's Nitro Sniper log path is invalid.";

    try {
        const file = await open(logPath, "r");
        try {
            logOffset = (await file.stat()).size;
        } finally {
            await file.close();
        }

        watcher = watch(logPath, handleLogChange);
        watcher.once("error", stopWatcher);
        return null;
    } catch {
        stopWatcher();
        return "Nighty's Nitro Sniper log could not be opened.";
    }
}

export function waitForNightyGiftCode(_: IpcMainInvokeEvent): Promise<NightyGiftDetection | null> {
    const detection = giftQueue.shift();
    if (detection) return Promise.resolve(detection);
    if (!watcher) return Promise.resolve(null);

    return new Promise(resolve => waiters.push(resolve));
}

export function stopNightyAltDetection(_: IpcMainInvokeEvent) {
    stopWatcher();
}