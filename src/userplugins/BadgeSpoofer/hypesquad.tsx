/*
 * TrashCord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Button } from "@components/Button";
import { Heading } from "@components/Heading";
import { Text } from "@components/Text";
import { React, RestAPI, showToast, UserStore } from "@webpack/common";

export const HOUSE_FLAGS = { 1: 64, 2: 128, 3: 256 } as const;

export const HOUSES = [
    { id: 1, name: "Bravery", icon: "https://cdn.discordapp.com/badge-icons/8a88d63823d8a71cd5e390baa45efa02.png" },
    { id: 2, name: "Brilliance", icon: "https://cdn.discordapp.com/badge-icons/011940fd013da3f7fb926e4a1cd2e618.png" },
    { id: 3, name: "Balance", icon: "https://cdn.discordapp.com/badge-icons/3aa41de486fa12454c3761e8e223442e.png" }
] as const;

export type HouseId = 0 | 1 | 2 | 3;

export function currentHouse(): HouseId {
    const flags = UserStore.getCurrentUser()?.flags ?? 0;
    for (const [id, flag] of Object.entries(HOUSE_FLAGS)) if (flags & flag) return +id as HouseId;
    return 0;
}

export async function applyHouse(houseId: HouseId): Promise<boolean> {
    const name = HOUSES.find(h => h.id === houseId)?.name ?? "None";
    try {
        showToast({
            text: houseId === 0 ? "Leaving HypeSquad…" : `Updating HypeSquad house to ${name}…`
        });

        if (houseId === 0)
            await RestAPI.del({ url: "/hypesquad/online" });
        else
            await RestAPI.post({ url: "/hypesquad/online", body: { house_id: houseId } });

        showToast({
            text: houseId === 0
                ? "Left HypeSquad. Reload Discord (Ctrl+R) to see your badge removed."
                : `HypeSquad house updated: ${name}! Reload Discord (Ctrl+R) to see your badge.`,
            variant: "success"
        });
        return true;
    } catch (err: any) {
        showToast({ text: `Failed to change house: ${err?.message ?? err}`, variant: "critical" });
        return false;
    }
}

export function HypeSquadPicker() {
    const [selectedHouse, setSelectedHouse] = React.useState<HouseId>(currentHouse);

    const handleClick = (id: HouseId) => {
        if (selectedHouse === id) return;
        setSelectedHouse(id);
        applyHouse(id);
    };

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            <Heading tag="h5" style={{ margin: 0 }}>HYPESQUAD HOUSE</Heading>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "10px" }}>
                {HOUSES.map(h => {
                    const isSelected = selectedHouse === h.id;
                    return (
                        <button
                            key={h.id}
                            onClick={() => handleClick(h.id)}
                            onMouseEnter={e => {
                                e.currentTarget.style.background = "var(--background-modifier-hover)";
                                e.currentTarget.style.transform = "translateY(-1px)";
                                e.currentTarget.style.borderColor = isSelected
                                    ? "var(--brand-500, #5865f2)"
                                    : "var(--interactive-active)";
                            }}
                            onMouseLeave={e => {
                                e.currentTarget.style.background = isSelected
                                    ? "var(--background-modifier-selected)"
                                    : "var(--background-secondary-alt)";
                                e.currentTarget.style.transform = "translateY(0)";
                                e.currentTarget.style.borderColor = isSelected
                                    ? "var(--brand-500, #5865f2)"
                                    : "var(--background-modifier-accent)";
                            }}
                            style={{
                                display: "flex",
                                flexDirection: "column",
                                alignItems: "center",
                                justifyContent: "center",
                                gap: "6px",
                                padding: "12px 10px",
                                borderRadius: "8px",
                                background: isSelected
                                    ? "var(--background-modifier-selected)"
                                    : "var(--background-secondary-alt)",
                                border: isSelected
                                    ? "1px solid var(--brand-500, #5865f2)"
                                    : "1px solid var(--background-modifier-accent)",
                                cursor: "pointer",
                                outline: "none",
                                transition: "all 0.15s ease"
                            }}
                        >
                            <img
                                src={h.icon}
                                alt={h.name}
                                style={{ width: 28, height: 28, filter: isSelected ? "none" : "grayscale(0.4)" }}
                            />
                            <Text
                                size="sm" weight="semibold"
                                color={isSelected ? "header-primary" : "text-muted"}
                            >
                                {h.name}
                            </Text>
                        </button>
                    );
                })}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <Button size="small" variant="dangerPrimary" onClick={() => handleClick(0)}>
                    Leave HypeSquad
                </Button>
                <Text size="xs" weight="normal" color="text-muted">
                    Removes the badge from your account (0 = None).
                </Text>
            </div>
        </div>
    );
}
