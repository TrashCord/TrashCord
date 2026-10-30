/*
 * TrashCord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// import "./addonCard.css";

import { classNameFactory } from "@api/Styles";
import { Text } from "@components/Text";

function AddonBadge({ text, color }: { text: string; color: string; }) {
    return (
        <span style={{
            backgroundColor: color,
            color: "#fff",
            borderRadius: "4px",
            fontSize: "0.65em",
            fontWeight: "bold",
            padding: "1px 5px",
            marginLeft: "6px",
            verticalAlign: "middle",
            textTransform: "uppercase",
            letterSpacing: "0.05em",
        }}>
            {text}
        </span>
    );
}

import type { Props } from "../types";

const cl = classNameFactory("vc-addon-");

export function AddonCard({ disabled, isNew, name, infoButton, footer, author, enabled, setEnabled, description, onMouseEnter, onMouseLeave }: Props) {
    return (
        <div
            className={cl("card", { "card-disabled": disabled })}
            onMouseEnter={onMouseEnter}
            onMouseLeave={onMouseLeave}
        >
            <div className={cl("header")}>
                <div className={cl("name-author")}>
                    <Text size="md" weight="bold" className={cl("name")}>
                        {name}{isNew && <AddonBadge text="NEW" color="#ED4245" />}
                    </Text>
                    {!!author && (
                        <Text size="md" weight="normal" className={cl("author")}>
                            {author}
                        </Text>
                    )}
                </div>

                {infoButton}
            </div>

            <Text className={cl("note")} size="sm" weight="normal">{description}</Text>

            {footer}
        </div>
    );
}