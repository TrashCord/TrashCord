/*
 * TrashCord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import ErrorBoundary from "@components/ErrorBoundary";
import type { RenderModalProps } from "@vencord/discord-types";
import { closeModal, Modal, openModal } from "@webpack/common";
import type { ReactNode } from "react";

import { T } from "../i18n";
import { toast, ToastVariant } from "../toast";
import { cl } from "./common";
import { CloseIcon } from "./icons";
import { openOverlay, type Overlay, type OverlaySize } from "./Overlay";
import { focusedPopoutDocument } from "./RadarPopout";

interface OpenWindow {
    overlay: Overlay | null;
    modalKey: string | null;
}

const open = new Map<string, OpenWindow>();

export interface WindowOptions {
    label: string;
    size: OverlaySize;
    render: (close: () => void, embedded: boolean) => ReactNode;
    keysTaken?: () => boolean;
    onCrash?: () => void;
}

export function isWindowOpen(name: string): boolean {
    return open.has(name);
}

export function closeWindow(name: string, { animate = false } = {}) {
    const entry = open.get(name);
    if (!entry) return;
    open.delete(name);

    if (entry.overlay) {
        if (animate) entry.overlay.close();
        else entry.overlay.destroy();
    }
    if (entry.modalKey) closeModal(entry.modalKey);
}

export function closeAllWindows() {
    for (const name of [...open.keys()]) closeWindow(name, { animate: true });
}

export function openWindow(name: string, options: WindowOptions): boolean {
    closeWindow(name);

    const entry: OpenWindow = { overlay: null, modalKey: null };
    open.set(name, entry);

    const forget = () => {
        if (open.get(name) === entry) open.delete(name);
    };

    const crashed = () => {
        options.onCrash?.();
        toast(T.windowCrashed, ToastVariant.FAILURE);
        // Not from inside React's error handling, which is still unmounting the tree.
        setTimeout(() => {
            if (open.get(name) === entry) closeWindow(name);
        }, 0);
    };

    const guarded = (content: ReactNode) => <ErrorBoundary noop onError={crashed}>{content}</ErrorBoundary>;

    try {
        entry.overlay = openOverlay({
            label: options.label,
            size: options.size,
            placeKey: name,
            // Over the popped out radar when it is where you clicked, so Discord's own window stays put.
            own: focusedPopoutDocument() ?? document,
            keysTaken: options.keysTaken,
            render: close => guarded(options.render(close, false)),
            onClosed: forget
        });
        return true;
    } catch (error) {
        console.warn(`[VoiceRadar-Discord] "${options.label}" could not be drawn on its own, opening a Discord modal instead:`, error);
    }

    try {
        entry.modalKey = `voice-radar-${name}`;
        openModal(
            (modalProps: RenderModalProps) => (
                <Modal {...modalProps} size={options.size} title={options.label}>
                    <div className={cl("window") + " " + cl("window-embedded") + " " + cl("window-" + options.size)}>
                        {guarded(options.render(modalProps.onClose, true))}
                    </div>
                </Modal>
            ),
            { modalKey: entry.modalKey, onCloseCallback: forget }
        );
        return true;
    } catch (error) {
        forget();
        console.error(`[VoiceRadar-Discord] "${options.label}" could not be opened at all:`, error);
        return false;
    }
}

export function WindowHead({ leading, title, subtitle, trailing, embedded, onClose }: {
    leading?: ReactNode;
    title: ReactNode;
    subtitle?: ReactNode;
    trailing?: ReactNode;
    embedded: boolean;
    onClose: () => void;
}) {
    return (
        <header className={cl("head") + (embedded ? " " + cl("head-embedded") : "")}>
            {leading}
            <div className={cl("head-text")}>
                <div className={cl("head-title")}>{title}</div>
                {subtitle && <div className={cl("head-line")}>{subtitle}</div>}
            </div>
            {trailing}
            {!embedded && <CloseButton onClose={onClose} />}
        </header>
    );
}

export function CloseButton({ onClose }: { onClose: () => void; }) {
    return (
        <button className={cl("close")} onClick={onClose} aria-label={T.closeWindow}>
            <CloseIcon />
        </button>
    );
}
