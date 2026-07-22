/*
 * Velocity, a modification for Discord's desktop app
 * Copyright (c) 2026 RoScripter999 and contributors
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
*/

import { findGroupChildrenByChildId, NavContextMenuPatchCallback } from "@api/ContextMenu";
import { Devs } from "@utils/constants";
import definePlugin from "@utils/types";
import type { Message } from "@vencord/discord-types";
import { MessageFlags } from "@vencord/discord-types/enums";
import { findByPropsLazy, findLazy } from "@webpack";
import { ChannelStore, Constants, Menu, PermissionsBits, PermissionStore, RestAPI, showToast, Toasts, UserStore } from "@webpack/common";

const uniqueIdProp = findLazy(m => typeof m.uniqueId === "function");
const { getUserMaxFileSize } = findByPropsLazy("getUserMaxFileSize");

const MODIFIABLE_TYPES = new Set([0, 19]);

const CirclePlusIcon = (props: React.SVGProps<SVGSVGElement>) => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
        <circle cx="12" cy="12" r="10" />
        <path d="M8 12h8" />
        <path d="M12 8v8" />
    </svg>
);

const canModifyCache = new WeakMap<Message, boolean>();

const computeCanModify = (msg: Message) => {
    if (msg.deleted || UserStore.getCurrentUser().id !== msg.author.id) return false;
    if (msg.hasFlag(MessageFlags.IS_VOICE_MESSAGE) || !MODIFIABLE_TYPES.has(msg.type)) return false;

    const channel = ChannelStore.getChannel(msg.channel_id);
    if (channel?.guild_id && !PermissionStore.can(PermissionsBits.SEND_MESSAGES, channel)) return false;

    return true;
};

const canModify = (msg: Message) => {
    let cached = canModifyCache.get(msg);
    if (cached === undefined) {
        cached = computeCanModify(msg);
        canModifyCache.set(msg, cached);
    }
    return cached;
};

const openFilePicker = (onPicked: (files: FileList) => void) => {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    input.accept = "*/*";

    input.onchange = (e: Event) => {
        const target = e.target as HTMLInputElement;
        if (target.files?.length) onPicked(target.files);
    };

    input.click();
};

const addAttachments = async (channelId: string, messageId: string, files: FileList, attachments: any[]) => {
    const maxFileSize = getUserMaxFileSize(UserStore.getCurrentUser());
    const uploadableFiles = Array.from(files).filter(file => file.size <= maxFileSize);
    const oversizedCount = files.length - uploadableFiles.length;

    if (oversizedCount) {
        showToast(`${oversizedCount} file(s) exceed your upload limit and were skipped`, Toasts.Type.FAILURE);
    }

    if (!uploadableFiles.length) return;

    showToast("Uploading, this can take a while...", Toasts.Type.CLOCK);

    const fileArray = uploadableFiles.map(file => ({
        filename: file.name,
        file_size: file.size,
        id: uniqueIdProp.uniqueId(),
        is_clip: false
    }));

    const attachmentsReq = (await RestAPI.post({
        url: Constants.Endpoints.MESSAGE_CREATE_ATTACHMENT_UPLOAD(channelId),
        body: { files: fileArray }
    })).body.attachments as { id: string, upload_url: string, upload_filename: string; }[];

    const uploadPromises = attachmentsReq.map((uploadedFile, index) =>
        fetch(uploadedFile.upload_url, {
            method: "PUT",
            body: uploadableFiles[index]
        }).then(() => ({
            id: uploadedFile.id,
            uploaded_filename: uploadedFile.upload_filename,
            filename: uploadableFiles[index].name
        }))
    );

    const newAttachments = await Promise.all(uploadPromises);

    await RestAPI.patch({
        url: Constants.Endpoints.MESSAGE(channelId, messageId),
        body: {
            attachments: [
                ...attachments,
                ...newAttachments
            ]
        }
    });

    showToast("Attachments added successfully!", Toasts.Type.SUCCESS);
};

const removeLastAttachment = async (channelId: string, messageId: string, attachments: any[]) => {
    await RestAPI.patch({
        url: Constants.Endpoints.MESSAGE(channelId, messageId),
        body: {
            attachments: attachments.slice(0, -1)
        }
    });

    showToast("Attachment removed!", Toasts.Type.SUCCESS);
};

const messageContextMenuPatch: NavContextMenuPatchCallback = (children, { message }: { message?: Message; }) => {
    if (!message || !canModify(message)) return;

    const group = findGroupChildrenByChildId("pin", children) ?? children;

    if (message.attachments.length < 10) {
        group.push(
            <Menu.MenuItem
                id="add-attachments"
                key="add-attachments"
                label="Add Attachments"
                icon={CirclePlusIcon}
                action={() => openFilePicker(files => addAttachments(message.channel_id, message.id, files, message.attachments))}
            />
        );
    }

    if (message.attachments.length) {
        group.push(
            <Menu.MenuItem
                id="remove-last-attachment"
                key="remove-last-attachment"
                label="Remove Last Attachment"
                color="danger"
                action={() => removeLastAttachment(message.channel_id, message.id, message.attachments)}
            />
        );
    }
};

function buildPopoverDescriptor(msg: Message) {
    if (msg.attachments.length === 10 || !canModify(msg)) return null;

    return {
        icon: CirclePlusIcon,
        label: "Left click to add, Right click to remove",
        message: msg,
        channel: ChannelStore.getChannel(msg.channel_id),

        onClick: () => openFilePicker(files => addAttachments(msg.channel_id, msg.id, files, msg.attachments)),

        onContextMenu: (e: React.MouseEvent) => {
            e.preventDefault();
            e.stopPropagation();

            if (!msg.attachments.length) return;

            removeLastAttachment(msg.channel_id, msg.id, msg.attachments);
        }
    };
}

const popoverCache = new WeakMap<Message, ReturnType<typeof buildPopoverDescriptor>>();

export default definePlugin({
    name: "AddAttachments",
    description: "Allows you to add attachments to a pre-existing message of yours",
    authors: [Devs.RoScripter999, { name: "zfrancesck1", id: 456195985404592149n }],
    tags: ["Chat", "Utility"],
    enabledByDefault: false,

    contextMenus: {
        "message": messageContextMenuPatch
    },

    messagePopoverButton: {
        required: true,
        icon: () => <CirclePlusIcon />,
        render(msg: Message) {
            if (popoverCache.has(msg)) return popoverCache.get(msg)!;

            const descriptor = buildPopoverDescriptor(msg);
            popoverCache.set(msg, descriptor);
            return descriptor;
        }
    }
});