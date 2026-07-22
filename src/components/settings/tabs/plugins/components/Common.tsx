/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { BaseText } from "@components/BaseText";
import { classNameFactory } from "@utils/css";
import { classes } from "@utils/misc";
import { wordsFromCamel, wordsToTitle } from "@utils/text";
import { DefinedSettings, PluginSettingDefCommon } from "@utils/types";
import { PropsWithChildren } from "react";

export const cl = classNameFactory("vc-plugins-setting-");

interface SettingBaseProps<T> {
    setting: T;
    onChange(newValue: any): void;
    pluginSettings: {
        [setting: string]: any;
        enabled: boolean;
    };
    id: string;
    definedSettings: DefinedSettings;
    closePluginSettings(): void;
}

export type SettingProps<T extends PluginSettingDefCommon> = SettingBaseProps<T>;
export type ComponentSettingProps<T extends Omit<PluginSettingDefCommon, "description" | "placeholder">> = SettingBaseProps<T>;

export function resolveError(isValidResult: boolean | string) {
    if (typeof isValidResult === "string") return isValidResult;

    return isValidResult ? null : "Invalid input provided";
}

interface SettingsSectionProps extends PropsWithChildren {
<<<<<<< HEAD
    name?: string;
    id: string;
=======
    name: string;
>>>>>>> 89b0fd2a5 (Update index.tsx)
    description: string;
    error?: string | null;
    inlineSetting?: boolean;
    tag?: "label" | "div";
}

<<<<<<< HEAD
export function SettingsSection({ tag: Tag = "div", name, id, description, error, inlineSetting, children }: SettingsSectionProps) {
=======
export function SettingsSection({ tag: Tag = "div", name, description, error, inlineSetting, children }: SettingsSectionProps) {
>>>>>>> 89b0fd2a5 (Update index.tsx)
    return (
        <Tag className={cl("section")}>
            <div className={classes(cl("content"), inlineSetting && cl("inline"))}>
                <div className={cl("label")}>
<<<<<<< HEAD
                    <BaseText className={cl("title")} size="md" weight="medium">{name ?? wordsToTitle(wordsFromCamel(id))}</BaseText>
=======
                    {name && <BaseText className={cl("title")} size="md" weight="medium">{wordsToTitle(wordsFromCamel(name))}</BaseText>}
>>>>>>> 89b0fd2a5 (Update index.tsx)
                    {description && <BaseText className={cl("description")} size="sm">{description}</BaseText>}
                </div>
                {children}
            </div>
            {error && <BaseText className={cl("error")} size="sm">{error}</BaseText>}
        </Tag>
    );
}
