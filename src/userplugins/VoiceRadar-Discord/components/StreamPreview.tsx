/*
 * TrashCord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { openImageModal } from "@utils/discord";
import { useEffect, useState } from "@webpack/common";

import { T } from "../i18n";
import { getStreamFor, getStreamPreviewUrl, type StreamRef } from "../streams";
import { toast, ToastVariant } from "../toast";
import { cl } from "./common";
import { Hint } from "./Hint";
import { StreamIcon } from "./icons";

function StreamPreviewCard({ stream, name }: { stream: StreamRef; name: string; }) {
    const [url, setUrl] = useState<string | null>(null);
    const [failed, setFailed] = useState(false);

    useEffect(() => {
        let cancelled = false;

        setUrl(null);
        setFailed(false);

        void getStreamPreviewUrl(stream).then(preview => {
            if (cancelled) return;
            if (preview) setUrl(preview);
            else setFailed(true);
        });

        return () => {
            cancelled = true;
        };
    }, [stream.channelId, stream.ownerId]);

    return (
        <div className={cl("stream-tooltip")}>
            <div className={cl("stream-tooltip-title")}>{T.streamingBy(name)}</div>

            {url && <img className={cl("stream-preview")} src={url} alt={T.streamPreviewAlt} />}
            {!url && !failed && <div className={cl("stream-placeholder")}>{T.streamPreviewLoading}</div>}
            {failed && <div className={cl("stream-placeholder")}>{T.streamPreviewMissing}</div>}

            <div className={cl("stream-tooltip-hint")}>{T.streamPreviewHint}</div>
        </div>
    );
}

export function StreamIndicator({ userId, name }: { userId: string; name: string; }) {
    const stream = getStreamFor(userId);
    if (!stream) return null;

    const openBigPreview = async () => {
        try {
            const url = await getStreamPreviewUrl(stream);

            if (!url) {
                toast(T.streamPreviewMissingFor(name), ToastVariant.FAILURE);
                return;
            }

            openImageModal({ url, height: 720, width: 1280 });
        } catch (error) {
            console.warn("[VoiceRadar-Discord] could not open the stream preview:", error);
            toast(T.streamPreviewMissingFor(name), ToastVariant.FAILURE);
        }
    };

    return (
        <Hint text={<StreamPreviewCard stream={stream} name={name} />}>
            {hintProps => (
                <span
                    {...hintProps}
                    className={cl("stream-badge")}
                    role="button"
                    onClick={event => {
                        event.stopPropagation();
                        void openBigPreview();
                    }}
                >
                    <StreamIcon size={14} />
                    {T.badgeLive}
                </span>
            )}
        </Hint>
    );
}
