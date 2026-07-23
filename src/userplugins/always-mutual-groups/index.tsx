/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import managedStyle from "./style.css?managed";

import definePlugin from "@utils/types";
import { Channel } from "@vencord/discord-types";
import { findByPropsLazy } from "@webpack";
import { ChannelStore, closeAllModals, IconUtils, NavigationRouter, RelationshipStore, UserProfileActions, UserStore } from "@webpack/common";

const UserUtils = findByPropsLazy("getGlobalName");

const TAB_CLASS = "vc-always-mutual-groups-dom-tab";
const PANEL_CLASS = "vc-always-mutual-groups-dom-panel";
const POPOUT_CLASS = "vc-always-mutual-groups-popout-section";
const ROW_CLASS = "vc-always-mutual-groups-row";

let observer: MutationObserver | null = null;
let decorateScheduled = false;
let activeProfileUserId: string | null = null;
const selectedTabClasses = new Set<string>();

function getMutualGroupDms(userId: string) {
    return ChannelStore.getSortedPrivateChannels()
        .filter(channel => channel.isGroupDM() && channel.recipients.includes(userId));
}

function getGroupDMName(channel: Channel) {
    return channel.name
        || channel.recipients
            .map(UserStore.getUser)
            .filter(Boolean)
            .map(user => RelationshipStore.getNickname(user!.id) || UserUtils.getName(user))
            .join(", ");
}

function getProfileUserIdFromReact(root: Element) {
    const fiberKey = Object.keys(root).find(key => key.startsWith("__reactFiber$"));
    let fiber = fiberKey ? (root as any)[fiberKey] : null;

    while (fiber) {
        const props = fiber.memoizedProps ?? fiber.pendingProps;
        const candidates = [
            props?.user?.id,
            props?.profile?.user?.id,
            props?.displayProfile?.userId,
            props?.userId
        ];
        const userId = candidates.find(candidate => typeof candidate === "string" && /^\d{17,20}$/.test(candidate));
        if (userId) return userId as string;
        fiber = fiber.return;
    }

    return null;
}

function getProfileUserId(root: Element) {
    const avatar = root.querySelector<HTMLImageElement>('img[src*="/avatars/"]');
    return avatar?.src.match(/\/avatars\/(\d{17,20})\//)?.[1] ?? getProfileUserIdFromReact(root);
}

function shouldDecorate(userId: string) {
    const user = UserStore.getUser(userId);
    return userId !== UserStore.getCurrentUser()?.id && !user?.bot;
}

function countLabel(count: number) {
    return `${count === 0 ? "No" : count} Mutual Group${count === 1 ? "" : "s"}`;
}

function handleGroupClick(event: MouseEvent) {
    const row = (event.target as Element | null)?.closest<HTMLElement>(`.${ROW_CLASS}`);
    const channelId = row?.dataset.channelId;
    if (!channelId) return;

    event.preventDefault();
    event.stopPropagation();
    activeProfileUserId = null;
    UserProfileActions.closeUserProfileModal();
    NavigationRouter.transitionTo(`/channels/@me/${channelId}`);
    closeAllModals();
}

function buildGroupPanel(nativePanel: HTMLElement, groups: Channel[]) {
    const panel = document.createElement("div");
    panel.className = `${nativePanel.className} ${PANEL_CLASS}`;
    panel.id = "vc-always-mutual-groups-panel";
    panel.setAttribute("role", "tabpanel");
    panel.setAttribute("aria-label", "Mutual Groups");
    panel.hidden = true;

    const heading = document.createElement("h2");
    heading.className = "vc-always-mutual-groups-heading";
    heading.textContent = "Mutual Groups";
    panel.append(heading);

    const list = document.createElement("div");
    list.className = "vc-always-mutual-groups-list";
    panel.append(list);

    if (groups.length === 0) {
        const empty = document.createElement("div");
        empty.className = "vc-always-mutual-groups-empty";
        empty.textContent = "You don't have any group chats in common";
        list.append(empty);
        return panel;
    }

    for (const channel of groups) {
        const row = document.createElement("button");
        row.className = ROW_CLASS;
        row.dataset.channelId = channel.id;
        row.type = "button";

        const icon = document.createElement("img");
        icon.className = "vc-always-mutual-groups-icon";
        icon.alt = "";
        icon.src = IconUtils.getChannelIconURL({ id: channel.id, icon: channel.icon, size: 40 }) ?? "";
        row.append(icon);

        const details = document.createElement("span");
        details.className = "vc-always-mutual-groups-details";

        const name = document.createElement("span");
        name.className = "vc-always-mutual-groups-name";
        name.textContent = getGroupDMName(channel);
        details.append(name);

        const members = document.createElement("span");
        members.className = "vc-always-mutual-groups-members";
        members.textContent = `${channel.recipients.length + 1} Members`;
        details.append(members);
        row.append(details);

        list.append(row);
    }

    return panel;
}

function syncFullProfileState(root: HTMLElement, userId: string) {
    const tabList = root.querySelector<HTMLElement>('[role="tablist"]');
    const tab = tabList?.querySelector<HTMLElement>(`.${TAB_CLASS}`);
    const panel = root.querySelector<HTMLElement>(`.${PANEL_CLASS}`);
    if (!tabList || !tab || !panel) return;

    const nativeTabs = Array.from(tabList.querySelectorAll<HTMLElement>(`[role="tab"]:not(.${TAB_CLASS})`));
    const nativePanels = Array.from(panel.parentElement?.querySelectorAll<HTMLElement>(`:scope > [role="tabpanel"]:not(.${PANEL_CLASS})`) ?? []);
    const selectedNativeTab = nativeTabs.find(nativeTab => nativeTab.getAttribute("aria-selected") === "true");
    const unselectedNativeTab = nativeTabs.find(nativeTab => nativeTab.getAttribute("aria-selected") !== "true");
    if (selectedNativeTab && unselectedNativeTab) {
        Array.from(selectedNativeTab.classList)
            .filter(className => !unselectedNativeTab.classList.contains(className))
            .forEach(className => selectedTabClasses.add(className));
    }

    const isActive = activeProfileUserId === userId;
    tab.setAttribute("aria-selected", String(isActive));
    tab.tabIndex = isActive ? 0 : -1;
    tab.classList.toggle(TAB_CLASS, true);
    for (const className of selectedTabClasses) tab.classList.toggle(className, isActive);

    panel.hidden = !isActive;
    panel.style.display = isActive ? "" : "none";

    if (isActive) {
        for (const nativeTab of nativeTabs) {
            nativeTab.setAttribute("aria-selected", "false");
            nativeTab.tabIndex = -1;
            for (const className of selectedTabClasses) nativeTab.classList.remove(className);
        }
        nativePanels.forEach(nativePanel => nativePanel.style.display = "none");
    } else {
        nativePanels.forEach(nativePanel => nativePanel.style.removeProperty("display"));
    }
}

function decorateFullProfile(root: HTMLElement) {
    const tabList = root.querySelector<HTMLElement>('[role="tablist"]');
    if (!tabList) return;

    const userId = getProfileUserId(root);
    if (!userId || !shouldDecorate(userId)) return;

    const existingTab = tabList.querySelector<HTMLElement>(`.${TAB_CLASS}`);
    const existingPanel = root.querySelector<HTMLElement>(`.${PANEL_CLASS}`);
    if (existingTab && existingPanel) {
        syncFullProfileState(root, userId);
        return;
    }

    existingTab?.remove();
    root.querySelectorAll(`.${PANEL_CLASS}`).forEach(stalePanel => stalePanel.remove());

    const nativeTabs = Array.from(tabList.querySelectorAll<HTMLElement>('[role="tab"]'));
    const nativePanel = tabList.parentElement?.parentElement?.querySelector<HTMLElement>(`:scope > [role="tabpanel"]:not(.${PANEL_CLASS})`);
    const container = nativePanel?.parentElement;
    const template = nativeTabs.at(-1);
    if (!container || !nativePanel || !template) return;

    const groups = getMutualGroupDms(userId);
    const tab = template.cloneNode(false) as HTMLElement;
    tab.className = template.className;
    tab.classList.add(TAB_CLASS);
    tab.textContent = countLabel(groups.length);
    tab.setAttribute("role", "tab");
    tab.setAttribute("aria-label", countLabel(groups.length));
    tab.setAttribute("aria-controls", "vc-always-mutual-groups-panel");
    tab.setAttribute("aria-selected", "false");
    tab.tabIndex = -1;

    const selectedTab = nativeTabs.find(nativeTab => nativeTab.getAttribute("aria-selected") === "true");
    if (selectedTab) {
        Array.from(selectedTab.classList)
            .filter(className => !template.classList.contains(className))
            .forEach(className => selectedTabClasses.add(className));
    }
    const panel = buildGroupPanel(nativePanel, groups);

    const showNativePanel = (event: Event) => {
        activeProfileUserId = null;
        const selectedTab = event.currentTarget as HTMLElement;
        for (const nativeTab of nativeTabs) {
            const isSelected = nativeTab === selectedTab;
            nativeTab.setAttribute("aria-selected", String(isSelected));
            nativeTab.tabIndex = isSelected ? 0 : -1;
            for (const className of selectedTabClasses) nativeTab.classList.toggle(className, isSelected);
        }
        queueMicrotask(scheduleDecorate);
    };

    for (const nativeTab of nativeTabs) nativeTab.addEventListener("click", showNativePanel);

    tab.addEventListener("click", event => {
        event.preventDefault();
        event.stopPropagation();
        activeProfileUserId = userId;
        syncFullProfileState(root, userId);
    });

    tabList.append(tab);
    container.append(panel);
    syncFullProfileState(root, userId);
}

function decorateProfilePopout(root: HTMLElement) {
    if (root.querySelector(`.${POPOUT_CLASS}`)) return;

    const userId = getProfileUserId(root);
    if (!userId || !shouldDecorate(userId)) return;

    const sections = Array.from(root.querySelectorAll<HTMLElement>('[role="button"]'))
        .filter(section => /Mutual (Friends|Servers)/.test(section.textContent ?? ""));
    const template = sections.at(-1);
    const container = template?.parentElement;
    if (!template || !container) return;

    const groups = getMutualGroupDms(userId);
    const section = template.cloneNode(false) as HTMLElement;
    section.className = template.className;
    section.classList.add(POPOUT_CLASS);
    section.tabIndex = 0;

    const textTemplate = template.querySelector<HTMLElement>('[class*="text_"]');
    const text = textTemplate?.cloneNode(false) as HTMLElement | undefined ?? document.createElement("div");
    text.textContent = countLabel(groups.length);
    section.append(text);

    const openGroups = () => {
        const fullProfileButton = Array.from(root.querySelectorAll<HTMLElement>('button,[role="button"]'))
            .find(button => button.textContent?.includes("View Full Profile"));
        fullProfileButton?.click();

        let attempts = 0;
        const openTab = () => {
            const tab = document.querySelector<HTMLElement>(`.${TAB_CLASS}`);
            if (tab) tab.click();
            else if (attempts++ < 20) setTimeout(openTab, 50);
        };
        setTimeout(openTab, 50);
    };

    section.addEventListener("click", openGroups);
    section.addEventListener("keydown", event => {
        if (event.key === "Enter" || event.key === " ") openGroups();
    });
    container.append(section);
}

function decorateProfiles() {
    decorateScheduled = false;
    const fullProfiles = document.querySelectorAll<HTMLElement>(".user-profile-modal-v2");
    if (fullProfiles.length === 0) activeProfileUserId = null;
    fullProfiles.forEach(decorateFullProfile);
    document.querySelectorAll<HTMLElement>(".user-profile-sidebar").forEach(decorateProfilePopout);
}

function scheduleDecorate() {
    if (decorateScheduled) return;
    decorateScheduled = true;
    requestAnimationFrame(decorateProfiles);
}

export default definePlugin({
    name: "AlwaysMutualGroups",
    description: "Always shows mutual group DMs in profile popouts and full user profiles.",
    authors: [{ name: "Local User", id: 0n }],
    tags: ["Friends", "Utility"],
    enabledByDefault: false,
    managedStyle,
    requiresRestart: false,
    start() {
        document.addEventListener("click", handleGroupClick, true);
        observer = new MutationObserver(scheduleDecorate);
        observer.observe(document.documentElement, {
            attributeFilter: ["src"],
            attributes: true,
            childList: true,
            subtree: true
        });
        scheduleDecorate();
    },

    stop() {
        document.removeEventListener("click", handleGroupClick, true);
        observer?.disconnect();
        observer = null;
        activeProfileUserId = null;
        selectedTabClasses.clear();
        document.querySelectorAll(`.${TAB_CLASS}, .${PANEL_CLASS}, .${POPOUT_CLASS}`).forEach(element => element.remove());
    }
});
