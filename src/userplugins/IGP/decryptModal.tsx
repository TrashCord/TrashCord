/*
 * TrashCord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ModalContent, ModalHeader, ModalProps, ModalRoot, ModalSize, openModal } from "@utils/modal";
import { Heading } from "@components/Heading";
import { TextArea } from "@webpack/common";

function DecryptModal(props: ModalProps & { message: string; verified: boolean; }) {
    return (
        <ModalRoot {...props} size={ModalSize.LARGE}>
            <ModalHeader>
                <Heading tag="h4">Decrypted Message</Heading>
                <div style={{ color: props.verified ? "green" : "red", fontWeight: "bold", marginTop: "8px" }}>
                    {props.verified ? "Signature verified" : "Signature not verified"}
                </div>
            </ModalHeader>
            <ModalContent>
                {/* Text area to mantain message formatting and \n */}
                <TextArea
                    value={props.message}
                    disabled={true}
                    rows={Math.max(5, props.message.split("\n").length + 1)}
                    onChange={() => props.message}
                />
            </ModalContent>
        </ModalRoot>
    );
}

export function buildDecryptModal(decryptedMessage: string, verified: boolean) {
    openModal((props: any) => <DecryptModal {...props} message={decryptedMessage} verified={verified} />);
}
