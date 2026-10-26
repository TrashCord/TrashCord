/*
 * TrashCord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Flex } from "@components/Flex";
import type { ModalSize, RenderModalProps } from "@vencord/discord-types";
import { Modal } from "@webpack/common";
import type { JSX, ReactNode } from "react";

import { ContributorAuthorSummary } from "../../../philsPluginLibrary/components/ContributorAuthorSummary";
import { Author, Contributor } from "../../../philsPluginLibrary/types";

export interface SettingsModalProps extends RenderModalProps {
    title?: string;
    size?: ModalSize;
    onClose: () => void;
    onDone?: () => void;
    children?: ReactNode;
    footerContent?: JSX.Element;
    closeButtonName?: string;
    author?: Author,
    contributors?: Contributor[];
}

export const SettingsModal = (props: SettingsModalProps) => {
    const { author, children, closeButtonName, contributors, footerContent, onDone, size = "md", title, ...modalProps } = props;
    const hasFooterInput = !!footerContent || !!author || !!contributors?.length;

    return (
        <Modal
            {...modalProps}
            size={size}
            title={title ?? ""}
            actionBarInput={hasFooterInput
                ? (
                    <Flex style={{ alignItems: "center", gap: "1em" }}>
                        {(author || contributors && contributors.length > 0) &&

                            <Flex style={{ justifyContent: "flex-start", alignItems: "center" }}>
                                <ContributorAuthorSummary
                                    author={author}
                                    contributors={contributors} />
                            </Flex>
                        }
                        {footerContent}
                    </Flex>
                )
                : undefined}
            actions={[{
                text: closeButtonName ?? "Done",
                variant: "primary",
                onClick: onDone ?? props.onClose
            }]}
        >
            <div style={{ marginBottom: "1em", display: "inline-flex", flexDirection: "column", alignItems: "flex-start", gap: "1em" }}>
                {children}
            </div>
        </Modal>
    );
};
