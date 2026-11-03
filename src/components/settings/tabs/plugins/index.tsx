/*
 * Vencord, a modification for Discord's desktop app
 * Copyright (c) 2022 Vendicated and contributors
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
*/

import "./styles.css";

import * as DataStore from "@api/DataStore";
import { isPluginEnabled, stopPlugin } from "@api/PluginManager";
import { useSettings } from "@api/Settings";
import { Button } from "@components/Button";
import { Card } from "@components/Card";
import { Divider } from "@components/Divider";
import ErrorBoundary from "@components/ErrorBoundary";
import { Heading } from "@components/Heading";
import { Paragraph } from "@components/Paragraph";
import { SettingsTab } from "@components/settings";
import { debounce } from "@shared/debounce";
import { ChangeList } from "@utils/ChangeList";
import {
    Devs, EquicordDevs, IllegalcordDevs, NightcordDevs, TestcordDevs, TrashCordDevs,
    EquicordDevsById, IllegalcordDevsById, NightcordDevsById, TestcordDevsById, TrashCordDevsById, VencordDevsById
} from "@utils/constants";
import { classNameFactory } from "@utils/css";
import { isTruthy } from "@utils/guards";
import { Logger } from "@utils/Logger";
import { Margins } from "@utils/margins";
import { classes } from "@utils/misc";
import { PluginTarget } from "@utils/pluginTargets";
import { promptToRestart } from "@utils/promptToRestart";
import { useAwaiter, useCleanupEffect, useIntersection } from "@utils/react";
import { PluginTag, PluginTags } from "@utils/types";
import { Alerts, lodash, Parser, React, SearchableSelect, Select, showToast, TextInput, Tooltip, useCallback, useMemo, useRef, useState } from "@webpack/common";
import { JSX } from "react";

import Plugins, { ExcludedPlugins, PluginMeta } from "~plugins";

import { PluginCard } from "./PluginCard";
import { openWarningModal } from "./PluginModal";
import { StockPluginsCard, UserPluginsCard } from "./PluginStatCards";
import { UIElementsButton } from "./UIElements";

export const cl = classNameFactory("vc-plugins-");
export const logger = new Logger("PluginSettings", "#a6d189");

function showErrorToast(message: string) {
    showToast({
        text: message,
        variant: "critical",
        position: "bottom"
    });
}

function ReloadRequiredCard({ required, enabledPlugins, bulkCategories, disablePlugins, openWarningModal }) {
    const [category, setCategory] = useState("all");
    const effective = category === "all" || bulkCategories.some(c => c.value === category) ? category : "all";
    const selectedCat = bulkCategories.find(c => c.value === effective);
    const target = effective === "all" ? enabledPlugins : selectedCat!.plugins;
    
    const warningTarget = effective === "all" 
        ? `all ${target.length}` 
        : `${target.length} ${selectedCat!.label}`;

    return (
        <Card 
            className={classes(cl("info-card"), required && "vc-warning-card")}
            style={{ transform: "none" }}
        >
            {required ? (
                <>
                    <Heading tag="h4">Restart required!</Heading>
                    <Paragraph className={cl("dep-text")}>
                        Restart now to apply new plugins and their settings
                    </Paragraph>
                    <Button variant="primary" className={cl("restart-button")} onClick={() => location.reload()}>
                        Restart
                    </Button>
                </>
            ) : (
                <>
                    <Heading tag="h4">Plugin Management</Heading>
                    <Paragraph>Press the cog wheel or info icon to get more info on a plugin</Paragraph>
                    <Paragraph>Plugins with a cog wheel have settings you can modify!</Paragraph>
                </>
            )}
            {enabledPlugins.length > 0 && !required && (
                <div style={{ display: "flex", gap: 8, marginTop: 8, alignItems: "center" }}>
                    <div style={{ flex: 1 }}>
                        <Select
                            options={[
                                { label: `All (${enabledPlugins.length})`, value: "all" },
                                ...bulkCategories.map(c => ({ label: `${c.label} (${c.plugins.length})`, value: c.value }))
                            ]}
                            serialize={String}
                            select={setCategory}
                            isSelected={v => v === effective}
                            closeOnSelect
                        />
                    </div>
                    <Button
                        variant="dangerPrimary"
                        size="small"
                        onClick={() => openWarningModal(null, undefined, false, warningTarget as any, () => disablePlugins(target))}
                    >
                        Disable
                    </Button>
                </div>
            )}
        </Card>
    );
}

const enum SearchStatus {
    ALL,
    FAVORITES,
    ENABLED,
    DISABLED,
    VENCORD,
    VENCORD_ENABLED,
    VENCORD_DISABLED,
    EQUICORD,
    EQUICORD_ENABLED,
    EQUICORD_DISABLED,
    TRASHCORD,
    TRASHCORD_ENABLED,
    TRASHCORD_DISABLED,
    NEW,
    API_PLUGINS
}

export const ExcludedReasons: Record<PluginTarget, string> = {
    desktop: "Discord Desktop app or Vesktop/Equibop",
    discordDesktop: "Discord Desktop app",
    vesktop: "Vesktop/Equibop apps",
    equibop: "Vesktop/Equibop apps",
    web: "Vesktop/Equibop apps & Discord web",
    dev: "Developer version of Equicord",
    browser: "Web Browser version of Equicord"
};

function ExcludedPluginsList({ search }: { search: string; }) {
    const matchingExcludedPlugins = search
        ? Object.entries(ExcludedPlugins)
            .filter(([name]) => name.toLowerCase().includes(search))
        : [];

    return (
        <Paragraph className={Margins.top16}>
            {matchingExcludedPlugins.length
                ? <>
                    <Paragraph>Are you looking for:</Paragraph>
                    <ul>
                        {matchingExcludedPlugins.map(([name, reason]) => (
                            <li key={name}>
                                <b>{name}</b>: Only available on the {ExcludedReasons[reason]}
                            </li>
                        ))}
                    </ul>
                </>
                : "No plugins meet the search criteria."
            }
        </Paragraph>
    );
}

export default function PluginSettings() {
    const settings = useSettings();
    const changeRef = useRef<ChangeList<string>>(null);
    const changes = changeRef.current ??= new ChangeList<string>();

    useCleanupEffect(() => {
        return () => {
            if (!changes.hasChanges) return;

            const allChanges = [...changes.getChanges()];
            const pluginNames = [...new Set(allChanges.map(s => s.split(":")[0]))];
            const maxDisplay = 15;
            const displayed = pluginNames.slice(0, maxDisplay);
            const remainingCount = pluginNames.length - displayed.length;

            promptToRestart("reload", {
                children: <>
                    <p>The following plugins require a restart:</p>
                    <div>
                        {displayed.map((s, i) => (
                            <React.Fragment key={i}>
                                {i > 0 && ", "}
                                {Parser.parse("`" + s + "`")}
                            </React.Fragment>
                        ))}
                        {remainingCount > 0 && <span> and {remainingCount} more</span>}
                    </div>
                </>
            });
        };
    }, []);

    const depMap = useMemo(() => {
        const o = {} as Record<string, string[]>;
        for (const plugin in Plugins) {
            const deps = Plugins[plugin].dependencies;
            if (deps) {
                for (const dep of deps) {
                    o[dep] ??= [];
                    o[dep].push(plugin);
                }
            }
        }
        return o;
    }, []);

    const sortedPlugins = useMemo(() =>
        Object.values(Plugins).sort((a, b) => a.name.localeCompare(b.name)),
        []
    )
        .toSorted((a, b) => Number(settings.plugins[b.name]?.isFavorite ?? false) - Number(settings.plugins[a.name]?.isFavorite ?? false));

    const hasUserPlugins = useMemo(() => !IS_STANDALONE && Object.values(PluginMeta).some(m => m.userPlugin), []);
    const hasTcFolder = Object.values(PluginMeta).some(m => m.folderName.startsWith("src/trashcordplugins/"));

    const [searchValue, setSearchValue] = useState<{ value: string; tags: PluginTag[]; status: number; author: string; }>({ value: "", tags: [] as PluginTag[], status: SearchStatus.ALL, author: "" });

    const search = searchValue.value.toLowerCase();
    const onSearch = (query: string) => setSearchValue(prev => ({ ...prev, value: query }));

    const authorOptions = useMemo(() => {
        const authors = new Map<string, { category: string; github: string; }>();
        
        for (const plugin of sortedPlugins) {
            for (const author of (plugin.authors || [])) {
                if (!author || !author.name) continue;
                
                const name = author.name;
                const id = author.id ? String(author.id) : "";
                const authorGithub = (author as any).github;

                const findDev = (devs: any, devsById: any) => {
                    if (id && devsById[id]) return devsById[id];
                    return Object.values(devs).find((d: any) => d.name === name || (authorGithub && d.github === authorGithub));
                };

                let category = "Other Devs";
                let resolvedGithub = authorGithub;

                const devLists = [
                    { name: "TrashCord Devs", devs: TrashCordDevs, byId: TrashCordDevsById },
                    { name: "Illegalcord Devs", devs: IllegalcordDevs, byId: IllegalcordDevsById },
                    { name: "Testcord Devs", devs: TestcordDevs, byId: TestcordDevsById },
                    { name: "Nightcord Devs", devs: NightcordDevs, byId: NightcordDevsById },
                    { name: "Equicord Devs", devs: EquicordDevs, byId: EquicordDevsById },
                    { name: "Vencord Devs", devs: Devs, byId: VencordDevsById }
                ];

                for (const list of devLists) {
                    const found = findDev(list.devs, list.byId) as any;
                    if (found) {
                        category = list.name;
                        if (found.github) resolvedGithub = found.github;
                        break;
                    }
                }

                if (!authors.has(name)) {
                    authors.set(name, { category, github: resolvedGithub });
                }
            }
        }
        
        const grouped: Record<string, string[]> = {};
        for (const [name, info] of authors.entries()) {
            if (!grouped[info.category]) grouped[info.category] = [];
            grouped[info.category].push(name);
        }
        
        const result: Array<{ label: string; value: string; github: string; }> = [];
        const order = ["TrashCord Devs", "Illegalcord Devs", "Testcord Devs", "Nightcord Devs", "Equicord Devs", "Vencord Devs", "Other Devs"];
        
        for (const cat of order) {
            const names = grouped[cat];
            if (!names || !names.length) continue;
            for (const name of names.sort()) {
                const info = authors.get(name)!;
                result.push({ label: `${name} (${cat})`, value: name, github: info.github });
            }
        }
        
        return result;
    }, [sortedPlugins]);

    const pluginFilter = useCallback((plugin: typeof Plugins[keyof typeof Plugins], newPluginsSet: Set<string> | null) => {
        const { status, tags } = searchValue;

        const isEnabled = isPluginEnabled(plugin.name);
        const meta = PluginMeta[plugin.name];
        const folder = meta?.folderName || "";
        
        const isUserPluginFolder = folder.startsWith("src/userplugins/");
        const isTrashCord = hasTcFolder 
            ? folder.startsWith("src/trashcordplugins/") 
            : (isUserPluginFolder || !!meta?.userPlugin);

        const isEquicord = folder.startsWith("src/equicordplugins/");
        const isVencord = folder.startsWith("src/plugins/");

        switch (status) {
            case SearchStatus.FAVORITES: if (!settings.plugins[plugin.name]?.isFavorite) return false; break;
            case SearchStatus.DISABLED: if (isEnabled) return false; break;
            case SearchStatus.ENABLED: if (!isEnabled) return false; break;
            
            case SearchStatus.VENCORD: if (!isVencord) return false; break;
            case SearchStatus.VENCORD_ENABLED: if (!isVencord || !isEnabled) return false; break;
            case SearchStatus.VENCORD_DISABLED: if (!isVencord || isEnabled) return false; break;
            
            case SearchStatus.EQUICORD: if (!isEquicord) return false; break;
            case SearchStatus.EQUICORD_ENABLED: if (!isEquicord || !isEnabled) return false; break;
            case SearchStatus.EQUICORD_DISABLED: if (!isEquicord || isEnabled) return false; break;
            
            case SearchStatus.TRASHCORD: if (!isTrashCord) return false; break;
            case SearchStatus.TRASHCORD_ENABLED: if (!isTrashCord || !isEnabled) return false; break;
            case SearchStatus.TRASHCORD_DISABLED: if (!isTrashCord || isEnabled) return false; break;
            
            case SearchStatus.NEW: if (!newPluginsSet?.has(plugin.name)) return false; break;
            case SearchStatus.API_PLUGINS: if (!plugin.name.endsWith("API")) return false; break;
        }

        if (tags.length && tags.some(t => !plugin.tags?.includes(t))) return false;
        if (searchValue.author && !plugin.authors?.some(a => a?.name === searchValue.author)) return false;
        if (!search.length) return true;

        return (
            plugin.name.toLowerCase().includes(search.replace(/\s+/g, "")) ||
            plugin.name.match(/[A-Z]/g)?.join("").toLowerCase().includes(search) || 
            plugin.description.toLowerCase().includes(search) ||
            plugin.searchTerms?.some(t => t.toLowerCase().includes(search))
        );
    }, [searchValue, search, hasTcFolder, settings.plugins]);

    const [newPluginsSet] = useAwaiter(() => DataStore.get("Vencord_existingPlugins").then((cachedPlugins: Record<string, number> | undefined) => {
        const now = Date.now() / 1000;
        const existingTimestamps: Record<string, number> = {};
        const sortedPluginNames = Object.values(sortedPlugins).map(plugin => plugin.name);

        const newPlugins: string[] = [];
        for (const { name: p } of sortedPlugins) {
            const time = existingTimestamps[p] = cachedPlugins?.[p] ?? now;
            if ((time + 60 * 60 * 24 * 2) > now) {
                newPlugins.push(p);
            }
        }
        DataStore.set("Vencord_existingPlugins", existingTimestamps);

        return lodash.isEqual(newPlugins, sortedPluginNames) ? null : new Set(newPlugins);
    }));

    const handleRestartNeeded = useCallback((name: string, key: string) => changes.handleChange(`${name}:${key}`), [changes]);

    const { plugins, requiredPlugins } = useMemo(() => {
        const plugins = [] as JSX.Element[];
        const requiredPlugins = [] as JSX.Element[];

        const showApi = searchValue.status === SearchStatus.API_PLUGINS;
        for (const p of sortedPlugins) {
            if (p.hidden || (!p.settings?.def && p.name.endsWith("API") && !showApi))
                continue;

            if (!pluginFilter(p, newPluginsSet)) continue;

            const isRequired = p.required || p.isDependency || depMap[p.name]?.some(d => settings.plugins[d].enabled);

            if (isRequired) {
                const tooltipText = p.required || !depMap[p.name]
                    ? "This plugin is required for Equicord to function."
                    : <PluginDependencyList deps={depMap[p.name]?.filter(d => settings.plugins[d].enabled)} />;

                requiredPlugins.push(
                    <Tooltip text={tooltipText} key={p.name}>
                        {({ onMouseLeave, onMouseEnter }) => (
                            <PluginCard
                                onMouseLeave={onMouseLeave}
                                onMouseEnter={onMouseEnter}
                                onRestartNeeded={handleRestartNeeded}
                                disabled={true}
                                plugin={p}
                            />
                        )}
                    </Tooltip>
                );
            } else {
                plugins.push(
                    <PluginCard
                        onRestartNeeded={handleRestartNeeded}
                        disabled={false}
                        plugin={p}
                        isNew={newPluginsSet?.has(p.name)}
                        key={p.name}
                    />
                );
            }
        }
        return { plugins, requiredPlugins };
    }, [sortedPlugins, searchValue, newPluginsSet, depMap, settings.plugins, pluginFilter, handleRestartNeeded]);

    function disablePlugins(pluginsToDisable: string[]) {
        let restartNeeded = false;

        for (const plugin of pluginsToDisable) {
            const pluginSettings = settings.plugins[plugin];

            if (Plugins[plugin].patches?.length) {
                pluginSettings.enabled = false;
                changes.handleChange(plugin);
                restartNeeded = true;
                continue;
            }

            const result = stopPlugin(Plugins[plugin]);

            if (!result) {
                logger.error(`Error while stopping plugin ${plugin}`);
                showErrorToast(`Error while stopping plugin ${plugin}`);
                continue;
            }

            pluginSettings.enabled = false;
        }

        if (restartNeeded) {
            Alerts.show({
                title: "Restart Required",
                body: (
                    <>
                        <p style={{ textAlign: "center" }}>Some plugins require a restart to fully disable.</p>
                        <p style={{ textAlign: "center" }}>Would you like to restart now?</p>
                    </>
                ),
                confirmText: "Restart Now",
                cancelText: "Later",
                onConfirm: () => location.reload()
            });
        }
    }

    const { totalStockPlugins, totalUserPlugins, enabledStockPlugins, enabledUserPlugins, enabledPlugins } = useMemo(() => {
        const isApiPlugin = (plugin: string) => plugin.endsWith("API") || Plugins[plugin].required;

        const totalPlugins = Object.keys(Plugins).filter(p => !isApiPlugin(p));
        const enabledPlugins = Object.keys(Plugins).filter(p => isPluginEnabled(p) && !isApiPlugin(p));

        const totalStockPlugins = totalPlugins.filter(p => !PluginMeta[p].userPlugin && !Plugins[p].hidden).length;
        const totalUserPlugins = totalPlugins.filter(p => PluginMeta[p].userPlugin).length;
        const enabledStockPlugins = enabledPlugins.filter(p => !PluginMeta[p].userPlugin).length;
        const enabledUserPlugins = enabledPlugins.filter(p => PluginMeta[p].userPlugin).length;
        return { totalStockPlugins, totalUserPlugins, enabledStockPlugins, enabledUserPlugins, enabledPlugins };
    }, [settings.plugins]);

    const bulkCategories = (() => {
        const labelMap: Record<string, string> = {
            equicordplugins: "Equicord",
            plugins: "Vencord",
            trashcordplugins: "TrashCord",
            userplugins: hasTcFolder ? "User" : "TrashCord",
        };

        const buckets = new Map<string, string[]>();
        for (const p of enabledPlugins) {
            const m = PluginMeta[p]?.folderName?.match(/^src\/([^/]+)\//);
            if (!m) continue;
            const prefix = m[1];
            if (!buckets.has(prefix)) buckets.set(prefix, []);
            buckets.get(prefix)!.push(p);
        }

        const categories = Array.from(buckets, ([prefix, plugins]) => ({
            label: labelMap[prefix] ?? prefix.charAt(0).toUpperCase() + prefix.slice(1),
            value: prefix,
            plugins,
        }));

        const order = ["Vencord", "Equicord", "TrashCord", "User"];
        categories.sort((a, b) => {
            const ai = order.indexOf(a.label), bi = order.indexOf(b.label);
            if (ai !== -1 && bi !== -1) return ai - bi;
            if (ai !== -1) return -1;
            if (bi !== -1) return 1;
            return a.label.localeCompare(b.label);
        });

        return categories.filter(c => c.plugins.length > 0);
    })();

    const pluginsToLoad = Math.min(36, plugins.length);
    const [visibleCount, setVisibleCount] = React.useState(pluginsToLoad);
    const loadMore = React.useCallback(() => {
        setVisibleCount(v => Math.min(v + pluginsToLoad, plugins.length));
    }, [plugins.length]);

    const dLoadMore = useMemo(() => debounce(loadMore, 100), [loadMore]);

    const [sentinelRef, isSentinelVisible] = useIntersection();
    React.useEffect(() => {
        if (isSentinelVisible && visibleCount < plugins.length) {
            dLoadMore();
        }
    }, [isSentinelVisible, visibleCount, plugins.length, dLoadMore]);

    const visiblePlugins = plugins.slice(0, visibleCount);

    const selectedAuthor = authorOptions.find(a => a.value === searchValue.author);
    const authorGithub = selectedAuthor?.github
        ? (selectedAuthor.github.startsWith("http") ? selectedAuthor.github : "https://github.com/" + selectedAuthor.github)
        : "";

    return (
        <SettingsTab>
            <ReloadRequiredCard required={changes.hasChanges} enabledPlugins={enabledPlugins} bulkCategories={bulkCategories} disablePlugins={disablePlugins} openWarningModal={openWarningModal} />

            <div className={cl("stats-container")}>
                <StockPluginsCard
                    totalStockPlugins={totalStockPlugins}
                    enabledStockPlugins={enabledStockPlugins}
                />
                <UserPluginsCard
                    totalUserPlugins={totalUserPlugins}
                    enabledUserPlugins={enabledUserPlugins}
                />
            </div>

            <div className={cl("ui-elements")}>
                <UIElementsButton />
            </div>

            <Heading tag="h4" className={classes(Margins.top20, Margins.bottom8)}>
                Filters
            </Heading>

            <ErrorBoundary noop>
                <TextInput
                    inputClassName={cl("filter-control")}
                    placeholder="Search for a plugin..."
                    value={searchValue.value}
                    onChange={onSearch}
                    autoFocus
                />
            </ErrorBoundary>

            <ErrorBoundary noop>
                <div className={classes(Margins.bottom20, Margins.top8)} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        <div style={{ flex: 1, minWidth: "200px" }}>
                            <Select
                                options={[
                                    { label: "Show All", value: SearchStatus.ALL, default: true },
                                    { label: "Show Favorites", value: SearchStatus.FAVORITES },
                                    { label: "Show Enabled (All)", value: SearchStatus.ENABLED },
                                    { label: "Show Disabled (All)", value: SearchStatus.DISABLED },
                                    { label: "Show Vencord (All)", value: SearchStatus.VENCORD },
                                    { label: "Show Vencord (Enabled)", value: SearchStatus.VENCORD_ENABLED },
                                    { label: "Show Vencord (Disabled)", value: SearchStatus.VENCORD_DISABLED },
                                    { label: "Show Equicord (All)", value: SearchStatus.EQUICORD },
                                    { label: "Show Equicord (Enabled)", value: SearchStatus.EQUICORD_ENABLED },
                                    { label: "Show Equicord (Disabled)", value: SearchStatus.EQUICORD_DISABLED },
                                    { label: "Show TrashCord (All)", value: SearchStatus.TRASHCORD },
                                    { label: "Show TrashCord (Enabled)", value: SearchStatus.TRASHCORD_ENABLED },
                                    { label: "Show TrashCord (Disabled)", value: SearchStatus.TRASHCORD_DISABLED },
                                    { label: "Show New", value: SearchStatus.NEW },
                                    { label: "Show API Plugins", value: SearchStatus.API_PLUGINS },
                                ].filter(isTruthy)}
                                serialize={String}
                                select={status => setSearchValue(prev => ({ ...prev, status }))}
                                isSelected={v => v === searchValue.status}
                                closeOnSelect={true}
                                placeholder="Filter by Type"
                                maxVisibleItems={10}
                            />
                        </div>
                        <div style={{ flex: 1, minWidth: "200px" }}>
                            <SearchableSelect
                                options={PluginTags.map(tag => ({ label: tag, value: tag }))}
                                value={searchValue.tags}
                                onChange={tags => setSearchValue(prev => ({ ...prev, tags }))}
                                closeOnSelect={false}
                                placeholder="Filter by Tags"
                                multi
                            />
                        </div>
                    </div>
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                        <div style={{ flex: 1, minWidth: "200px" }}>
                            <SearchableSelect
                                options={[{ label: "All Authors", value: "" }, ...authorOptions]}
                                value={searchValue.author}
                                onChange={v => setSearchValue(prev => ({ ...prev, author: v ?? "" }))}
                                closeOnSelect={true}
                                placeholder="Filter by Author"
                            />
                        </div>
                        {searchValue.author && authorGithub && (
                            <a
                                href={authorGithub}
                                target="_blank"
                                rel="noreferrer"
                                style={{ display: "flex", alignItems: "center", gap: "4px", color: "var(--text-link)", fontSize: "14px", textDecoration: "none", whiteSpace: "nowrap" }}
                            >
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z" /></svg>
                                {selectedAuthor!.github.replace(/^https?:\/\/github\.com\//, "")}
                            </a>
                        )}
                    </div>
                </div>
            </ErrorBoundary>

            <Heading tag="h4" className={Margins.top20}>Plugins</Heading>

            {plugins.length || requiredPlugins.length
                ? (
                    <>
                        <div className={cl("grid")}>
                            {visiblePlugins.length
                                ? visiblePlugins
                                : <Paragraph>No plugins meet the search criteria.</Paragraph>
                            }
                        </div>
                        {visibleCount < plugins.length && (
                            <div ref={sentinelRef} style={{ height: 32 }} />
                        )}
                    </>
                )
                : <ExcludedPluginsList search={search} />
            }

            <Divider className={Margins.top20} />

            <Heading tag="h4" className={classes(Margins.top20, Margins.bottom8)}>
                Required Plugins
            </Heading>

            <div className={cl("grid")}>
                {requiredPlugins.length
                    ? requiredPlugins
                    : <Paragraph>No plugins meet the search criteria.</Paragraph>
                }
            </div>
        </SettingsTab >
    );
}

export function PluginDependencyList({ deps }: { deps: string[]; }) {
    return (
        <>
            <Paragraph>This plugin is required by:</Paragraph>
            {deps.map((dep: string) => <Paragraph key={dep} className={cl("dep-text")}>{dep}</Paragraph>)}
        </>
    );
}