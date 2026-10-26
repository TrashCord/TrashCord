/*
 * TrashCord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { showToast } from "@webpack/common";

let toastCounter = 0;

export default class ProgressDisplay {
    private message = "";
    private toastId: string;
    private dots = 0;
    private timer: ReturnType<typeof setInterval> | null = null;

    constructor(message: string) {
        this.toastId = `gif-captioner-progress-${Date.now()}-${toastCounter++}`;
        this.setLoading(message);
    }

    private show(message: string) {
        showToast({ text: message });
    }

    private formatLoading() {
        return `${this.message}${".".repeat(this.dots)}`;
    }

    private startDots() {
        if (this.timer) return;
        this.dots = 0;
        this.show(this.formatLoading());
    }

    private stopDots() {
        if (!this.timer) return;
        clearInterval(this.timer);
        this.timer = null;
        this.dots = 0;
    }

    setLoading(message: string) {
        this.message = message;
        this.startDots();
    }

    setStatus(message: string) {
        this.message = message;
        this.stopDots();
        this.show(message);
    }

    close() {
        this.stopDots();
    }
}