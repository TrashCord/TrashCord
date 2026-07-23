/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ApplicationCommandInputType, ApplicationCommandOptionType, Argument, CommandContext, sendBotMessage } from "@api/Commands";
import { NavContextMenuPatchCallback } from "@api/ContextMenu";
import { definePluginSettings } from "@api/Settings";
import { PlusIcon } from "@components/Icons";
import { Devs } from "@utils/constants";
import { insertTextIntoChatInputBox, sendMessage } from "@utils/discord";
import definePlugin, { OptionType, PluginNative } from "@utils/types";
import { findByPropsLazy } from "@webpack";
import { DraftType, Menu, PermissionsBits, PermissionStore, SelectedChannelStore, showToast, Toasts, UploadManager } from "@webpack/common";

const Native = VencordNative.pluginHelpers.StreamableUpload as PluginNative<typeof import("./native")>;

const UploadStore = findByPropsLazy("getUploads");
const DraftManager = findByPropsLazy("clearDraft", "saveDraft");
let hasWarnedNoSecureStorage = false;

const settings = definePluginSettings({
    autoSend: {
        type: OptionType.SELECT,
        options: [
            { label: "Yes", value: "Yes" },
            { label: "No", value: "No", default: true },
        ],
        description: "Automatically send uploaded Streamable links to chat",
        hidden: false
    },
    streamableEmail: {
        type: OptionType.STRING,
        default: "",
        displayName: "Streamable Email",
        description: "Your Streamable account email",
        placeholder: "name@example.com",
        hidden: false
    },
    streamablePassword: {
        type: OptionType.STRING,
        default: "",
        displayName: "Streamable Password",
        description: "Masked input. Saved securely when OS encryption is available.",
        placeholder: "Enter password",
        componentProps: { type: "password" },
        hidden: false
    },
    clearCredentialsOnDisable: {
        type: OptionType.BOOLEAN,
        default: false,
        displayName: "Clear Credentials On Disable",
        description: "If enabled, turning this plugin off clears saved Streamable credentials.",
        hidden: false
    },
    streamablePasswordEncrypted: {
        type: OptionType.STRING,
        default: "",
        description: "Encrypted Streamable password",
        hidden: true
    },
});

function sendTextToChat(text: string) {
    if (settings.store.autoSend === "No") {
        insertTextIntoChatInputBox(text);
    } else {
        const channelId = SelectedChannelStore.getChannelId();
        sendMessage(channelId, { content: text });
    }
}

function formatFileSize(bytes: number): string {
    const mb = bytes / (1024 * 1024);
    return `${mb.toFixed(1)} MB`;
}

const UPLOAD_STILL_RUNNING_MS = 15000;
const UPLOAD_TIMEOUT_MS = 600000;
const MAX_UPLOAD_SIZE_BYTES = 250 * 1024 * 1024;
const FILE_UPLOAD_FAILED_TOAST = "File Upload Failed";
const GENERIC_UPLOAD_FAILURE_MESSAGE = "**Unable to upload file to Streamable.** Check credentials and console for more info.";

function clearUploadDrafts(channelId: string) {
    UploadManager.clearAll(channelId, DraftType.SlashCommand);
    UploadManager.clearAll(channelId, DraftType.ChannelMessage);
}

function clearTextDrafts(channelId: string) {
    try {
        DraftManager.clearDraft(channelId, DraftType.SlashCommand);
    } catch { }

    try {
        DraftManager.clearDraft(channelId, DraftType.ChannelMessage);
    } catch { }
}

function notifyUploadLimitExceeded(file: File, channelId: string) {
    const maxSize = formatFileSize(MAX_UPLOAD_SIZE_BYTES);
    const actualSize = formatFileSize(file.size);

    showToast(`Upload blocked: Free Streamable accounts are limited to ${maxSize}. ${file.name} is ${actualSize}.`, Toasts.Type.FAILURE);
    sendBotMessage(channelId, {
        content: `**Upload blocked.** Free Streamable accounts are limited to ${maxSize}. ${file.name} is ${actualSize}, so it cannot be uploaded.`
    });
    clearUploadDrafts(channelId);
}

function failUpload(channelId: string, message: string = GENERIC_UPLOAD_FAILURE_MESSAGE) {
    showToast(FILE_UPLOAD_FAILED_TOAST, Toasts.Type.FAILURE);
    sendBotMessage(channelId, { content: message });
    clearUploadDrafts(channelId);
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    let timeoutHandle: ReturnType<typeof setTimeout>;

    const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutHandle = setTimeout(() => reject(new Error("UPLOAD_TIMEOUT")), ms);
    });

    try {
        return await Promise.race([promise, timeoutPromise]);
    } finally {
        clearTimeout(timeoutHandle!);
    }
}

async function resolveFile(options: Argument[], ctx: CommandContext): Promise<File | null> {
    for (const opt of options) {
        if (opt.name === "file") {
            const upload = UploadStore.getUpload(ctx.channel.id, opt.name, DraftType.SlashCommand);
            return upload?.item?.file ?? null;
        }
    }
    return null;
}

async function getSecurePassword(): Promise<string | null> {
    const plaintext = (settings.store.streamablePassword || "").trim();
    const encrypted = (settings.store.streamablePasswordEncrypted || "").trim();

    // Always trust the current settings field first so edited passwords take effect immediately.
    if (plaintext) {
        try {
            const encryptedSecret = await Native.encryptSecretNative(plaintext) as string;
            if (encryptedSecret !== settings.store.streamablePasswordEncrypted) {
                settings.store.streamablePasswordEncrypted = encryptedSecret;
            }
        } catch (error) {
            if (!hasWarnedNoSecureStorage) {
                hasWarnedNoSecureStorage = true;
                console.warn("Secure storage unavailable; password remains in local settings.", error);
            }
        }

        return plaintext;
    }

    if (encrypted) {
        try {
            const decrypted = await Native.decryptSecretNative(encrypted) as string;
            if (decrypted?.trim()) return decrypted.trim();
        } catch (error) {
            console.warn("Encrypted password could not be decrypted, falling back to plaintext if available.", error);
        }
    }

    return null;
}

async function ensureStreamableCredentials(channelId: string): Promise<{ email: string; password: string; } | null> {
    const existingEmail = (settings.store.streamableEmail || "").trim();
    const existingPassword = await getSecurePassword();

    if (existingEmail && existingPassword) {
        return { email: existingEmail, password: existingPassword };
    }

    showToast("Set Streamable credentials in plugin settings first", Toasts.Type.FAILURE);
    sendBotMessage(channelId, {
        content: "**Credentials required.** Open StreamableUpload settings and enter your Streamable email/password before uploading."
    });
    return null;
}

async function uploadFileToStreamable(file: File, channelId: string): Promise<boolean> {
    try {
        const credentials = await ensureStreamableCredentials(channelId);
        if (!credentials) {
            clearUploadDrafts(channelId);
            return false;
        }

        const { email, password } = credentials;

        const arrayBuffer = await file.arrayBuffer();
        const uploadResult = await Native.uploadFileToStreamableNative(arrayBuffer, file.name, file.type, email, password) as any;
        const shortcode = uploadResult?.shortcode || uploadResult?.data?.shortcode;

        if (shortcode) {
            const finalUrl = `https://streamable.com/${shortcode}`;
            setTimeout(() => sendTextToChat(finalUrl), 10);
            showToast("File processed and ready!", Toasts.Type.SUCCESS);
            clearUploadDrafts(channelId);
            return true;
        } else {
            console.error("Unable to upload file to Streamable.", uploadResult);
            failUpload(channelId);
            return false;
        }
    } catch (error) {
        console.error("Unable to upload file to Streamable.", error);
        const errorMessage = error instanceof Error ? error.message : String(error);

        if (errorMessage.includes("STREAMABLE_UPLOAD_HTTP_400")) {
            sendBotMessage(channelId, { content: "**Streamable rejected the upload (400).** Try a different file format/size and try again." });
        } else if (errorMessage.includes("STREAMABLE_UPLOAD_HTTP_401")) {
            sendBotMessage(channelId, { content: "**Streamable login failed (401).** Re-check your email/password in StreamableUpload settings." });
        } else if (errorMessage.includes("STREAMABLE_UPLOAD_HTTP_403")) {
            sendBotMessage(channelId, { content: "**Streamable blocked this request (403).** Your account may need verification or permission changes." });
        } else if (errorMessage.includes("STREAMABLE_PROCESSING_TIMEOUT")) {
            sendBotMessage(channelId, { content: "**Streamable is still processing the video.** Try again in a moment." });
        } else if (errorMessage.includes("STREAMABLE_PROCESSING_FAILED_")) {
            sendBotMessage(channelId, { content: "**Streamable failed to process this video.** Try a different file or re-encode it." });
        } else {
            sendBotMessage(channelId, { content: GENERIC_UPLOAD_FAILURE_MESSAGE });
        }
        showToast(FILE_UPLOAD_FAILED_TOAST, Toasts.Type.FAILURE);
        clearUploadDrafts(channelId);
        return false;
    }
}

async function uploadFile(file: File, channelId: string) {
    if (file.size > MAX_UPLOAD_SIZE_BYTES) {
        notifyUploadLimitExceeded(file, channelId);
        return;
    }

    showToast(`Uploading ${file.name} (${formatFileSize(file.size)}) via Streamable...`, Toasts.Type.MESSAGE);

    const stillUploadingHandle = setInterval(() => {
        showToast("Still uploading... this can take a while for large files.", Toasts.Type.MESSAGE);
    }, UPLOAD_STILL_RUNNING_MS);

    try {
        await withTimeout(uploadFileToStreamable(file, channelId), UPLOAD_TIMEOUT_MS);
    } catch (error) {
        if (error instanceof Error && error.message === "UPLOAD_TIMEOUT") {
            showToast("Upload timed out after 10 minutes. Try again.", Toasts.Type.FAILURE);
            sendBotMessage(channelId, { content: "**Upload timed out.** Try again or use a smaller file." });
            clearUploadDrafts(channelId);
        } else {
            console.error("Unexpected upload error:", error);
            showToast("Unexpected upload error.", Toasts.Type.FAILURE);
            clearUploadDrafts(channelId);
        }
    } finally {
        clearInterval(stillUploadingHandle);
    }
}

function triggerFileUpload() {
    const fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.style.display = "none";

    fileInput.onchange = async event => {
        try {
            const target = event.target as HTMLInputElement;
            if (target && target.files && target.files.length > 0) {
                const file = target.files[0];
                if (file) {
                    const channelId = SelectedChannelStore.getChannelId();
                    if (file.size > MAX_UPLOAD_SIZE_BYTES) {
                        notifyUploadLimitExceeded(file, channelId);
                        return;
                    }

                    showToast(`Selected ${file.name}. Starting upload...`, Toasts.Type.MESSAGE);
                    await uploadFile(file, channelId);
                } else {
                    showToast("No file selected");
                }
            }
        } finally {
            if (fileInput.isConnected) {
                document.body.removeChild(fileInput);
            }
        }
    };

    fileInput.oncancel = () => {
        if (fileInput.isConnected) {
            document.body.removeChild(fileInput);
        }
    };

    document.body.appendChild(fileInput);
    fileInput.click();
}

const ctxMenuPatch: NavContextMenuPatchCallback = (children, props) => {
    if (props.channel.guild_id && !PermissionStore.can(PermissionsBits.SEND_MESSAGES, props.channel)) return;

    children.splice(0, 0,
        <Menu.MenuItem
            id="upload-big-file"
            label={
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <PlusIcon width={18} height={18} />
                    <span style={{ fontWeight: 600, letterSpacing: "0.01em" }}>Upload File Up to 250 MB</span>
                </div>
            }
            action={triggerFileUpload}
        />
    );
};

export default definePlugin({
    name: "StreamableUpload",
    description: "Upload files up to 250 MB to Streamable using the + menu button or /fileupload, then post the generated link in chat.",
    authors: [Devs.ScattrdBlade],
    tags: ["Media"],
    enabledByDefault: false,
    settings,
    stop() {
        if (settings.store.clearCredentialsOnDisable) {
            settings.store.streamableEmail = "";
            settings.store.streamablePassword = "";
            settings.store.streamablePasswordEncrypted = "";
        }
    },
    dependencies: ["CommandsAPI"],
    contextMenus: {
        "channel-attach": ctxMenuPatch,
    },
    commands: [
        {
            inputType: ApplicationCommandInputType.BUILT_IN,
            name: "fileupload",
            description: "Upload a file",
            options: [
                {
                    name: "file",
                    description: "The file to upload",
                    type: ApplicationCommandOptionType.ATTACHMENT,
                    required: true,
                },
            ],
            execute: async (opts, cmdCtx) => {
                const file = await resolveFile(opts, cmdCtx);
                // Clear slash UI immediately after Enter so command text + attachment do not linger.
                clearTextDrafts(cmdCtx.channel.id);
                clearUploadDrafts(cmdCtx.channel.id);

                if (file) {
                    await uploadFile(file, cmdCtx.channel.id);
                } else {
                    sendBotMessage(cmdCtx.channel.id, { content: "No file specified!" });
                }
            },
        },
    ],
});
