/*
 * TrashCord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { DataStore } from "@api/index";
import { insertTextIntoChatInputBox } from "@utils/discord";
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
import { ChannelStore, React, SelectedChannelStore, showToast, TextArea, useEffect } from "@webpack/common";

import { encrypt } from "./index";

const localStorageKeysString = "gpgPublicKeys";

function Modal(props: ModalProps) {
    // If the user already entered the public key for the recipient he doesn't have to insert it again...
    let recipientId;
    try {
        recipientId = ChannelStore.getChannel(SelectedChannelStore.getChannelId()).recipients[0];
    } catch (e) {
        showToast({ text: "Cannot find the recipient id of the message", variant: "critical" });
        throw e;
    }
    const [pKey, setPKey] = React.useState("");
    const [message, setMessage] = React.useState("");
    const [publicKeyDictChange, setPublicKeyDictChange] = React.useState(false);
    const [publicKeys, setPublicKeys] = React.useState({});

    // Execute this code only one time
    useEffect(() => {
        DataStore.get(localStorageKeysString).then(dataStorageKeys => {
            if (dataStorageKeys != null) {
                const parsedKeys = JSON.parse(dataStorageKeys);
                const updatedKeys = { ...publicKeys, ...parsedKeys };
                setPublicKeys(updatedKeys);

                const recipientKey = updatedKeys[recipientId];
                setPKey(recipientKey);
            }
        });
    }, []);

    return (
        <ModalRoot {...props}>
            <ModalHeader>
                <Heading tag="h4">PGP/GPG Message</Heading>
            </ModalHeader>

            <ModalContent>
                <Heading tag="h5">Message</Heading>
                <TextArea
                    onChange={(e: string) => {
                        setMessage(e);
                    }}
                />

                <Heading tag="h5">Recipient public key</Heading>
                <TextArea
                    value={pKey}
                    onChange={(e: string) => {
                        setPublicKeys({ ...publicKeys, [recipientId]: e });
                        setPublicKeyDictChange(true);
                        setPKey(e);
                    }}
                />
            </ModalContent>
            <ModalFooter>
                <Button
                    variant="positive"
                    onClick={() => {

                        try {
                            encrypt(message, pKey).then(encryptedMessage => {
                                if (publicKeyDictChange) {
                                    DataStore.set(localStorageKeysString, JSON.stringify(publicKeys));
                                }

                                insertTextIntoChatInputBox(encryptedMessage);
                                props.onClose();
                            });
                        } catch {
                            props.onClose();
                        }
                    }}
                >
                    Send
                </Button>
            </ModalFooter>
        </ModalRoot>
    );
}

export function buildModal(): any {
    try {
        openModal((props: any) => <Modal {...props} />);
    } catch {
        return;
    }
}
