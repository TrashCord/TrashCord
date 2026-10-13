/*
 * TaskbarStatus, a Vencord plugin
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { app, BrowserWindow, IpcMainInvokeEvent, ThumbarButton, WebContents } from "electron";
import { existsSync, mkdirSync, writeFileSync } from "fs";
import { basename, dirname, join, resolve } from "path";

import { statusIco, thumbIcon } from "./icons";
import { mergeButtons, Status, STATUS_ORDER } from "./merge";

const ARG_PREFIX = "--taskbar-status=";

const LABELS: Record<Status, string> = {
    online: "Online",
    idle: "Idle",
    dnd: "Do Not Disturb",
    invisible: "Invisible"
};

type SetThumbar = BrowserWindow["setThumbarButtons"];

let win: BrowserWindow | null = null;
let sender: WebContents | null = null;
let current: Status = "online";
let discordButtons: ThumbarButton[] = [];
let originalSetThumbar: SetThumbar | null = null;
let showTimer: ReturnType<typeof setTimeout> | undefined;

// Set when Discord was cold-started from a jump list task; handed to the renderer once.
let coldStartStatus: Status | null = parseStatus(process.argv);

function parseStatus(argv: string[]): Status | null {
    const value = argv.find(a => a.startsWith(ARG_PREFIX))?.slice(ARG_PREFIX.length);
    return STATUS_ORDER.find(s => s === value) ?? null;
}

function requestStatus(status: Status) {
    if (!sender || sender.isDestroyed()) return;
    sender
        .executeJavaScript(`Vencord.Plugins.plugins.TaskbarStatus.setStatus(${JSON.stringify(status)})`)
        .catch(() => { });
}

function statusButtons() {
    return Object.fromEntries(STATUS_ORDER.map(s => {
        const active = s === current;
        const button: ThumbarButton = {
            icon: thumbIcon(s, active),
            tooltip: active ? `${LABELS[s]} (current)` : LABELS[s],
            flags: active ? ["noninteractive"] : [],
            click: () => requestStatus(s)
        };
        return [s, button];
    })) as Record<Status, ThumbarButton>;
}

function refreshThumbar() {
    if (!win || win.isDestroyed() || !originalSetThumbar) return;
    originalSetThumbar.call(win, mergeButtons(discordButtons, statusButtons(), current));
}

function patchSetThumbar() {
    if (originalSetThumbar) return;
    originalSetThumbar = BrowserWindow.prototype.setThumbarButtons;
    const original = originalSetThumbar;

    BrowserWindow.prototype.setThumbarButtons = function (buttons) {
        if (this !== win) return original.call(this, buttons);
        discordButtons = buttons;
        return original.call(this, mergeButtons(buttons, statusButtons(), current));
    };
}

function setJumpList() {
    // Update.exe survives Discord updates; process.execPath points into a versioned app-x.y.z folder that doesn't.
    const updateExe = resolve(dirname(process.execPath), "..", "Update.exe");
    const exeName = basename(process.execPath);
    const iconDir = join(app.getPath("userData"), "taskbarStatus");
    mkdirSync(iconDir, { recursive: true });

    const viaSquirrel = existsSync(updateExe);

    app.setUserTasks(STATUS_ORDER.map(s => {
        const iconPath = join(iconDir, `${s}.ico`);
        writeFileSync(iconPath, statusIco(s));

        return {
            program: viaSquirrel ? updateExe : process.execPath,
            arguments: viaSquirrel
                ? `--processStart "${exeName}" --process-start-args "${ARG_PREFIX}${s}"`
                : `${ARG_PREFIX}${s}`,
            iconPath,
            iconIndex: 0,
            title: LABELS[s],
            description: `Set Discord status to ${LABELS[s]}`
        };
    }));
}

// Hiding to tray destroys the taskbar button; Windows drops its thumbnail buttons with it.
function onShow() {
    clearTimeout(showTimer);
    showTimer = setTimeout(refreshThumbar, 300);
}

// Runs before Discord's own handler (prependListener), which may raise the window.
function onSecondInstance(_event: unknown, argv: string[]) {
    const status = parseStatus(argv);
    if (!status || !win || win.isDestroyed()) return;

    const wasMinimized = win.isMinimized();
    const wasVisible = win.isVisible();
    requestStatus(status);

    setTimeout(() => {
        if (!win || win.isDestroyed()) return;
        if (wasMinimized && !win.isMinimized()) win.minimize();
        else if (!wasVisible && win.isVisible()) win.hide();
    }, 100);
}

export function start(event: IpcMainInvokeEvent, status: Status): Status | null {
    if (process.platform !== "win32") return null;

    sender = event.sender;
    win = BrowserWindow.fromWebContents(sender);
    current = status;

    patchSetThumbar();
    win?.removeListener("show", onShow);
    win?.on("show", onShow);
    app.removeListener("second-instance", onSecondInstance);
    app.prependListener("second-instance", onSecondInstance);
    try {
        setJumpList();
    } catch (e) {
        console.error("[TaskbarStatus] failed to set jump list", e);
    }
    refreshThumbar();

    const pending = coldStartStatus;
    coldStartStatus = null;
    return pending;
}

export function update(_event: IpcMainInvokeEvent, status: Status) {
    current = status;
    refreshThumbar();
}

export function stop(_event: IpcMainInvokeEvent) {
    if (originalSetThumbar) {
        BrowserWindow.prototype.setThumbarButtons = originalSetThumbar;
        if (win && !win.isDestroyed()) originalSetThumbar.call(win, discordButtons);
    }
    clearTimeout(showTimer);
    win?.removeListener("show", onShow);
    app.removeListener("second-instance", onSecondInstance);
    if (process.platform === "win32") app.setUserTasks([]);

    originalSetThumbar = null;
    win = null;
    sender = null;
    discordButtons = [];
}
