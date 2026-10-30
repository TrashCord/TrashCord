/*
 * TrashCord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ModalCloseButton, ModalContent, ModalHeader, ModalProps, ModalRoot, openModal } from "@utils/modal";
import { Heading } from "@components/Heading";
import { Paragraph } from "@components/Paragraph";
import { Text } from "@components/Text";
import { React } from "@webpack/common";

export function openPluginModal(plugin) {
    openModal((props: ModalProps) => (
        <ModalRoot {...props}>
            <ModalHeader separator={false}>
                <Text size="xl" weight="semibold" style={{ flexGrow: 1 }}>{plugin.name}</Text>
                <ModalCloseButton onClick={props.onClose} />
            </ModalHeader>
            <ModalContent>
                <section>
                    <Heading tag="h3">About {plugin.name}</Heading>
                    <Paragraph>{plugin.description}</Paragraph>
                </section>
            </ModalContent>
        </ModalRoot>
    ));
}
