import managedStyle from "./styles.css?managed";
import { NavContextMenuPatchCallback } from "@api/ContextMenu";
import definePlugin from "@utils/types";
import { SelectedChannelStore, Menu, PermissionStore, PermissionsBits, React } from "@webpack/common";

import { loadAll, lock, isLocked, hasPassword, getCurrentId } from "./storage";
import { LockIcon, actSetLock, actUnlock, actRelock } from "./modals";
import { Overlay } from "./overlay";
import { refreshOverlay } from "./overlayManager";
import { settings } from "./settings";
import { startIdleWatcher, stopIdleWatcher } from "./idleLock";

// -------------------------------------------------------------------------
// Context Menu Patch
// -------------------------------------------------------------------------

const channelAttachPatch: NavContextMenuPatchCallback = (children, props) => {
    const channel = props?.channel;
    if (!channel) return;

    // Only show in channels where we have send permission
    if (channel.guild_id && !PermissionStore.can(PermissionsBits.SEND_MESSAGES, channel)) return;
    
    // Prevent duplicates
    if (children.some(child => child?.props?.id === "chatlock-button")) return;

    const id = getCurrentId();
    const has = id ? hasPassword(id) : false;
    const locked = id ? isLocked(id) : false;

    let label: string;
    let icon = LockIcon;

    if (!has) {
        label = "Set Password";
    } else if (locked) {
        label = "Unlock Chat";
    } else {
        label = "Lock Chat";
    }

    children.splice(1, 0, (
        <Menu.MenuItem
            id="chatlock-button"
            label={label}
            iconLeft={icon}
            action={() => {
                const currentId = getCurrentId();
                if (!currentId) return;
                
                if (!hasPassword(currentId)) {
                    actSetLock();
                } else if (isLocked(currentId)) {
                    actUnlock();
                } else {
                    actRelock();
                }
            }}
        />
    ));
};

// -------------------------------------------------------------------------
// Channel Switch Handling
// -------------------------------------------------------------------------

let previousChannelId: string | null = null;

function handleChannelChange() {
    const newId = getCurrentId();
    if (previousChannelId && previousChannelId !== newId) {
        lock(previousChannelId);
    }
    previousChannelId = newId;
    refreshOverlay();
}

async function startupLockAll() {
    try {
        const data = await loadAll();
        for (const id of Object.keys(data)) {
            lock(id);
        }
    } catch (err) {
        console.error("[ChatLockButton] Failed to restore locks:", err);
    }
}

// -------------------------------------------------------------------------
// Plugin Definition
// -------------------------------------------------------------------------

export default definePlugin({
    name: "ChatLockButton",
    description: "Adds a 'Lock Chat' item to the + dropdown. Blurs the chat when locked, auto‑locks on channel switch, and persists lock state.",
    authors: [{ name: "You", id: 0n }],
    tags: ["Privacy", "Utility", "Chat", "Customisation"],
    enabledByDefault: false,
    managedStyle,
    settings,
    contextMenus: { "channel-attach": channelAttachPatch },

    // Exposed so the patch can reference it via $self.Overlay
    Overlay,

    /**
     * Updated for Discord builds around August 2026.
     * 
     * Module 10822 still contains the message-list wrapper. The minified
     * identifiers for the CSS-module imports and local variables shift
     * between builds, so the regex now uses character classes instead of
     * hard-coded names. It still anchors on the `group-spacing` template
     * literal which has been stable.
     * 
     * If this breaks on a future update:
     * 1. Settings → Vencord → Patch Helper
     * 2. Search for "messagesNavigationDescription" (or "Inferno Spam Redaction"
     *    / "useConversationScroll" if that string has moved)
     * 3. Locate the wrapper div and note the local variable names for:
     *    - the clsx-like utility (usually `c` or `C`)
     *    - the JSX runtime (usually `a` or `n(477900)`)
     * 4. Update the `match` and `replace` below accordingly.
     */
    patches: [
        {
            find: "messagesNavigationDescription",
            replacement: {
                match: /className:c\(\)\([a-zA-Z_$][\w$]*\.[a-zA-Z_$][\w$]*,[a-zA-Z_$][\w$]*,`group-spacing-\$\{[a-zA-Z_$][\w$]*\}`\),children:\[/,
                replace: (match: string) => `${match}a.jsx($self.Overlay,{}),`
            }
        }
    ],

    _unsub: null as (() => void) | null,

    start() {
        startupLockAll();
        this._unsub = SelectedChannelStore.addChangeListener(handleChannelChange);
        startIdleWatcher();
        refreshOverlay();
    },

    stop() {
        this._unsub?.();
        this._unsub = null;
        stopIdleWatcher();
    }
});
