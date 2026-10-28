/*
 * TrashCord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { saveFile } from "@utils/web";

import { DownloadItemState, DownloadProgressState, MediaItem } from "./types";

export type ProgressCallback = (state: DownloadProgressState) => void;

export class DownloadManager {
    private queue: MediaItem[] = [];
    private itemStates = new Map<string, DownloadItemState>();
    private activeCount = 0;
    private maxConcurrency: number;
    private abortController: AbortController | null = null;
    private isRunning = false;
    private isCancelled = false;
    private progressCallback?: ProgressCallback;

    constructor(concurrency = 3) {
        this.maxConcurrency = Math.max(1, Math.min(concurrency, 5));
    }

    public setConcurrency(concurrency: number) {
        this.maxConcurrency = Math.max(1, Math.min(concurrency, 5));
    }

    public onProgress(cb: ProgressCallback) {
        this.progressCallback = cb;
    }

    public start(items: MediaItem[]) {
        this.isCancelled = false;
        this.abortController = new AbortController();
        this.isRunning = true;
        this.queue = [...items];

        this.itemStates.clear();
        for (const item of items) {
            this.itemStates.set(item.id, {
                item,
                status: "pending"
            });
        }

        this.notify();
        this.processNext();
    }

    public cancel() {
        this.isCancelled = true;
        this.isRunning = false;
        if (this.abortController) {
            this.abortController.abort();
            this.abortController = null;
        }

        for (const item of this.queue) {
            const state = this.itemStates.get(item.id);
            if (state && state.status === "pending") {
                state.status = "cancelled";
            }
        }
        this.queue = [];
        this.notify();
    }

    public retryFailed() {
        if (this.isRunning) return;

        const failedItems: MediaItem[] = [];
        for (const state of this.itemStates.values()) {
            if (state.status === "failed" || state.status === "cancelled") {
                state.status = "pending";
                delete state.error;
                failedItems.push(state.item);
            }
        }

        if (failedItems.length > 0) {
            this.isCancelled = false;
            this.abortController = new AbortController();
            this.isRunning = true;
            this.queue = failedItems;
            this.notify();
            this.processNext();
        }
    }

    private processNext() {
        if (this.isCancelled || !this.isRunning) return;

        while (this.activeCount < this.maxConcurrency && this.queue.length > 0) {
            const nextItem = this.queue.shift();
            if (!nextItem) break;

            this.activeCount++;
            this.downloadItem(nextItem).finally(() => {
                this.activeCount--;
                if (this.queue.length === 0 && this.activeCount === 0) {
                    this.isRunning = false;
                }
                this.notify();
                if (!this.isCancelled && this.isRunning) {
                    this.processNext();
                }
            });
        }
    }

    private async downloadItem(item: MediaItem): Promise<void> {
        const state = this.itemStates.get(item.id);
        if (!state) return;

        state.status = "downloading";
        this.notify(item.filename);

        const signal = this.abortController?.signal;

        try {
            // Attempt 1: fetch blob directly and saveFile
            const res = await fetch(item.url, { signal });
            if (!res.ok) {
                throw new Error(`HTTP ${res.status}`);
            }

            const blob = await res.blob();
            if (signal?.aborted) {
                state.status = "cancelled";
                return;
            }

            const file = new File([blob], item.filename, {
                type: blob.type || item.contentType || "application/octet-stream"
            });

            saveFile(file);
            state.status = "success";
        } catch (err: any) {
            if (signal?.aborted || this.isCancelled) {
                state.status = "cancelled";
                return;
            }

            // Attempt 2: Fallback for CORS-blocked external embeds
            try {
                const a = document.createElement("a");
                a.href = item.url;
                a.download = item.filename;
                a.target = "_blank";
                a.rel = "noopener noreferrer";
                document.body.appendChild(a);
                a.click();
                setTimeout(() => {
                    try {
                        document.body.removeChild(a);
                    } catch {
                        // ignore
                    }
                }, 1000);
                state.status = "requested";
                state.error = "Browser download requested; final save location is controlled by the browser.";
            } catch (fallbackErr: any) {
                state.status = "failed";
                state.error = err?.message || "Download failed";
            }
        }
    }

    private notify(currentFilename?: string) {
        if (!this.progressCallback) return;

        const all = Array.from(this.itemStates.values());
        const total = all.length;
        const completed = all.filter(s => s.status === "success").length;
        const failed = all.filter(s => s.status === "failed").length;
        const cancelled = all.filter(s => s.status === "cancelled").length;
        const requested = all.filter(s => s.status === "requested").length;
        const processed = completed + failed + cancelled + requested;

        this.progressCallback({
            total,
            completed,
            failed,
            cancelled,
            requested,
            processed,
            currentFilename,
            currentPercent: total > 0 ? Math.round((processed / total) * 100) : 0,
            inProgress: this.isRunning,
            isCancelled: this.isCancelled,
            items: all
        });
    }

    public getStatus(): DownloadProgressState {
        const all = Array.from(this.itemStates.values());
        const total = all.length;
        const completed = all.filter(s => s.status === "success").length;
        const failed = all.filter(s => s.status === "failed").length;
        const cancelled = all.filter(s => s.status === "cancelled").length;
        const requested = all.filter(s => s.status === "requested").length;
        const processed = completed + failed + cancelled + requested;

        return {
            total,
            completed,
            failed,
            cancelled,
            requested,
            processed,
            currentPercent: total > 0 ? Math.round((processed / total) * 100) : 0,
            inProgress: this.isRunning,
            isCancelled: this.isCancelled,
            items: all
        };
    }
}
