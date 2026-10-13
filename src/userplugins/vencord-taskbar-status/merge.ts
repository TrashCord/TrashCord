/*
 * TaskbarStatus, a Vencord plugin
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export type Status = "online" | "idle" | "dnd" | "invisible";

export const STATUS_ORDER: readonly Status[] = ["online", "idle", "dnd", "invisible"];

// Windows' taskbar thumbnail toolbar holds at most 7 buttons.
export const MAX_THUMBAR_BUTTONS = 7;

/**
 * Combine Discord's own thumbar buttons (mute/deafen/video/disconnect while in a call, none otherwise)
 * with our four status buttons into the single list handed to `BrowserWindow.setThumbarButtons`.
 *
 * Rules (see tests in merge.test.ts):
 *  - Discord's buttons come first, then the status buttons in STATUS_ORDER.
 *  - Status buttons keep fixed positions, current status included, so muscle memory works.
 *  - Only when the combined list would exceed MAX_THUMBAR_BUTTONS, drop the button for
 *    `current` (clicking it does nothing anyway).
 *  - Never return more than MAX_THUMBAR_BUTTONS, or Windows rejects the whole list.
 */
export function mergeButtons<B>(discordButtons: B[], statusButtons: Record<Status, B>, current: Status): B[] {
    const statuses = STATUS_ORDER.map(s => ({ s, button: statusButtons[s] }));
    const overCap = discordButtons.length + statuses.length > MAX_THUMBAR_BUTTONS;

    return [
        ...discordButtons,
        ...statuses.filter(({ s }) => !overCap || s !== current).map(({ button }) => button)
    ].slice(0, MAX_THUMBAR_BUTTONS);
}
