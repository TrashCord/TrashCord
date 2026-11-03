/*
 * TrashCord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Card } from "@components/Card";
import ErrorBoundary from "@components/ErrorBoundary";
import { Flex } from "@components/Flex";
import { OptionComponentMap } from "@components/settings/tabs/plugins/components";
import { Text } from "@components/Text";
import { debounce } from "@shared/debounce";
import { sendMessage } from "@utils/discord";
import { OptionType, type PluginSettingDef } from "@utils/types";
import type { ModalPropsRender, User } from "@velocity-types";
import { Avatar, IconUtils, Modal, Select, SelectedChannelStore, useMemo, useState, useStateFromStores, VoiceStateStore } from "@webpack/common";

import { type Categories, cl, encodeCommand } from "./utils";

export interface Action {
    id: string;
    label: string;
    description: string;
    category?: Categories;
    predicate?: (selfId: string) => boolean;
    options?: Record<string, PluginSettingDef>;
    execute: (options: Record<string, any>) => void | Promise<void>;
}

interface PanelProps extends ModalPropsRender {
    actions: Action[];
    target: User;
}

function ChevronIcon() {
    return (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M9.29 6.71a1 1 0 0 0 0 1.41L13.17 12l-3.88 3.88a1 1 0 1 0 1.42 1.41l4.59-4.59a1 1 0 0 0 0-1.41L10.7 6.7a1 1 0 0 0-1.41 0Z" />
        </svg>
    );
}

export function ControlsPanel({ actions, target, ...modalProps }: PanelProps) {
    const [expandedAction, setExpandedAction] = useState<string | null>(null);
    const [optionValues, setOptionValues] = useState<Record<string, Record<string, any>>>(() =>
        Object.fromEntries(actions
            .filter(a => a.options)
            .map(a => [
                a.id,
                Object.fromEntries(Object.entries(a.options!).map(([k, v]) => [k, v.default ?? ""]))
            ])
        )
    );

    const [searchQuery, setSearchQuery] = useState<string>("");
    const [selectedCategory, setSelectedCategory] = useState<string>("All");

    useStateFromStores(
        [VoiceStateStore],
        () => actions.map(a => a.predicate ? (a.predicate(target.id) ? "1" : "0") : "-").join(""),
        [actions, target.id]
    );

    const categoryOptions = useMemo(() => {
        const categories = new Set<string>();
        actions.forEach(action => {
            categories.add(action.category ?? "General");
        });
        return [
            { label: "All Categories", value: "All" },
            ...Array.from(categories).map(cat => ({
                label: cat,
                value: cat,
                id: cat
            }))
        ];
    }, [actions]);

    const filteredActions = useMemo(() => {
        const query = searchQuery.trim().toLowerCase();

        return actions.filter(action => {
            const matchesSearch = !query ||
                action.label.toLowerCase().includes(query) ||
                action.description.toLowerCase().includes(query);

            const actionCategory = action.category ?? "General";
            const matchesCategory = selectedCategory === "All" || actionCategory === selectedCategory;

            return matchesSearch && matchesCategory;
        });
    }, [actions, searchQuery, selectedCategory]);

    const grouped = useMemo(() => {
        return Object.entries(
            filteredActions.reduce<Record<string, Action[]>>((acc, action) => {
                const key = action.category ?? "General";
                (acc[key] ??= []).push(action);
                return acc;
            }, {})
        );
    }, [filteredActions]);

    const modalTitle = useMemo(() => (
        <Flex alignItems="center" gap="12px">
            <Avatar
                avatarDecoration={IconUtils.getAvatarDecorationURL({
                    avatarDecoration: target.avatarDecorationData,
                    size: 80,
                    canAnimate: false
                })}
                size="SIZE_48"
                src={IconUtils.getUserAvatarURL(target, false, 80)}
            />
            <Flex flexDirection="column">
                <Text size="lg" weight="semibold">Control Panel</Text>
                <Text size="sm" color="text-muted">{target.username}</Text>
            </Flex>
        </Flex>
    ), [target]);

    return (
        <Modal title={modalTitle} size="lg" {...modalProps}>
            <div>
                <Text size="md" weight="semibold">Search Filters</Text>
                <div className={cl("modal-top")}>
                    <input
                        className={cl("modal-search")}
                        type="text"
                        placeholder="Search for an action..."
                        value={searchQuery}
                        onChange={e => setSearchQuery(e.target.value)}
                        autoFocus
                    />
                    <Select
                        options={categoryOptions}
                        value={selectedCategory}
                        onSelectionChange={setSelectedCategory}
                    />
                </div>

                {filteredActions.length === 0 ? (
                    <Text className={cl("modal-no-search")} size="md" weight="medium" color="text-muted">No actions found for "{searchQuery}"</Text>
                ) : (
                    grouped.map(([category, categoryActions]) => (
                        <Flex key={category} flexDirection="column" gap="8px">
                            <Text className={cl("modal-category")} size="md" weight="semibold" color="text-muted">{category}</Text>
                            <div className={cl("modal-grid")}>
                                {categoryActions.map(action => {
                                    const isExpanded = expandedAction === action.id;
                                    const hasOptions = !!action.options;
                                    const optionVals = optionValues[action.id] ?? {};

                                    return (
                                        <Card key={action.id} padding="sm" className={isExpanded && hasOptions ? cl("modal-grid-full") : undefined}>
                                            <Flex justifyContent="space-between" alignItems="center" gap="8px">
                                                <Flex flexDirection="column" className={cl("modal-action-text")}>
                                                    <Text size="md" weight="semibold">{action.label}</Text>
                                                    <Text size="sm" color="text-muted">{action.description}</Text>
                                                </Flex>
                                                <Flex gap="4px" alignItems="center">
                                                    {hasOptions && (
                                                        <button
                                                            type="button"
                                                            className={cl("btn", "btn-secondary", "modal-chevron", isExpanded && "modal-chevron-expanded")}
                                                            onClick={() => setExpandedAction(isExpanded ? null : action.id)}
                                                        >
                                                            <ChevronIcon />
                                                        </button>
                                                    )}
                                                    <button
                                                        type="button"
                                                        className={cl("btn", "btn-primary")}
                                                        disabled={action.predicate ? !action.predicate(target.id) : false}
                                                        onClick={() => sendMessage(SelectedChannelStore.getChannelId(), { content: encodeCommand(action.id, hasOptions ? optionVals : undefined) })}
                                                    >
                                                        Run
                                                    </button>
                                                </Flex>
                                            </Flex>

                                            {isExpanded && hasOptions && (
                                                <div className={cl("modal-options")}>
                                                    {Object.entries(action.options!).map(([key, setting]) => {
                                                        if (setting.type === OptionType.CUSTOM || setting.hidden) return null;
                                                        const Component = OptionComponentMap[setting.type];

                                                        return (
                                                            <ErrorBoundary noop key={key}>
                                                                <Component
                                                                    id={key}
                                                                    definedSettings={undefined!}
                                                                    setting={setting}
                                                                    onChange={setting.type === OptionType.BOOLEAN
                                                                        ? v => setOptionValues(prev => ({ ...prev, [action.id]: { ...prev[action.id], [key]: v } }))
                                                                        : debounce(v => setOptionValues(prev => ({ ...prev, [action.id]: { ...prev[action.id], [key]: v } })))
                                                                    }
                                                                    pluginSettings={{ ...optionVals, enabled: true }}
                                                                    closePluginSettings={() => { }}
                                                                />
                                                            </ErrorBoundary>
                                                        );
                                                    })}
                                                </div>
                                            )}
                                        </Card>
                                    );
                                })}
                            </div>
                        </Flex>
                    ))
                )}
            </div>
        </Modal>
    );
}