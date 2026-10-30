/*
 * TrashCord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ModalRoot, ModalHeader, ModalContent, ModalFooter } from "@utils/modal"
import { React } from "@webpack/common"
import { Button } from "@components/Button";
import { Divider } from "@components/Divider";
import { Paragraph } from "@components/Paragraph";
import { Text } from "@components/Text";
import { showToast } from "@webpack/common"
import { REPO_URL, UPDATE_COMMAND } from "../utils/updateChecker"

interface RemoteVersionInfo {
    name: string
    version: string
    repo: string
    latestRelease: string
    setupUrl: string
    updateUrl: string
    uninstallUrl: string
    changelog?: string
}

interface UpdateModalProps {
    remoteInfo: RemoteVersionInfo
    /** Installed version — PLUGIN_VERSION constant passed by the checker */
    installedVersion: string
    onDismiss: () => void
    modalProps: any
}

export function UpdateModal({ remoteInfo, installedVersion, onDismiss, modalProps }: UpdateModalProps) {
    const [copied, setCopied] = React.useState(false)

    async function handleCopyCommand() {
        try {
            if (navigator.clipboard?.writeText) {
                await navigator.clipboard.writeText(UPDATE_COMMAND)
            } else {
                const ta = document.createElement("textarea")
                ta.value = UPDATE_COMMAND
                ta.style.position = "fixed"
                ta.style.opacity = "0"
                document.body.appendChild(ta)
                ta.select()
                document.execCommand("copy")
                ta.remove()
            }
            setCopied(true)
            setTimeout(() => setCopied(false), 3000)
            try {
                showToast({ text: "Update command copied. Paste it into PowerShell.", variant: "success" })
            } catch {}
        } catch {
            // Clipboard not available — ignore silently.
        }
    }

    function handleOpenGitHub() {
        window.open(REPO_URL, "_blank", "noopener,noreferrer")
    }

    return (
        <ModalRoot {...modalProps} size="small">
            <ModalHeader>
                <Text size="xl" weight="semibold">
                    MultiMessageCopy update available
                </Text>
            </ModalHeader>

            <ModalContent>
                <section style={{ marginTop: "12px" }}>
                    <Paragraph>
                        Installed: <strong>v{installedVersion}</strong>
                        {" "}&mdash;{" "}
                        Latest: <strong>v{remoteInfo.version}</strong>
                    </Paragraph>

                    {remoteInfo.changelog && (
                        <Paragraph style={{ marginTop: "8px", color: "var(--text-muted)" }}>
                            {remoteInfo.changelog}
                        </Paragraph>
                    )}

                    <Divider style={{ margin: "12px 0" }} />

                    <Paragraph style={{ color: "var(--text-muted)" }}>
                        Copy the command below, paste it into PowerShell, and run it.
                        The updater will replace plugin files and rebuild Vencord.
                        It will ask before restarting Discord — it will not do so automatically.
                    </Paragraph>

                    <Paragraph
                        style={{
                            marginTop: "10px",
                            fontFamily: "var(--font-code)",
                            fontSize: "11px",
                            background: "var(--background-secondary, #2b2d31)",
                            color: "var(--text-normal, #dbdee1)",
                            border: "1px solid var(--border-subtle, rgba(255,255,255,0.08))",
                            padding: "10px 12px",
                            borderRadius: "6px",
                            wordBreak: "break-all",
                            userSelect: "all",
                        }}
                    >
                        {UPDATE_COMMAND}
                    </Paragraph>
                </section>
            </ModalContent>

            <ModalFooter>
                <Button
                    variant={copied ? "positive" : "primary"}
                    onClick={handleCopyCommand}
                >
                    {copied ? "Copied!" : "Copy Update Command"}
                </Button>
                <Button
                    variant="link"
                    onClick={handleOpenGitHub}
                    style={{ marginLeft: "8px" }}
                >
                    Open GitHub
                </Button>
                <Button
                    variant="secondary"
                    onClick={onDismiss}
                    style={{ marginLeft: "auto" }}
                >
                    Dismiss
                </Button>
            </ModalFooter>
        </ModalRoot>
    )
}
