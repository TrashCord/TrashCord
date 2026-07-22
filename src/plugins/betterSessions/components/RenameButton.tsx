/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Button } from "@components/Button";
import { SessionInfo } from "@plugins/betterSessions/types";
<<<<<<< HEAD
import { cl } from "@plugins/betterSessions/utils";
=======
>>>>>>> 89b0fd2a5 (Update index.tsx)
import { openModal } from "@webpack/common";

import { RenameModal } from "./RenameModal";

export function RenameButton({ session, state }: { session: SessionInfo["session"], state: [string, React.Dispatch<React.SetStateAction<string>>]; }) {
    return (
        <Button
            variant="secondary"
            size="xs"
<<<<<<< HEAD
            className={cl("rename-btn")}
=======
            className="vc-betterSessions-rename-btn"
>>>>>>> 89b0fd2a5 (Update index.tsx)
            onClick={() =>
                openModal(props => (
                    <RenameModal
                        props={props}
                        session={session}
                        state={state}
                    />
                ))
            }
        >
            Rename
        </Button>
    );
}

export function NewButton() {
    return (
        <Button
            variant="dangerPrimary"
            size="min"
<<<<<<< HEAD
            className={cl("new-btn")}
=======
            className="vc-betterSessions-new-btn"
>>>>>>> 89b0fd2a5 (Update index.tsx)
        >
            NEW
        </Button>
    );
}
