/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { BaseText } from "@components/BaseText";
import { Button } from "@components/Button";
import { Card } from "@components/Card";
import { Divider } from "@components/Divider";
import { Flex } from "@components/Flex";
import { HeadingSecondary } from "@components/Heading";
import { DeleteIcon } from "@components/Icons";
import { Margins } from "@components/margins";
import { Paragraph } from "@components/Paragraph";
import { Alerts } from "@webpack/common";

import { ACTIONS } from "../constants";
import { settings } from "../settings";
import { clearHistory, removeAction } from "../store";
import { describeAction, downloadHistory, normaliseColor } from "../utils";

/** A few quick-pick swatches for the notification colour. */
const SWATCHES = ["#5865f2", "#ed4245", "#faa61a", "#3ba55d", "#eb459e", "#ffffff"];

function ColorPicker() {
    const { notificationColor } = settings.use(["notificationColor"]);
    const current = normaliseColor(notificationColor);

    return (
        <Flex flexDirection="column" gap={8} className={Margins.top8}>
            <Flex gap={8} style={{ flexWrap: "wrap" }}>
                {SWATCHES.map(c => (
                    <button
                        key={c}
                        aria-label={`Use ${c}`}
                        onClick={() => (settings.store.notificationColor = c)}
                        style={{
                            width: 28,
                            height: 28,
                            borderRadius: 6,
                            background: c,
                            cursor: "pointer",
                            border: current.toLowerCase() === c.toLowerCase()
                                ? "2px solid var(--text-default)"
                                : "2px solid var(--background-modifier-accent)"
                        }}
                    />
                ))}
                <input
                    type="color"
                    aria-label="Custom colour"
                    value={current}
                    onChange={e => (settings.store.notificationColor = e.currentTarget.value)}
                    style={{
                        width: 32,
                        height: 32,
                        padding: 0,
                        border: "none",
                        background: "transparent",
                        cursor: "pointer"
                    }}
                />
            </Flex>
        </Flex>
    );
}

function HistoryList() {
    const { history } = settings.use(["history"]);

    if (history.length === 0) {
        return (
            <Paragraph className={Margins.top8} style={{ color: "var(--text-muted)" }}>
                No fake actions recorded yet.
            </Paragraph>
        );
    }

    return (
        <Flex flexDirection="column" gap={6} className={Margins.top8}>
            {history.map(record => {
                const meta = ACTIONS[record.type];
                return (
                    <Card
                        key={record.id}
                        style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 12px" }}
                    >
                        <span style={{ fontSize: 20 }}>{meta.emoji}</span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                            <Paragraph weight="medium">{describeAction(record)}</Paragraph>
                            <Paragraph size="xs" style={{ color: "var(--text-muted)" }}>
                                {meta.label} · {new Date(record.timestamp).toLocaleString()} · ID {record.targetId}
                            </Paragraph>
                        </div>
                        <Button
                            variant="dangerSecondary"
                            size="iconOnly"
                            onClick={() => removeAction(record.id)}
                        >
                            <DeleteIcon aria-label="Delete entry" width={18} height={18} />
                        </Button>
                    </Card>
                );
            })}
        </Flex>
    );
}

/**
 * Settings panel mounted via the COMPONENT option. Renders the colour picker,
 * the export/clear controls and the live history table. All other toggles are
 * rendered automatically by Equicord from the boolean settings.
 */
export function SettingsPanel() {
    const { history } = settings.use(["history"]);

    const onClear = () => {
        if (history.length === 0) return;
        Alerts.show({
            title: "Clear fake history?",
            body: `This permanently deletes all ${history.length} local fake action(s). This cannot be undone.`,
            confirmText: "Clear",
            cancelText: "Cancel",
            onConfirm: clearHistory
        });
    };

    return (
        <section className={Margins.top16}>
            <Divider className={Margins.bottom16} />

            <HeadingSecondary>Notification colour</HeadingSecondary>
            <Paragraph style={{ color: "var(--text-muted)" }}>
                Colour used for the confirmation notification shown after each fake action.
            </Paragraph>
            <ColorPicker />

            <HeadingSecondary className={Margins.top16}>Fake action history</HeadingSecondary>
            <Paragraph style={{ color: "var(--text-muted)" }}>
                Every fake action is logged locally only. Nothing here was ever sent to Discord.
            </Paragraph>

            <Flex gap={8} className={Margins.top8}>
                <Button onClick={downloadHistory} disabled={history.length === 0}>
                    Export JSON
                </Button>
                <Button variant="dangerPrimary" onClick={onClear} disabled={history.length === 0}>
                    Clear history
                </Button>
                <BaseText size="sm" style={{ alignSelf: "center", color: "var(--text-muted)" }}>
                    {history.length} entr{history.length === 1 ? "y" : "ies"}
                </BaseText>
            </Flex>

            <HistoryList />
        </section>
    );
}
