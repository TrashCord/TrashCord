import { NavContextMenuPatchCallback } from "@api/ContextMenu";
import { Menu } from "@webpack/common";

import { autoRecordWhenSubmenu } from "./autoRecordMenu";

// Mounts the "Auto-record when user…" submenu on the user-context menu so the
// flags are reachable by right-clicking a user's name/avatar anywhere in
// Discord (chat, member list, DMs). Deduped by the submenu's parent id.
export const userContextPatch: NavContextMenuPatchCallback = (children, props) => {
    const user = (props as any)?.user;
    if (!user || !user.id) return;
    if (children.some(c => (c as any)?.props?.id === "dsa-auto-record-when")) return;
    children.push(<Menu.MenuSeparator />, autoRecordWhenSubmenu(user.id));
};
