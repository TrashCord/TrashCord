/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ModalCloseButton, ModalContent, ModalHeader, ModalRoot, ModalSize, openModal } from "@utils/modal";
import { Text, useEffect, useState } from "@webpack/common";

import { hasId, toggleId } from "./allowlist";
import { HtmlFrame } from "./HtmlFrame";
import { hasUntrustedRefs } from "./detect";
import { TRUSTED_CDNS } from "./harden";
import { CollapseIcon, DownloadIcon, ExpandIcon, RenderIcon, ServerIcon, UserIcon } from "./Icons";
import { settings } from "./settings";
import { dropCached, useArtifactHtml } from "./useArtifact";

interface Attachment {
    id: string;
    url: string;
    filename: string;
    size: number;
    content_type?: string;
}

function formatBytes(n: number): string {
    if (typeof n !== "number") return "";
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
    return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

// The CDN serves .html with Content-Disposition: attachment, so opening the URL
// downloads the file. That is exactly what the Download button wants; under
// Legcord openExternal is shimmed to window.open -> the system browser.
function downloadFile(url: string) {
    VencordNative.native.openExternal(url);
}

// Full-fidelity render: unhardened sandboxed iframe -> CDN assets load. Still
// opaque-origin sandboxed, so it cannot touch Discord.
function openFullView(filename: string, html: string) {
    openModal(props => (
        <ModalRoot {...props} size={ModalSize.LARGE} className="vc-hv-modal">
            <ModalHeader className="vc-hv-modal-head">
                <Text className="vc-hv-modal-title">{filename}</Text>
                <span className="vc-hv-modal-sub">full render · CDN assets, no fetch</span>
                <ModalCloseButton onClick={props.onClose} />
            </ModalHeader>
            <ModalContent className="vc-hv-modal-content">
                <HtmlFrame html={html} mode="full" className="vc-hv-frame vc-hv-frame-modal" />
            </ModalContent>
        </ModalRoot>
    ));
}

function ArtifactRender({ attachment, onRetry }: { attachment: Attachment; onRetry: () => void; }) {
    const { loading, html, error } = useArtifactHtml(attachment.id, attachment.url, true);

    if (loading) return <div className="vc-hv-note">Rendering...</div>;

    if (error) {
        return (
            <div className="vc-hv-note vc-hv-error">
                Couldn't load artifact: {error}.{" "}
                <button className="vc-hv-link" onClick={onRetry}>Retry</button>
                {" · "}
                <button className="vc-hv-link" onClick={() => downloadFile(attachment.url)}>Download</button>
            </div>
        );
    }

    if (!html) return null;

    return (
        <>
            {hasUntrustedRefs(html, TRUSTED_CDNS) && (
                <div className="vc-hv-note vc-hv-hint">
                    References assets outside the trusted CDNs, which the inline preview blocks. Use Full view to load them.
                </div>
            )}
            <HtmlFrame html={html} className="vc-hv-frame vc-hv-frame-inline" />
        </>
    );
}

// Full view needs the bytes; when opened from the collapsed card (before Render)
// we fetch on demand, then open the modal.
function FullViewButton({ attachment, className }: { attachment: Attachment; className?: string; }) {
    const [want, setWant] = useState(false);
    const { html, loading, error } = useArtifactHtml(attachment.id, attachment.url, want);

    useEffect(() => {
        if (want && html) {
            openFullView(attachment.filename, html);
            setWant(false);
        }
    }, [want, html]);

    if (error) {
        return (
            <button className={className} onClick={() => downloadFile(attachment.url)}>
                <DownloadIcon /> Download
            </button>
        );
    }
    return (
        <button className={className} disabled={want && loading} onClick={() => setWant(true)}>
            <ExpandIcon /> {want && loading ? "Loading..." : "Full view"}
        </button>
    );
}

export function HtmlCard({ attachment, authorId, guildId }: { attachment: Attachment; authorId?: string; guildId?: string; }) {
    const tooBig = attachment.size > settings.store.maxSizeKb * 1024;

    const autoRender =
        settings.store.autoRenderAll ||
        hasId(settings.store.autoRenderUsers, authorId) ||
        (!!guildId && hasId(settings.store.autoRenderServers, guildId));

    const [open, setOpen] = useState(autoRender && !tooBig);
    const [attempt, setAttempt] = useState(0);
    const [, forceUpdate] = useState(0);

    const userAuto = hasId(settings.store.autoRenderUsers, authorId);
    const serverAuto = !!guildId && hasId(settings.store.autoRenderServers, guildId);

    // Toggling ON also renders the current card; the setting drives future ones.
    const toggleUser = () => {
        if (!authorId) return;
        const turningOn = !userAuto;
        settings.store.autoRenderUsers = toggleId(settings.store.autoRenderUsers, authorId);
        if (turningOn && !tooBig) setOpen(true);
        forceUpdate(n => n + 1);
    };
    const toggleServer = () => {
        if (!guildId) return;
        const turningOn = !serverAuto;
        settings.store.autoRenderServers = toggleId(settings.store.autoRenderServers, guildId);
        if (turningOn && !tooBig) setOpen(true);
        forceUpdate(n => n + 1);
    };

    return (
        <div className="vc-hv-card">
            <div className="vc-hv-head">
                <span
                    className="vc-hv-lock"
                    title="Inline preview is sandboxed and offline. Full view enables network; neither can touch Discord."
                >
                    {"🔒"}
                </span>
                <span className="vc-hv-name">{attachment.filename}</span>
                <span className="vc-hv-size">{formatBytes(attachment.size)}</span>
                <span className="vc-hv-spacer" />
                {authorId && (
                    <button
                        className={"vc-hv-toggle" + (userAuto ? " vc-hv-toggle-on" : "")}
                        title={userAuto ? "Auto-rendering this user's HTML — click to stop" : "Always render this user's HTML"}
                        onClick={toggleUser}
                    >
                        <UserIcon />
                    </button>
                )}
                {guildId && (
                    <button
                        className={"vc-hv-toggle" + (serverAuto ? " vc-hv-toggle-on" : "")}
                        title={serverAuto ? "Auto-rendering this server's HTML — click to stop" : "Always render HTML in this server"}
                        onClick={toggleServer}
                    >
                        <ServerIcon />
                    </button>
                )}
                {!open && !tooBig && (
                    <button className="vc-hv-btn vc-hv-btn-primary" onClick={() => setOpen(true)}>
                        <RenderIcon /> Render
                    </button>
                )}
                {open && (
                    <button className="vc-hv-btn" onClick={() => setOpen(false)}>
                        <CollapseIcon /> Collapse
                    </button>
                )}
                <FullViewButton attachment={attachment} className="vc-hv-btn" />
                <button className="vc-hv-btn" onClick={() => downloadFile(attachment.url)}>
                    <DownloadIcon /> Download
                </button>
            </div>

            {tooBig && !open && (
                <div className="vc-hv-note">
                    {formatBytes(attachment.size)} exceeds the {settings.store.maxSizeKb} KB inline limit. Use Full view or Download.
                </div>
            )}

            {open && (
                <ArtifactRender
                    key={attempt}
                    attachment={attachment}
                    onRetry={() => { dropCached(attachment.id); setAttempt(a => a + 1); }}
                />
            )}
        </div>
    );
}
