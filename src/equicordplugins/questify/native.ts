/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { BrowserWindow, type IpcMainInvokeEvent } from "electron";

export function canOpenDevTools(event: IpcMainInvokeEvent): boolean {
    return !event.sender.isDestroyed();
}

export function openDevTools(event: IpcMainInvokeEvent): boolean {
    if (!canOpenDevTools(event)) {
        return false;
    }

    const window = BrowserWindow.fromWebContents(event.sender);

    if (event.sender.isDevToolsOpened()) {
        window?.focus();

        return true;
    }

    event.sender.openDevTools();

    return true;
}

<<<<<<< HEAD
export async function complete(_: IpcMainInvokeEvent, appId: string, authCode: string, questTarget: number, questId: string, activityReferrer?: string): Promise<{ success: boolean; error: string | null; }> {
    const authorization = await authorize(appId, authCode, questId, activityReferrer);

    if (authorization.error || !authorization.token) {
        return { success: false, error: "AUTH: " + JSON.stringify(authorization.error) };
    }

    const progressResult = await progress(appId, authorization.token, questTarget, questId, activityReferrer);

    if (progressResult.error || !progressResult.success) {
        return { success: false, error: "PROGRESS: " + JSON.stringify(progressResult.error) };
=======
export async function complete(_: IpcMainInvokeEvent, appId: string, authCode: string, questTarget: number): Promise<{ success: boolean; error: string | null; }> {
    const authorization = await authorize(appId, authCode);

    if (authorization.error || !authorization.token) {
        return { success: false, error: JSON.stringify(authorization.error) };
    }

    const progressResult = await progress(appId, authorization.token, questTarget);

    if (progressResult.error || !progressResult.success) {
        return { success: false, error: JSON.stringify(progressResult.error) };
>>>>>>> 89b0fd2a5 (Update index.tsx)
    }

    return { success: true, error: null };
}

<<<<<<< HEAD
function getActivityHeaders(questId: string, authToken: string = "", activityReferrer?: string): Record<string, string> {
    const headers: Record<string, string> = {
        "Content-Type": "application/json",
        "X-Auth-Token": authToken,
        "X-Discord-Quest-ID": questId,
    };

    if (activityReferrer) {
        headers.Referer = activityReferrer;
    }

    return headers;
}

async function readJson(res: Response): Promise<unknown> {
    try {
        return await res.json();
    } catch {
        return null;
    }
}

function getResponseToken(data: unknown): string | false {
    if (data != null && typeof data === "object" && "token" in data && typeof data.token === "string") {
        return data.token;
    }

    return false;
}

async function authorize(appId: string, authCode: string, questId: string, activityReferrer?: string): Promise<{ token: string | false; error: unknown; }> {
    let error: unknown = null;

    const token = await fetch(`https://${appId}.discordsays.com/.proxy/acf/authorize`, {
        headers: getActivityHeaders(questId, "", activityReferrer),
=======
async function authorize(appId: string, authCode: string): Promise<{ token: string | false; error: unknown; }> {
    let error: unknown = null;

    const token = await fetch(`https://${appId}.discordsays.com/.proxy/acf/authorize`, {
>>>>>>> 89b0fd2a5 (Update index.tsx)
        body: JSON.stringify({ code: authCode }),
        method: "POST",
        mode: "cors",
        credentials: "include",
    })
<<<<<<< HEAD
        .then(async res => {
            const data = await readJson(res);
            const token = getResponseToken(data);

            if (!res.ok || !token) {
                error = { status: res.status, body: data };
                return false as const;
            }

            return token;
        })
        .catch(e => {
            error = e;
            return false as const;
=======
        .then(res => res.json())
        .then(data => data.token)
        .catch(e => {
            error = e;
            return false;
>>>>>>> 89b0fd2a5 (Update index.tsx)
        });

    return { token, error };
}

<<<<<<< HEAD
async function progress(appId: string, token: string, questTarget: number, questId: string, activityReferrer?: string): Promise<{ success: boolean; error: unknown; }> {
    let error: unknown = null;

    const success = await fetch(`https://${appId}.discordsays.com/.proxy/acf/quest/progress`, {
        headers: getActivityHeaders(questId, token, activityReferrer),
=======
async function progress(appId: string, token: string, questTarget: number): Promise<{ success: boolean; error: unknown; }> {
    let error: unknown = null;

    const success = await fetch(`https://${appId}.discordsays.com/.proxy/acf/quest/progress`, {
        headers: { "x-auth-token": token },
>>>>>>> 89b0fd2a5 (Update index.tsx)
        body: JSON.stringify({ progress: questTarget }),
        method: "POST",
        mode: "cors",
        credentials: "include",
    })
        .then(res => res.ok)
        .catch(e => {
            error = e;
            return false;
        });

    return { success, error };
}
