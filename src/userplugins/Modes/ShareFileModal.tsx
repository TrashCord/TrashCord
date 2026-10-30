/*
 * TrashCord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Flex } from "@components/Flex";
import { getCurrentChannel } from "@utils/discord";
import { ModalCloseButton, ModalContent, ModalHeader, ModalRoot, ModalSize } from "@utils/modal";
import type { RenderModalProps } from "@vencord/discord-types";
import { Button } from "@components/Button";
import { Text } from "@components/Text";
import { DraftType, React, showToast, UploadHandler } from "@webpack/common";

export function ShareFileModal({ rootProps, title, blurb, buildFile }: {
    rootProps: RenderModalProps;
    title: string;
    blurb: string;
    buildFile(): File;
    defaultNote: string;
}) {
    function postInChat() {
        const channel = getCurrentChannel();
        if (!channel) return showToast({ text: "Open a chat first to post it there.", variant: "critical" });
        UploadHandler.promptToUpload([buildFile()], channel, DraftType.ChannelMessage);
        rootProps.onClose();
    }

    return (
        <ModalRoot {...rootProps} size={ModalSize.SMALL}>
            <ModalHeader>
                <Text size="xl" weight="semibold" style={{ flexGrow: 1 }}>{title}</Text>
                <ModalCloseButton onClick={rootProps.onClose} />
            </ModalHeader>
            <ModalContent>
                <Text size="sm" weight="normal" style={{ margin: "12px 0", opacity: 0.8 }}>{blurb}</Text>
                <Flex style={{ gap: 8, justifyContent: "flex-end", margin: "16px 0" }}>
                    <Button variant="primary" onClick={postInChat}>Share in current chat</Button>
                </Flex>
            </ModalContent>
        </ModalRoot>
    );
}
