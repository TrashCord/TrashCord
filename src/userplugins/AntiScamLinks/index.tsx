/*
 * TrashCord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { openModal, ModalRoot, ModalHeader, ModalContent, ModalFooter, ModalCloseButton } from "@utils/modal";
import definePlugin from "@utils/types";
import { Forms, Button, React } from "@webpack/common";

const SCAM_LIST_URL = "https://cdn.jsdelivr.net/gh/Discord-AntiScam/scam-links@main/list.txt";

let scamDomains: Set<string> = new Set();

async function fetchScamList(): Promise<void> {
    try {
        const res = await fetch(SCAM_LIST_URL);
        if (!res.ok) return;
        const text = await res.text();
        scamDomains = new Set(
            text.split("\n")
                .map(d => d.trim().toLowerCase())
                .filter(Boolean)
        );
    } catch {}
}

function ScamWarningModal({ url, onConfirm, onCancel, modalProps }: {
    url: string;
    onConfirm: () => void;
    onCancel: () => void;
    modalProps: any;
}) {
    return (
        <ModalRoot {...modalProps} size="small">
            <ModalHeader>
                <Forms.FormTitle tag="h2" style={{ color: "#ed4245", margin: 0 }}>
                    ⚠️ Scam Link Detected
                </Forms.FormTitle>
                <ModalCloseButton onClick={onCancel} />
            </ModalHeader>
            <ModalContent style={{ padding: "16px" }}>
                <Forms.FormText style={{ marginBottom: 8 }}>
                    This link is flagged as a <strong>scam or phishing site</strong>.
                </Forms.FormText>
                <Forms.FormText
                    style={{
                        wordBreak: "break-all",
                        background: "var(--background-secondary)",
                        padding: "8px",
                        borderRadius: 4,
                        color: "#ed4245",
                        marginBottom: 8,
                        fontFamily: "monospace",
                        fontSize: 13
                    }}
                >
                    {url}
                </Forms.FormText>
                <Forms.FormText>
                    Opening this site may compromise your account or steal your information.
                    Do you still want to proceed?
                </Forms.FormText>
            </ModalContent>
            <ModalFooter style={{ gap: 8 }}>
                <Button color={Button.Colors.PRIMARY} onClick={onCancel}>
                    Go Back (Safe)
                </Button>
                <Button color={Button.Colors.RED} onClick={onConfirm}>
                    Open Anyway
                </Button>
            </ModalFooter>
        </ModalRoot>
    );
}

function handleLinkClick(e: MouseEvent): void {
    if (scamDomains.size === 0) return;

    const anchor = (e.target as Element).closest?.("a[href]") as HTMLAnchorElement | null;
    if (!anchor) return;

    const host = anchor.hostname.toLowerCase();
    if (!scamDomains.has(host.startsWith("www.") ? host.slice(4) : host)) return;

    const href = anchor.href;

    e.preventDefault();
    e.stopImmediatePropagation();

    openModal(props =>
        React.createElement(ScamWarningModal, {
            url: href,
            onConfirm: () => {
                props.onClose();
                window.open(href, "_blank", "noopener,noreferrer");
            },
            onCancel: props.onClose,
            modalProps: props
        })
    );
}

export default definePlugin({
    name: "AntiScamLinks",
    description: "Warns you before opening scam links. List from https://github.com/Discord-AntiScam/scam-links, loaded at startup (restart to retry).",
    authors: [
        { name: "irritably", id: 928787166916640838n },
        { name: "zfrancesck1", id: 456195985404592149n },
    ],
    tags: ["Privacy", "Chat", "Security", "Adblock"],
    enabledByDefault: true,

    start() {
        void fetchScamList();
        document.addEventListener("click", handleLinkClick, true);
    },

    stop() {
        document.removeEventListener("click", handleLinkClick, true);
        scamDomains = new Set();
    }
});