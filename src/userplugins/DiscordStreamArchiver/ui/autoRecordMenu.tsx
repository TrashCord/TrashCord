import { Menu } from "@webpack/common";

import { settings } from "../settings";
import { triggerAutoRecordReevaluate } from "../stores/autoRecordControl";
import { listAdd, listContains, listRemove } from "../stores/whitelistStore";

// Shared nested submenu mounted on both user-context and stream-context menus.
// Keeps the top-level menu uncluttered and is expandable later (…unmutes, etc.)
// by adding more checkbox children.
export function autoRecordWhenSubmenu(userId: string) {
    const streams = listContains(settings.store.autoRecordStreamerUsers, userId);
    const joins = listContains(settings.store.autoRecordUsers, userId);
    return (
        <Menu.MenuItem id="dsa-auto-record-when" label="Auto-record when user…">
            <Menu.MenuCheckboxItem
                id="dsa-arw-streams"
                label="…streams"
                checked={streams}
                action={() => {
                    settings.store.autoRecordStreamerUsers = streams
                        ? listRemove(settings.store.autoRecordStreamerUsers, userId)
                        : listAdd(settings.store.autoRecordStreamerUsers, userId);
                    triggerAutoRecordReevaluate();
                }}
            />
            <Menu.MenuCheckboxItem
                id="dsa-arw-joins"
                label="…joins"
                checked={joins}
                action={() => {
                    settings.store.autoRecordUsers = joins
                        ? listRemove(settings.store.autoRecordUsers, userId)
                        : listAdd(settings.store.autoRecordUsers, userId);
                    triggerAutoRecordReevaluate();
                }}
            />
        </Menu.MenuItem>
    );
}
