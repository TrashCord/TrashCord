import { IpcMainInvokeEvent } from "electron";
import { type FSWatcher, watch } from "fs";
import { open } from "fs/promises";
import { resolve, sep } from "path";
import { setTimeout as sleep } from "timers/promises";

interface NativeWebhookResponse {
    status: number;
    data: string;
}

interface VoidSolverTaskResult {
    taskId: string;
    externalTaskId?: string;
    status: string;
    solveTime?: number;
    site?: string;
    createdAt?: string;
    updatedAt?: string;
}

interface NativeCaptchaResponse {
    success: boolean;
    token?: string;
    error?: string;
    task?: VoidSolverTaskResult;
}

interface NightyGiftDetection {
    code: string;
    accountName: string;
    guildName: string;
    channelName: string;
    authorName: string;
}

const NONECAP_SOLVES_URL = "https://api.nonecap.com/v1/solves";
const NOCAPTCHAAI_URL = "https://api.nocaptchaai.com";
const VOIDSOLVER_URL = "https://api.voidsolver.tech";
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

function parseSolve(data: unknown) {
    if (!isRecord(data)) throw new Error("NoneCap returned an invalid response.");

    return {
        id: typeof data.id === "string" ? data.id : null,
        status: typeof data.status === "string" ? data.status : null,
        token: typeof data.token === "string" ? data.token : null,
        error: getErrorMessage(data, "NoneCap could not solve the CAPTCHA.")
    };
}

async function requestNoCaptchaAI(path: string, apiKey: string, signal: AbortSignal, body: Record<string, unknown>) {
    const response = await fetch(`${NOCAPTCHAAI_URL}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientKey: apiKey, ...body }),
        redirect: "error",
        signal
    });
    const data = await readJson(response);

    if (!response.ok) throw new Error(getErrorMessage(data, `NoCaptchaAI returned status ${response.status}.`));
    return data;
}

function parseNoCaptchaAI(data: unknown) {
    if (!isRecord(data)) throw new Error("NoCaptchaAI returned an invalid response.");

    const solution = isRecord(data.solution) ? data.solution : null;
    return {
        taskId: typeof data.taskId === "string" ? data.taskId : null,
        status: typeof data.status === "string" ? data.status : null,
        token: solution && typeof solution.token === "string" ? solution.token : null,
        errorId: typeof data.errorId === "number" ? data.errorId : 0,
        error: getErrorMessage(data, "NoCaptchaAI could not solve the CAPTCHA.")
    };
}

async function requestVoidSolver(path: string, apiKey: string, signal: AbortSignal, body?: Record<string, unknown>) {
    const response = await fetch(`${VOIDSOLVER_URL}${path}`, {
        method: body ? "POST" : "GET",
        headers: {
            Authorization: `Bearer ${apiKey}`,
            ...(body ? { "Content-Type": "application/json" } : {})
        },
        body: body ? JSON.stringify(body) : undefined,
        redirect: "error",
        signal
    });
    const data = await readJson(response);

    if (!response.ok) throw new Error(getErrorMessage(data, `VoidSolver returned status ${response.status}.`));
    return data;
}

function parseVoidSolver(data: unknown) {
    if (!isRecord(data)) throw new Error("VoidSolver returned an invalid response.");

    const payload = isRecord(data.data) ? data.data : data;
    const taskIdValue = payload.taskId ?? payload.task_id ?? payload.id;
    const taskId = typeof taskIdValue === "string"
        ? taskIdValue
        : typeof taskIdValue === "number" && Number.isFinite(taskIdValue)
            ? String(taskIdValue)
            : null;

    return {
        taskId,
        status: typeof payload.status === "string" ? payload.status : typeof data.status === "string" ? data.status : null,
        token: typeof payload.solvedToken === "string"
            ? payload.solvedToken
            : typeof payload.uuid === "string"
                ? payload.uuid
                : typeof payload.token === "string"
                    ? payload.token
                    : null,
        externalTaskId: typeof payload.externalTaskId === "string" ? payload.externalTaskId : undefined,
        solveTime: typeof payload.solveTime === "number" && Number.isFinite(payload.solveTime) ? payload.solveTime : undefined,
        site: typeof payload.site === "string" ? payload.site : undefined,
        createdAt: typeof payload.createdAt === "string" ? payload.createdAt : undefined,
        updatedAt: typeof payload.updatedAt === "string" ? payload.updatedAt : undefined,
        error: getErrorMessage(payload, getErrorMessage(data, "VoidSolver could not solve the CAPTCHA."))
    };
}

function getVoidSolverTaskResult(task: ReturnType<typeof parseVoidSolver>, taskId: string): VoidSolverTaskResult {
    return {
        taskId: task.taskId ?? taskId,
        externalTaskId: task.externalTaskId,
        status: task.status ?? "unknown",
        solveTime: task.solveTime,
        site: task.site,
        createdAt: task.createdAt,
        updatedAt: task.updatedAt
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

async function solveWithNoCaptchaAI(apiKey: string, sitekey: string, rqdata: string | undefined, url: string, userAgent: string, signal: AbortSignal): Promise<NativeCaptchaResponse> {
    let task = parseNoCaptchaAI(await requestNoCaptchaAI("/createTask", apiKey, signal, {
        task: {
            type: "HCaptchaTaskProxyLess",
            websiteURL: url,
            websiteKey: sitekey,
            userAgent,
            ...(rqdata ? { enterprisePayload: { rqdata } } : {})
        }
    }));

    if (task.errorId) return { success: false, error: task.error };
    if (!task.taskId || task.taskId.length > 256 || /[\r\n]/.test(task.taskId)) {
        return { success: false, error: "NoCaptchaAI returned an invalid task ID." };
    }
    const { taskId } = task;

    while (task.status === "idle" || task.status === "processing") {
        await sleep(3000, undefined, { signal });
        task = parseNoCaptchaAI(await requestNoCaptchaAI("/getTaskResult", apiKey, signal, { taskId }));
        if (task.errorId) return { success: false, error: task.error };
    }

    if (task.status !== "ready" || !task.token) return { success: false, error: task.error };
    return { success: true, token: task.token };
}

async function solveWithVoidSolver(apiKey: string, proxy: string | undefined, sitekey: string, rqdata: string | undefined, url: string, signal: AbortSignal): Promise<NativeCaptchaResponse> {
    let task = parseVoidSolver(await requestVoidSolver("/createtask", apiKey, signal, {
        site_url: url,
        site_key: sitekey,
        ...(proxy ? { proxy } : {}),
        ...(rqdata ? { rqdata } : {}),
        pow_type: "hsw"
    }));

    if (task.status === "success" && task.token && task.taskId) {
        return { success: true, token: task.token, task: getVoidSolverTaskResult(task, task.taskId) };
    }

    const taskId = task.taskId?.trim();
    if (!taskId || taskId.length > 256 || /[\r\n]/.test(taskId)) return { success: false, error: task.error };

    do {
        await sleep(2000, undefined, { signal });
        task = parseVoidSolver(await requestVoidSolver(`/gettaskresult?taskid=${encodeURIComponent(taskId)}`, apiKey, signal));
    } while (task.status === "solving");

    if (task.status !== "success" || !task.token) return { success: false, error: task.error, task: getVoidSolverTaskResult(task, taskId) };
    return { success: true, token: task.token, task: getVoidSolverTaskResult(task, taskId) };
}

export async function solveCaptcha(
    _: IpcMainInvokeEvent,
    provider: string,
    apiKey: string,
    proxy: string | undefined,
    sitekey: string,
    rqdata: string | undefined,
    pageUrl: string,
    userAgent: string
): Promise<NativeCaptchaResponse> {
    if (provider !== "nonecap" && provider !== "nocaptchaai" && provider !== "voidsolver") return { success: false, error: "CAPTCHA service is invalid." };
    const key = typeof apiKey === "string" ? apiKey.trim() : "";
    const url = typeof pageUrl === "string" ? validatePageUrl(pageUrl) : null;
    if (!key || key.length > 512 || /[\r\n]/.test(key)) return { success: false, error: "CAPTCHA API key is invalid." };
    if (typeof sitekey !== "string" || !sitekey || sitekey.length > 256) return { success: false, error: "CAPTCHA site key is invalid." };
    if (proxy !== undefined && (typeof proxy !== "string" || proxy.length > 2048 || /[\r\n]/.test(proxy))) return { success: false, error: "CAPTCHA proxy is invalid." };
    if (rqdata !== undefined && (typeof rqdata !== "string" || rqdata.length > 20_000)) return { success: false, error: "CAPTCHA request data is invalid." };
    if (!url) return { success: false, error: "Discord page URL is invalid." };
    if (typeof userAgent !== "string" || userAgent.length > 512 || /[\r\n]/.test(userAgent)) return { success: false, error: "User agent is invalid." };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), SOLVE_TIMEOUT_MS);
    activeSolves.add(controller);

    try {
        if (provider === "nocaptchaai") return await solveWithNoCaptchaAI(key, sitekey, rqdata, url, userAgent, controller.signal);
        if (provider === "voidsolver") return await solveWithVoidSolver(key, proxy, sitekey, rqdata, url, controller.signal);
        return await solveWithNoneCap(key, sitekey, rqdata, url, userAgent, controller.signal);
    } catch (error) {
        return {
            success: false,
            error: error instanceof Error && error.name === "AbortError"
                ? `${provider === "nocaptchaai" ? "NoCaptchaAI" : provider === "voidsolver" ? "VoidSolver" : "NoneCap"} solve timed out.`
                : error instanceof Error
                    ? error.message
                    : "CAPTCHA solve failed."
        };
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
            body: payload
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
    } catch {
        logOffset = 0;
        pendingText = "";
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
