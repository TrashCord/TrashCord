/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { findGroupChildrenByChildId, NavContextMenuPatchCallback } from "@api/ContextMenu";
import definePlugin from "@utils/types";
import type { Channel, Guild, User } from "@vencord/discord-types";
import { Menu, React } from "@webpack/common";

import { openActionModal } from "./components/ActionModal";
import { ACTIONS, MENU_ORDER, VOICE_ORDER } from "./constants";
import { settings } from "./settings";
import { addAction, getVoiceState, setVoiceFlag } from "./store";
import { FakeActionMeta, FakeActionType } from "./types";
import { notifyAction, notifyVoiceOff } from "./utils";

interface UserContextProps {
    channel?: Channel;
    guild?: Guild;
    guildId?: string;
    user?: User;
}

/** Anchors (native menu item ids) we try, in order, to place the fake actions
 * in the same spot Discord puts its real moderation entries. */
const ANCHOR_IDS = ["roles", "block", "devmode-copy-id"];

/**
 * Insert `nodes` into the top-level menu `children` right after the native group
 * that contains one of {@link ANCHOR_IDS}. Falls back to appending at the end so
 * the actions are always reachable, even in unusual menus (e.g. DMs).
 */
function insertAfterAnchor(
    children: Array<React.ReactElement<any> | null | undefined>,
    nodes: React.ReactElement<any>[]
) {
    for (const id of ANCHOR_IDS) {
        const idx = children.findIndex(child =>
            Array.isArray(child) && findGroupChildrenByChildId(id, child) != null
        );
        if (idx !== -1) {
            children.splice(idx + 1, 0, ...nodes);
            return;
        }
    }
    children.push(...nodes);
}

/** Toggle a fake mute/deafen flag for a user, logging + notifying accordingly. */
function toggleVoice(meta: FakeActionMeta, user: User, targetName: string, guildId?: string) {
    const flag = meta.type === "mute" ? "muted" : "deafened";
    const next = !getVoiceState(user.id)[flag];

    setVoiceFlag(user.id, flag, next);

    if (next) {
        notifyAction(addAction({
            type: meta.type,
            targetId: user.id,
            targetName,
            reason: "",
            guildId
        }));
    } else {
        notifyVoiceOff(meta.type as "mute" | "deafen", targetName);
    }
}

/**
 * Renders the fake moderation entries to look exactly like Discord's native ones:
 * red ("danger") action items for Timeout/Kick/Ban/Warn, and checkbox toggles for
 * Mute/Deafen (mirroring the native voice checkboxes). Everything is 100% cosmetic —
 * nothing is ever sent to Discord and the target is never affected.
 */
const UserContextMenuPatch: NavContextMenuPatchCallback = (children, props: UserContextProps) => {
    const { user, guild, guildId } = props;
    if (!user) return;

    const targetName = (user as any).globalName || user.username;
    const resolvedGuildId = guild?.id ?? guildId;
    const voiceState = getVoiceState(user.id);

    // Voice toggles (Mute / Deafen) rendered as RED checkbox items.
    const voiceItems = VOICE_ORDER
        .map(type => ACTIONS[type])
        .filter(meta => settings.store[meta.enableKey])
        .map(meta => (
            <Menu.MenuCheckboxItem
                key={meta.type}
                id={`vc-fake-moderator-${meta.type}`}
                label={meta.menuVerb}
                color="danger"
                checked={meta.type === "mute" ? !!voiceState.muted : !!voiceState.deafened}
                action={() => toggleVoice(meta, user, targetName, resolvedGuildId)}
            />
        ));

    // Moderation actions (Timeout / Kick / Ban / Warn) rendered as red items.
    const moderationItems = MENU_ORDER
        .map(type => ACTIONS[type])
        .filter(meta => settings.store[meta.enableKey])
        .map(meta => (
            <Menu.MenuItem
                key={meta.type}
                id={`vc-fake-moderator-${meta.type}`}
                label={`${meta.menuVerb} ${targetName}`}
                color="danger"
                action={() => openActionModal({
                    type: meta.type as FakeActionType,
                    targetId: user.id,
                    targetName,
                    guildId: resolvedGuildId
                })}
            />
        ));

    // Keep everything in ONE group so the voice toggles sit right next to the
    // red moderation actions instead of drifting to another part of the menu.
    const items = [...voiceItems, ...moderationItems];
    if (items.length === 0) return;

    insertAfterAnchor(children, [<Menu.MenuGroup key="vc-fake-moderator">{items}</Menu.MenuGroup>]);
};

export default definePlugin({
    name: "Fake Moderator",
    description: "Adds local-only moderation entries (Ban/Kick/Timeout/Warn) and voice toggles (Mute/Deafen) to the user context menu, styled exactly like Discord's real ones. Purely cosmetic — nothing is sent to Discord and the target is never affected.",
    authors: [{ name: "overocai", id: 1288832011452153910n }],
    tags: ["Utility", "Privacy", "Servers"],
    enabledByDefault: false,
    settings,
    contextMenus: {
        "user-context": UserContextMenuPatch
    }
});
