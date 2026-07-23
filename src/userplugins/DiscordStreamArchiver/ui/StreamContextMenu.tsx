import { NavContextMenuPatchCallback } from "@api/ContextMenu";
import { Menu } from "@webpack/common";

import { sessionStore } from "../stores/sessionStore";
import { autoRecordWhenSubmenu } from "./autoRecordMenu";

export interface StreamMenuHooks {
    startForStream: (streamKey: string, channelId: string) => void;
}

let hooks: StreamMenuHooks | null = null;
export function registerStreamMenuHooks(h: StreamMenuHooks) {
    hooks = h;
}

export const streamContextPatch: NavContextMenuPatchCallback = (children, props) => {
    const p = props as any;
    const streamKey: string | undefined = p?.streamKey;
    const user = p?.user;
    const channelId: string | undefined = p?.channelId ?? (streamKey ? streamKey.split(":")[1] : undefined);
    if (!streamKey || !user) return;
    if (children.some(c => (c as any)?.props?.id === "dsa-auto-record-when")) return;

    const sessionActive = sessionStore.get().state === "recording";
    const items: any[] = [<Menu.MenuSeparator />, autoRecordWhenSubmenu(user.id)];
    if (!sessionActive && hooks && channelId) {
        items.push(
            <Menu.MenuItem
                id="dsa-record-this-stream"
                label="Record this stream"
                action={() => hooks!.startForStream(streamKey, channelId)}
            />
        );
    }
    children.push(...items);
};
