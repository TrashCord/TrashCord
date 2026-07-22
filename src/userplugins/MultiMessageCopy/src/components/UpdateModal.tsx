/**
 * UpdateModal.tsx
 *
 * JSX modal for the MultiMessageCopy update notification.
 * All update-check logic lives in src/utils/updateChecker.ts.
 */

import { ModalRoot, ModalHeader, ModalContent, ModalFooter } from "@utils/modal"
import { React } from "@webpack/common"
import { Button, Text, Forms, showToast, Toasts } from "@webpack/common"
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
                showToast("Update command copied. Paste it into PowerShell.", Toasts.Type.SUCCESS)
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
                <Text variant="heading-lg/semibold">
                    MultiMessageCopy update available
                </Text>
            </ModalHeader>

            <ModalContent>
                <Forms.FormSection style={{ marginTop: "12px" }}>
                    <Forms.FormText>
                        Installed: <strong>v{installedVersion}</strong>
                        {" "}&mdash;{" "}
                        Latest: <strong>v{remoteInfo.version}</strong>
                    </Forms.FormText>

                    {remoteInfo.changelog && (
                        <Forms.FormText style={{ marginTop: "8px", color: "var(--text-muted)" }}>
                            {remoteInfo.changelog}
                        </Forms.FormText>
                    )}

                    <Forms.FormDivider style={{ margin: "12px 0" }} />

                    <Forms.FormText style={{ color: "var(--text-muted)" }}>
                        Copy the command below, paste it into PowerShell, and run it.
                        The updater will replace plugin files and rebuild Vencord.
                        It will ask before restarting Discord — it will not do so automatically.
                    </Forms.FormText>

                    <Forms.FormText
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
                    </Forms.FormText>
                </Forms.FormSection>
            </ModalContent>

            <ModalFooter>
                <Button
                    color={copied ? Button.Colors.GREEN : Button.Colors.BRAND}
                    onClick={handleCopyCommand}
                >
                    {copied ? "Copied!" : "Copy Update Command"}
                </Button>
                <Button
                    color={Button.Colors.LINK}
                    look={Button.Looks.LINK}
                    onClick={handleOpenGitHub}
                    style={{ marginLeft: "8px" }}
                >
                    Open GitHub
                </Button>
                <Button
                    color={Button.Colors.PRIMARY}
                    look={Button.Looks.OUTLINED}
                    onClick={onDismiss}
                    style={{ marginLeft: "auto" }}
                >
                    Dismiss
                </Button>
            </ModalFooter>
        </ModalRoot>
    )
}
