/*
 * TrashCord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Button } from "@components/Button";
import { HeadingSecondary } from "@components/Heading";
import { Paragraph } from "@components/Paragraph";

import { DownloadProgressState } from "../types";

interface DownloadProgressProps {
    progress: DownloadProgressState;
    onCancel: () => void;
    onRetry: () => void;
    onClose: () => void;
}

export function DownloadProgress({
    progress,
    onCancel,
    onRetry,
    onClose
}: DownloadProgressProps) {
    const isDone = !progress.inProgress;
    const { isCancelled } = progress;

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 14, padding: "12px 0" }}>
            <HeadingSecondary>
                {progress.inProgress
                    ? "Downloading Selected Media..."
                    : isCancelled
                        ? "Download Cancelled"
                        : progress.failed > 0
                            ? "Download Finished with Errors"
                            : progress.requested > 0
                                ? "Download Requested"
                            : "Download Complete"}
            </HeadingSecondary>

            <div className="vc-mg-progress-bar-wrap">
                <div
                    className="vc-mg-progress-bar-fill"
                    style={{ width: `${progress.currentPercent || 0}%` }}
                />
            </div>

            <Paragraph>
                {progress.inProgress
                    ? `Processing ${progress.processed} of ${progress.total}...`
                    : `${progress.completed} files downloaded successfully.`}
                {progress.failed > 0 && ` ${progress.failed} failed.`}
                {progress.cancelled > 0 && ` ${progress.cancelled} cancelled.`}
                {progress.requested > 0 && ` ${progress.requested} browser downloads requested.`}
            </Paragraph>

            {progress.currentFilename && progress.inProgress && (
                <div style={{ fontSize: 12, color: "var(--text-muted)", wordBreak: "break-all" }}>
                    Current: <strong>{progress.currentFilename}</strong>
                </div>
            )}

            {isDone && progress.failed > 0 && (
                <div style={{ maxHeight: 120, overflowY: "auto", background: "var(--background-secondary)", padding: 8, borderRadius: 6 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: "var(--status-danger, #ed4245)", marginBottom: 4 }}>
                        Failed Items:
                    </div>
                    {progress.items
                        .filter(i => i.status === "failed")
                        .map(i => (
                            <div key={i.item.id} style={{ fontSize: 11, color: "var(--text-muted)" }}>
                                • {i.item.filename} {i.error ? `(${i.error})` : ""}
                            </div>
                        ))}
                </div>
            )}

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
                {progress.inProgress ? (
                    <Button variant="dangerPrimary" onClick={onCancel}>
                        Cancel Download
                    </Button>
                ) : (
                    <>
                        {progress.failed > 0 && (
                            <Button variant="secondary" onClick={onRetry}>
                                Retry Failed ({progress.failed})
                            </Button>
                        )}
                        <Button variant="primary" onClick={onClose}>
                            Done
                        </Button>
                    </>
                )}
            </div>
        </div>
    );
}
