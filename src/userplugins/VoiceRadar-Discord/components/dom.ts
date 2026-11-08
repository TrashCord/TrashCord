/*
 * TrashCord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// The popped out radar lives in another window, whose elements fail instanceof checks against this one.

export function asElement(value: unknown): Element | null {
    return value != null && typeof (value as Element).closest === "function" ? value as Element : null;
}

/** How much the plugin's size enlarges an element, which pointer and page positions leave out. */
export function zoomOf(element: Element): number {
    return element.currentCSSZoom ?? 1;
}

export function takesText(element: Element | null): boolean {
    const tag = element?.tagName;
    return tag === "INPUT" || tag === "TEXTAREA" || (element as HTMLElement | null)?.isContentEditable === true;
}
