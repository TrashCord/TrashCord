/*
 * TrashCord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import managedStyle from "./style.css?managed";

import { NavContextMenuPatchCallback } from "@api/ContextMenu";
import { definePluginSettings } from "@api/Settings";
import ErrorBoundary from "@components/ErrorBoundary";
import { Devs } from "@utils/constants";
import { classNameFactory } from "@utils/css";
import { sleep } from "@utils/misc";
import { ModalContent, ModalFooter, ModalHeader, ModalRoot, ModalSize, openModal, RenderModalProps } from "@utils/modal";
import definePlugin, { OptionType } from "@utils/types";
import type { User } from "@vencord/discord-types";
import { ChannelActionCreators, ChannelStore, Constants, Menu, React, RestAPI, showToast, useEffect, useReducer, UserStore, useState } from "@webpack/common";

const cl = classNameFactory("vc-purgedms-");

const DELETABLE_TYPES = new Set([0, 19, 20, 23]);
const MAX_LINES = 20;
const MAX_STRIKES = 15;

const settings = definePluginSettings({
    deleteDelayMs: {
        type: OptionType.SLIDER,
        description: "Minimum delay between deletions in ms. Higher is smoother on slow PCs. Rate limits are handled automatically.",
        markers: [0, 100, 200, 350, 500, 750, 1000],
        default: 200,
        stickToMarkers: false
    },
    confirmBeforeRun: {
        type: OptionType.BOOLEAN,
        description: "Ask for confirmation before a purge starts.",
        default: true
    },
    skipPinned: {
        type: OptionType.BOOLEAN,
        description: "Don't delete pinned messages.",
        default: false
    }
});

type PurgeState = "idle" | "running" | "done" | "stopped" | "error";

interface FeedLine {
    id: string;
    content: string;
    ok: boolean;
}

interface RawMessage {
    id: string;
    type: number;
    content?: string;
    pinned?: boolean;
    author?: { id: string; };
    attachments?: unknown[];
}

const purge = {
    state: "idle" as PurgeState,
    note: "",
    userId: "",
    username: "",
    scanned: 0,
    deleted: 0,
    skipped: 0,
    lines: [] as FeedLine[],
};

const BLANK = { state: "idle" as PurgeState, note: "", scanned: 0, deleted: 0, skipped: 0, lines: [] as FeedLine[] };

let runId = 0;
const subs = new Set<() => void>();
const notify = () => subs.forEach(fn => fn());

function usePurge() {
    const [, bump] = useReducer((n: number) => n + 1, 0);
    useEffect(() => { subs.add(bump); return () => void subs.delete(bump); }, []);
    return purge;
}

async function getDMChannelId(userId: string): Promise<string | null> {
    const existing = ChannelStore.getDMFromUserId?.(userId);
    if (existing) return existing;
    try {
        return await ChannelActionCreators.getOrEnsurePrivateChannel(userId);
    } catch {
        return null;
    }
}

async function fetchBatch(channelId: string, before?: string): Promise<RawMessage[] | null> {
    const url = `${Constants.Endpoints.MESSAGES(channelId)}?limit=100${before ? `&before=${before}` : ""}`;
    for (let attempt = 0; attempt < 5; attempt++) {
        try {
            const res = await RestAPI.get({ url });
            return res.body ?? [];
        } catch (e: any) {
            if (e?.status === 429) await sleep(((e?.body?.retry_after ?? 1) * 1000) + 100);
            else return null;
        }
    }
    return null;
}

async function deleteOne(channelId: string, id: string): Promise<{ status: "ok" | "gone" | "fail"; wait: number; }> {
    const url = Constants.Endpoints.MESSAGE(channelId, id);
    for (let attempt = 0; attempt < 5; attempt++) {
        try {
            const res: any = await RestAPI.del({ url });
            const h = res?.headers;
            const wait = h?.["x-ratelimit-remaining"] === "0"
                ? (Math.ceil(parseFloat(h["x-ratelimit-reset-after"] ?? "0") * 1000) || 0)
                : 0;
            return { status: "ok", wait };
        } catch (e: any) {
            if (e?.status === 429) await sleep(((e?.body?.retry_after ?? 1) * 1000) + 100);
            else return { status: e?.status === 404 ? "gone" : "fail", wait: 0 };
        }
    }
    return { status: "fail", wait: 0 };
}

function pushLine(m: RawMessage, ok: boolean) {
    const content = (m.content || "").replace(/\n/g, " ").trim().slice(0, 120)
        || (m.attachments?.length ? `[${m.attachments.length} attachment(s)]` : "[embed / empty]");
    purge.lines = [{ id: m.id, content, ok }, ...purge.lines.slice(0, MAX_LINES - 1)];
}

async function runPurge(my: number) {
    const finish = (state: PurgeState, note: string) => {
        if (my !== runId) return;
        purge.state = state;
        purge.note = note;
        notify();
        showToast({
            text: `Purge DMs @${purge.username}: ${purge.deleted} deleted${state === "error" ? ` - ${note}` : ""}`,
            variant: state === "error" ? "critical" : "success"
        });
    };

    const channelId = await getDMChannelId(purge.userId);
    if (my !== runId) return;
    if (!channelId) return finish("error", "No DM channel found.");

    const me = UserStore.getCurrentUser()?.id;
    let before: string | undefined;
    let strikes = 0;

    while (my === runId) {
        const batch = await fetchBatch(channelId, before);
        if (my !== runId) return;
        if (!batch) return finish("error", "Couldn't load messages.");
        if (!batch.length) break;
        before = batch[batch.length - 1].id;
        purge.scanned += batch.length;
        notify();

        for (const m of batch) {
            if (my !== runId) return;
            if (m.author?.id !== me || !DELETABLE_TYPES.has(m.type) || (m.pinned && settings.store.skipPinned)) continue;
            const r = await deleteOne(channelId, m.id);
            if (my !== runId) return;
            if (r.status === "gone") continue;
            const ok = r.status === "ok";
            if (ok) { purge.deleted++; strikes = 0; }
            else { purge.skipped++; strikes++; }
            pushLine(m, ok);
            notify();
            if (strikes >= MAX_STRIKES) return finish("error", "Too many messages can't be deleted, stopped.");
            const wait = ok ? Math.max(r.wait, settings.store.deleteDelayMs) : 0;
            if (wait > 0) await sleep(wait);
        }
        if (batch.length < 100) break;
    }

    finish("done", purge.skipped ? `${purge.skipped} couldn't be deleted.` : "DM cleared.");
}

function startPurge(user: User) {
    if (purge.state === "running") return;
    purge.userId = user.id;
    purge.username = user.globalName || user.username || "user";
    purge.state = "running";
    purge.note = "";
    purge.scanned = 0;
    purge.deleted = 0;
    purge.skipped = 0;
    purge.lines = [];
    notify();
    runPurge(++runId);
}

function stopPurge() {
    if (purge.state !== "running") return;
    runId++;
    purge.state = "stopped";
    purge.note = "";
    notify();
}

function FeedRowImpl({ line }: { line: FeedLine; }) {
    return (
        <div className={cl("line") + " " + cl(line.ok ? "line-killed" : "line-failed")}>
            <span className={cl("tag")}>{line.ok ? "DEL" : "FAIL"}</span>
            <span className={cl("content")}>{line.content}</span>
        </div>
    );
}

let MemoRow: typeof FeedRowImpl | undefined;
const getRow = () => (MemoRow ??= React.memo(FeedRowImpl) as typeof FeedRowImpl);

const STATUS_TEXT: Record<PurgeState, string> = {
    idle: "Starting…",
    running: "Purging…",
    done: "Done.",
    stopped: "Stopped.",
    error: "Failed."
};

function PurgeModal({ rootProps, user }: { rootProps: RenderModalProps; user: User; }) {
    const p = usePurge();
    const Row = getRow();
    const [confirmed, setConfirmed] = useState(!settings.store.confirmBeforeRun);

    const mine = p.userId === user.id && p.state !== "idle";
    const showProgress = mine || confirmed;
    const v = mine ? p : BLANK;
    const busy = showProgress && (v.state === "running" || v.state === "idle");

    useEffect(() => {
        if (confirmed && !mine) startPurge(user);
    }, [confirmed]);

    const username = user.globalName || user.username || "user";

    return (
        <ModalRoot {...rootProps} size={ModalSize.MEDIUM}>
            <ModalHeader>
                <h2 className={cl("title")}>Purge DMs - @{username}</h2>
            </ModalHeader>

            <ModalContent>
                <div className={cl("modal")}>
                    {!showProgress ? (
                        <div className={cl("text")}>
                            This will permanently delete <b>every message you sent</b> in your DM with{" "}
                            <b>@{username}</b>. This cannot be undone.
                        </div>
                    ) : (
                        <>
                            <div className={cl("stats")}>
                                <div className={cl("stat")}>
                                    <span className={cl("stat-num")}>{v.deleted}</span>
                                    <span className={cl("stat-label")}>Deleted</span>
                                </div>
                                {v.skipped > 0 && (
                                    <div className={cl("stat")}>
                                        <span className={cl("stat-num")}>{v.skipped}</span>
                                        <span className={cl("stat-label")}>Skipped</span>
                                    </div>
                                )}
                                <div className={cl("stat")}>
                                    <span className={cl("stat-num")}>{v.scanned}</span>
                                    <span className={cl("stat-label")}>Scanned</span>
                                </div>
                                <span className={cl("status")} data-state={v.state}>
                                    {STATUS_TEXT[v.state]}{v.note ? ` ${v.note}` : ""}
                                </span>
                            </div>

                            {busy && (
                                <div className={cl("muted")}>
                                    You can close this window, the purge keeps running in the background.
                                </div>
                            )}

                            <div className={cl("feed")}>
                                {v.lines.length === 0 && busy && (
                                    <div className={cl("muted")}>scanning history…</div>
                                )}
                                {v.lines.map(line => <Row key={line.id} line={line} />)}
                            </div>
                        </>
                    )}
                </div>
            </ModalContent>

            <ModalFooter>
                {!showProgress ? (
                    <>
                        <button className={cl("btn") + " " + cl("btn-danger")} onClick={() => setConfirmed(true)}>
                            Purge everything
                        </button>
                        <button className={cl("btn") + " " + cl("btn-link")} onClick={rootProps.onClose}>
                            Cancel
                        </button>
                    </>
                ) : busy ? (
                    <>
                        <button className={cl("btn") + " " + cl("btn-danger")} onClick={stopPurge}>
                            Stop
                        </button>
                        <button className={cl("btn") + " " + cl("btn-brand")} onClick={rootProps.onClose}>
                            Run in background
                        </button>
                    </>
                ) : (
                    <>
                        <button className={cl("btn") + " " + cl("btn-brand")} onClick={rootProps.onClose}>
                            Close
                        </button>
                        <button className={cl("btn") + " " + cl("btn-link")} onClick={() => startPurge(user)}>
                            Run again
                        </button>
                    </>
                )}
            </ModalFooter>
        </ModalRoot>
    );
}

function openPurgeModal(user: User) {
    openModal(props => (
        <ErrorBoundary>
            <PurgeModal rootProps={props} user={user} />
        </ErrorBoundary>
    ));
}

const userContextPatch: NavContextMenuPatchCallback = (children, props: { user?: User; }) => {
    const user = props?.user;
    if (!user || user.id === UserStore.getCurrentUser()?.id) return;

    const running = purge.state === "running";
    const target = running ? (UserStore.getUser(purge.userId) ?? user) : user;
    const label = !running
        ? "Purge DMs"
        : purge.userId === user.id
            ? `Purge DMs - running (${purge.deleted})`
            : "Purge DMs - view running purge";

    children.push(
        <Menu.MenuGroup>
            <Menu.MenuItem
                id="vc-purgedms"
                label={label}
                color="danger"
                action={() => openPurgeModal(target)}
            />
        </Menu.MenuGroup>
    );
};

export default definePlugin({
    name: "PurgeDMs",
    description: "Right-click a user and delete every message you ever sent them. Runs in the background with a live feed you can reopen anytime.",
    authors: [Devs.x2b, { name: "zfrancesck1", id: 456195985404592149n }].filter(Boolean),
    tags: ["Chat", "Utility"],
    enabledByDefault: false,
    managedStyle,
    settings,
    contextMenus: {
        "user-context": userContextPatch
    },

    stop() {
        stopPurge();
        purge.state = "idle";
    }
});