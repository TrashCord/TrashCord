/*
 * TrashCord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import {
    ModalContent,
    ModalFooter,
    ModalHeader,
    ModalProps,
    ModalRoot,
    openModal,
} from "@utils/modal";
import { Button } from "@components/Button";
import { Heading } from "@components/Heading";
import { React, TextInput, useState } from "@webpack/common";

import { setUsername } from "./index";

function Modal({ user, props: modalProps }: { user: any, props: ModalProps; }) {
    const [nickname, setNickname] = useState(user.customNick || "");

    return (
        <ModalRoot {...modalProps}>
            <ModalHeader>
                <Heading tag="h4">
                    {user.customNick ? "Change" : "Add"} Custom Nickname
                </Heading>
            </ModalHeader>

            <ModalContent>
                <Heading>Nickname</Heading>
                <TextInput
                    style={{ marginBottom: "10px" }}
                    value={nickname}
                    placeholder={user.globalName}
                    onChange={(e: string) => {
                        setNickname(e);
                    }}
                />
                <Button
                    variant="link"
                    size="iconOnly"
                    style={{ padding: "0px" }}
                    onClick={() => {
                        setNickname("");
                    }}>
                    Reset Nickname
                </Button>
            </ModalContent>

            <ModalFooter>
                <Button
                    variant="primary"
                    onClick={async () => {
                        setUsername(nickname.length > 0 ? nickname : user.globalName, user.id);
                        modalProps.onClose();
                    }}
                >
                    Save
                </Button>
                <Button
                    variant="none"
                    onClick={modalProps.onClose}
                >
                    Cancel
                </Button>
            </ModalFooter>
        </ModalRoot>
    );
}

export function buildModal(user: any): void {
    openModal((props: ModalProps) => <Modal user={user} props={props} />);
}
