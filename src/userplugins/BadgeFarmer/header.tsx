/*
 * TrashCord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { HeaderBarButton } from "@api/HeaderBar";
import { openPluginModal } from "@components/settings";
import { ContextMenuApi, Menu } from "@webpack/common";
import type { JSX } from "react";

import * as Farmer from "./farmer";
import { t } from "./i18n";
import { loadCatalogue, statusText, useFarmerStatus, useLiveInfo } from "./ui";

type IconProps = { className?: string; width?: number | string; height?: number | string; color?: string; };

const PAD = "M17 5H7a5 5 0 0 0-5 5v4a3 3 0 0 0 5.2 2l1.3-1.5h7l1.3 1.5A3 3 0 0 0 22 14v-4a5 5 0 0 0-5-5zM9 11H8v1H7v-1H6v-1h1V9h1v1h1v1zm6.5.5a1 1 0 1 1 0-2 1 1 0 0 1 0 2zm2 2a1 1 0 1 1 0-2 1 1 0 0 1 0 2z";

export function IconIdle({ className, width = 24, height = 24, color }: IconProps) {
    return (
        <svg className={className} width={width} height={height} viewBox="0 0 24 24" aria-hidden="true">
            <path fill={color ?? "currentColor"} d={PAD} />
        </svg>
    );
}

export function IconBusy({ className, width = 24, height = 24, color }: IconProps) {
    return (
        <svg className={className} width={width} height={height} viewBox="0 0 24 24" aria-hidden="true">
            <path fill={color ?? "currentColor"} d={PAD} />
            <circle cx="19" cy="5" r="4" fill="var(--text-positive, #23a55a)" />
        </svg>
    );
}

function openSettings() {
    const plugin = (Vencord.Plugins.plugins as any).BadgeFarmer;
    if (plugin) openPluginModal(plugin);
}

function startMaxAll() {
    loadCatalogue().then(
        apps => void Farmer.maxAll(apps),
        error => Farmer.notice(t("listErr", { e: String(error?.message ?? error) }), "warning")
    );
}

function FarmerMenu() {
    const status = useFarmerStatus();
    const info = useLiveInfo();
    const busy = status.mode !== "IDLE";
    const mark = (ok: boolean) => (ok ? "\u2713" : "\u2717");

    return (
        <Menu.Menu navId="badge-farmer-menu" onClose={ContextMenuApi.closeContextMenu} aria-label="Badge Farmer">
            <Menu.MenuItem id="bf-status" label={statusText(status)} disabled />
            <Menu.MenuItem id="bf-live" label={t("menuLive", { v: mark(info.inVoice), l: mark(info.live), n: info.viewers })} disabled />
            <Menu.MenuSeparator />
            {busy
                ? <Menu.MenuItem id="bf-stop" label={`\u25A0 ${t("stop")}`} color="danger" action={() => Farmer.stop()} />
                : <Menu.MenuItem id="bf-maxall" label={t("maxAll")} action={startMaxAll} disabled={Farmer.isLocked()} />}
            <Menu.MenuItem id="bf-settings" label={t("hdrSettings")} action={openSettings} />
        </Menu.Menu>
    );
}

export function createHeaderButton(useVisible: () => boolean) {
    return function HeaderButton(): JSX.Element | null {
        const visible = useVisible();
        const status = useFarmerStatus();
        if (!visible) return null;

        const busy = status.mode !== "IDLE";

        return (
            <HeaderBarButton
                icon={busy ? IconBusy : IconIdle}
                tooltip={`${t("hdrTitle")}: ${statusText(status)}`}
                onClick={e => ContextMenuApi.openContextMenu(e, () => <FarmerMenu />)}
            />
        );
    };
}
