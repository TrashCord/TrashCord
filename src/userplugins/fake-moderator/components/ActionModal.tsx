/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { HeadingSecondary } from "@components/Heading";
import { Margins } from "@components/margins";
import { RenderModalProps } from "@vencord/discord-types";
import { Modal, openModal, Select, TextArea, TextInput, useState } from "@webpack/common";

import { ACTIONS, DURATION_PRESETS } from "../constants";
import { addAction } from "../store";
import { FakeActionType } from "../types";
import { notifyAction } from "../utils";

interface ActionModalProps {
    modalProps: RenderModalProps;
    type: FakeActionType;
    targetId: string;
    targetName: string;
    guildId?: string;
}

const CUSTOM_VALUE = -1;

/**
 * Collects a reason (and, where relevant, a duration) for a fake action, then
 * records it locally and fires the confirmation notifications. This modal does
 * not — and cannot — send anything to Discord.
 */
function ActionModal({ modalProps, type, targetId, targetName, guildId }: ActionModalProps) {
    const meta = ACTIONS[type];

    const [reason, setReason] = useState("");
    const [durationChoice, setDurationChoice] = useState<number>(DURATION_PRESETS[0].seconds);
    const [customMinutes, setCustomMinutes] = useState("");

    const isCustom = durationChoice === CUSTOM_VALUE;
    const customSeconds = Math.max(0, Math.round(Number(customMinutes) * 60)) || 0;
    const effectiveDuration = meta.needsDuration
        ? (isCustom ? customSeconds : durationChoice)
        : undefined;

    const customInvalid = isCustom && (!customMinutes.trim() || Number.isNaN(Number(customMinutes)) || customSeconds <= 0);

    const confirm = () => {
        const record = addAction({
            type,
            targetId,
            targetName,
            reason: reason.trim(),
            duration: effectiveDuration,
            guildId
        });
        notifyAction(record);
        modalProps.onClose();
    };

    return (
        <Modal
            {...modalProps}
            title={`${meta.emoji} ${meta.label}`}
            subtitle={`Local-only action on ${targetName}. Nothing is sent to Discord.`}
            actions={[
                {
                    text: "Cancel",
                    variant: "secondary",
                    onClick: modalProps.onClose
                },
                {
                    text: meta.label,
                    variant: "primary",
                    onClick: confirm,
                    disabled: customInvalid
                }
            ]}
        >
            <div>
                <HeadingSecondary>Reason</HeadingSecondary>
                <TextArea
                    value={reason}
                    onChange={setReason}
                    placeholder="Reason for this (fake) action…"
                    rows={3}
                    autosize
                />

                {meta.needsDuration && (
                    <div className={Margins.top16}>
                        <HeadingSecondary>Duration</HeadingSecondary>
                        <Select
                            options={[
                                ...DURATION_PRESETS.map(p => ({ label: p.label, value: p.seconds })),
                                { label: "Custom…", value: CUSTOM_VALUE }
                            ]}
                            placeholder="Select a duration"
                            maxVisibleItems={6}
                            closeOnSelect={true}
                            select={(v: number) => setDurationChoice(v)}
                            isSelected={(v: number) => v === durationChoice}
                            serialize={(v: number) => String(v)}
                        />

                        {isCustom && (
                            <div className={Margins.top8}>
                                <TextInput
                                    type="number"
                                    value={customMinutes}
                                    onChange={setCustomMinutes}
                                    placeholder="Minutes (e.g. 30)"
                                    error={customInvalid ? "Enter a positive number of minutes" : undefined}
                                />
                            </div>
                        )}
                    </div>
                )}
            </div>
        </Modal>
    );
}

/** Open the reason/duration modal for the given fake action + target. */
export function openActionModal(opts: Omit<ActionModalProps, "modalProps">) {
    openModal(modalProps => <ActionModal modalProps={modalProps} {...opts} />);
}
