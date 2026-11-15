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
import { remainingText, statusText, useFarmerStatus, useLiveInfo } from "./ui";

type IconProps = { className?: string; width?: number | string; height?: number | string; color?: string; };

const PAD = "M17 5H7a5 5 0 0 0-5 5v4a3 3 0 0 0 5.2 2l1.3-1.5h7l1.3 1.5A3 3 0 0 0 22 14v-4a5 5 0 0 0-5-5zM9 11H8v1H7v-1H6v-1h1V9h1v1h1v1zm6.5.5a1 1 0 1 1 0-2 1 1 0 0 1 0 2zm2 2a1 1 0 1 1 0-2 1 1 0 0 1 0 2z";

export function IconIdle({ className, width = 24, height = 24, color }: IconProps) {
    return (
        <svg className={className} width={width} height={height} viewBox="0 0 24 24" aria-hidden="true">
            <path fill={color ?? "currentColor"} d={PAD} />
        </svg>
    );
}

function busyIcon(dot: string) {
    return function BusyIcon({ className, width = 24, height = 24, color }: IconProps) {
        return (
            <svg className={className} width={width} height={height} viewBox="0 0 24 24" aria-hidden="true">
                <path fill={color ?? "currentColor"} d={PAD} />
                <circle cx="19" cy="5" r="4" fill={dot} />
            </svg>
        );
    };
}

export const IconBusy = busyIcon("var(--text-positive, #23a55a)");

const BUSY_ICONS: Record<string, typeof IconIdle> = {
    GAME_TIME: busyIcon("#e09400"),
    VARIETY: busyIcon("#1fb85a"),
    STREAM: busyIcon("#e8478b"),
    MAX_ALL: busyIcon("#5865f2")
};

function openSettings() {
    const plugin = (Vencord.Plugins.plugins as any).BadgeFarmer;
    if (plugin) openPluginModal(plugin);
}

function FarmerMenu() {
    const status = useFarmerStatus();
    const info = useLiveInfo();
    const busy = status.mode !== "IDLE";
    const eta = busy ? remainingText(status) : null;
    const mark = (ok: boolean) => (ok ? "\u2713" : "\u2717");

    return (
        <Menu.Menu navId="badge-farmer-menu" onClose={ContextMenuApi.closeContextMenu} aria-label="Badge Farmer">
            <Menu.MenuItem id="bf-status" label={statusText(status)} disabled />
            {eta != null && <Menu.MenuItem id="bf-eta" label={`\u23F1 ${eta}`} disabled />}
            <Menu.MenuItem id="bf-live" label={t("menuLive", { v: mark(info.inVoice), l: mark(info.live), n: info.viewers })} disabled />
            <Menu.MenuSeparator />
            {busy && <Menu.MenuItem id="bf-stop" label={`\u25A0 ${t("stop")}`} color="danger" action={() => Farmer.stop()} />}
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
        const eta = busy ? remainingText(status) : null;

        return (
            <HeaderBarButton
                icon={busy ? (BUSY_ICONS[status.mode] ?? IconBusy) : IconIdle}
                tooltip={`${t("hdrTitle")}: ${statusText(status)}${eta != null ? ` \u00B7 ${eta}` : ""}`}
                onClick={e => ContextMenuApi.openContextMenu(e, () => <FarmerMenu />)}
            />
        );
    };
}
