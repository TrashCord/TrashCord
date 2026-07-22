/*
 * Vault, a Discord client mod
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { NavContextMenuPatchCallback } from "@api/ContextMenu";
import { showNotification } from "@api/Notifications";
import definePlugin from "@utils/types";
import type { Channel, Message, User } from "@vencord/discord-types";
import { ChannelStore, Menu, MessageActions, RestAPI, Toasts, UserStore } from "@webpack/common";

interface UserContextProps {
    channel?: Channel;
    guildId?: string;
    user?: User;
}

// channels currently being cleared (used to toggle start/stop)
const clearing = new Set<string>();

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// only normal messages (DEFAULT = 0, REPLY = 19) can be deleted by their author
const DELETABLE_TYPES = [0, 19];

function TrashIcon() {
    return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M15 3.999V2H9v1.999H3v2h1.5v15A1.5 1.5 0 0 0 6 22.5h12a1.5 1.5 0 0 0 1.5-1.5V6H21V4h-6zM9 18.5H7v-9h2v9zm4 0h-2v-9h2v9zm4 0h-2v-9h2v9z" />
        </svg>
    );
}

function toast(message: string, type = Toasts.Type.MESSAGE) {
    Toasts.show({ message, type, id: Toasts.genId(), options: { position: Toasts.Position.BOTTOM } });
}

// fromMessageId: if set, only delete messages from that message onwards (the
// targeted message itself + everything newer than it).
async function clearMessages(channelId: string, fromMessageId?: string) {
    const myId = UserStore.getCurrentUser()?.id;
    if (!myId) return;

    clearing.add(channelId);
    toast(fromMessageId
        ? "Clearing from this message... (open the user menu to stop)"
        : "Clearing your messages... (open the menu again to stop)");

    let before: string | undefined;
    let deleted = 0;

    try {
        // paginate from newest to oldest using snowflake "before" cursor
        while (clearing.has(channelId)) {
            const query: Record<string, any> = { limit: 100 };
            if (before) query.before = before;

            let body: any[];
            try {
                const res = await RestAPI.get({ url: `/channels/${channelId}/messages`, query } as any);
                body = res.body;
            } catch {
                toast("Failed to fetch messages, stopping.", Toasts.Type.FAILURE);
                break;
            }

            if (!Array.isArray(body) || body.length === 0) break;

            // body is newest-first, which is exactly the order we want to delete in
            let reachedEnd = false;
            for (const msg of body) {
                if (!clearing.has(channelId)) { reachedEnd = true; break; }
                before = msg.id; // advance cursor to ever-older messages

                // stop once we go older than the target message (bounded mode)
                if (fromMessageId && BigInt(msg.id) < BigInt(fromMessageId)) { reachedEnd = true; break; }

                if (msg.author?.id !== myId) continue;
                if (!DELETABLE_TYPES.includes(msg.type)) continue;

                try {
                    await MessageActions.deleteMessage(channelId, msg.id);
                    deleted++;
                } catch {
                    // skip messages we can't delete
                }
                // small delay to stay gentle (RestAPI also auto-handles rate limits)
                await sleep(350);
            }

            if (reachedEnd) break;
            if (body.length < 100) break; // reached the oldest message
        }
    } finally {
        clearing.delete(channelId);
        showNotification({
            title: "Clear Messages",
            body: `Done — deleted ${deleted} message${deleted === 1 ? "" : "s"}.`
        });
    }
}

const patchUserContext: NavContextMenuPatchCallback = (children, { user, channel }: UserContextProps) => {
    if (!user) return;

    // prefer the DM channel with this user; fall back to the menu's channel
    const dmId = (ChannelStore as any).getDMFromUserId?.(user.id);
    const channelId: string | undefined = dmId ?? channel?.id;
    if (!channelId) return;

    const isClearing = clearing.has(channelId);

    children.push(
        <Menu.MenuItem
            id="vault-clear-messages"
            label={isClearing ? "Stop Clearing" : "Clear Messages"}
            color="danger"
            icon={TrashIcon}
            action={() => {
                if (clearing.has(channelId)) {
                    clearing.delete(channelId);
                    toast("Stopped clearing.");
                } else {
                    clearMessages(channelId);
                }
            }}
        />
    );
};

const patchMessageContext: NavContextMenuPatchCallback = (children, { message }: { message?: Message; }) => {
    if (!message) return;
    const channelId = message.channel_id;

    children.push(
        <Menu.MenuItem
            id="vault-clear-from-here"
            label="Clear from this Message"
            color="danger"
            icon={TrashIcon}
            action={() => {
                if (clearing.has(channelId)) {
                    toast("Already clearing this channel — open the user menu to stop.", Toasts.Type.FAILURE);
                    return;
                }
                clearMessages(channelId, message.id);
            }}
        />
    );
};

export default definePlugin({
    name: "ClearMessages",
    description: "Deletes your own messages one by one (newest to oldest). 'Clear Messages' on a user clears a whole DM; 'Clear from this Message' on a message clears that message and everything after it. Re-open the user menu to stop.",
    authors: [{ name: "eqen", id: 1483151471183921346n }],
    enabledByDefault: false,
    tags: ["Chat", "Utility"],
    contextMenus: {
        "user-context": patchUserContext,
        "message": patchMessageContext
    }
});