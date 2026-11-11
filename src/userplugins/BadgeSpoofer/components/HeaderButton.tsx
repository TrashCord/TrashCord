/*
 * TrashCord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { HeaderBarButton } from "@api/HeaderBar";
import { Settings } from "@api/Settings";
import { ContextMenuApi, Menu, React, SelectedChannelStore, showToast } from "@webpack/common";

import { badgeSpooferEngine } from "../engine";
import { warnIfBlocked } from "./AnalyticsNotice";
import { openBadgeSpooferModal } from "./BadgeSpooferModal";

const cfg = () => (Settings.plugins as any).BadgeSpoofer;

const SHIELD = "M12 1 3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm-2 16-4-4 1.41-1.41L10 14.17l6.59-6.59L18 9l-8 8z";

const IdleIcon = ({ className, width = 24, height = 24 }: any) => (
    <svg className={className} width={width} height={height} viewBox="0 0 24 24" fill="currentColor">
        <path d={SHIELD} />
    </svg>
);

const RunIcon = ({ className, width = 24, height = 24 }: any) => (
    <svg className={className} width={width} height={height} viewBox="0 0 24 24" fill="var(--status-positive)">
        <path d={SHIELD} />
    </svg>
);

export function startBackground() {
    if (warnIfBlocked()) return;
    const c = cfg();
    const streamHours = c.defaultStreamHours ?? 1;
    if (streamHours > 0 && !(SelectedChannelStore as any).getVoiceChannelId?.())
        showToast({ text: "Join a voice channel or call, otherwise streamed hours will not count." });
    badgeSpooferEngine.startSpoofing({
        count: c.defaultGames || 0,
        hours: c.defaultHours ?? 1,
        streamHours,
        batchSize: c.batchSize || 50,
        batchDelay: c.batchDelay || 300,
        fingerprint: c.customFingerprint || undefined,
        onProgress: p => {
            if (!p.isRunning) showToast({ text: `Badge Spoofer finished: ${p.sent} games claimed.`, variant: "success" });
        }
    });
}

function BadgeMenu() {
    const c = cfg();
    const running = badgeSpooferEngine.getIsRunning();
    return (
        <Menu.Menu navId="badge-spoofer-menu" onClose={ContextMenuApi.closeContextMenu} aria-label="Badge Spoofer">
            <Menu.MenuItem
                id="bs-target"
                label={`Target: ${c.defaultGames || "all"} games - ${c.defaultHours ?? 1}h play - ${c.defaultStreamHours ?? 1}h stream`}
                disabled
            />
            {running
                ? <Menu.MenuItem id="bs-stop" label="Stop Spoofing" color="danger" action={() => badgeSpooferEngine.stopSpoofing()} />
                : <Menu.MenuItem id="bs-start" label="Start in Background" action={startBackground} />}
            <Menu.MenuSeparator />
            <Menu.MenuItem id="bs-open" label="Open Dashboard" action={openBadgeSpooferModal} />
        </Menu.Menu>
    );
}

export function BadgeSpooferHeaderButton() {
    React.useSyncExternalStore(badgeSpooferEngine.subscribe, badgeSpooferEngine.getVersion);
    const running = badgeSpooferEngine.getIsRunning();
    const p = badgeSpooferEngine.getProgress();
    return (
        <HeaderBarButton
            icon={running ? RunIcon : IdleIcon}
            tooltip={running && p ? `Badge Spoofer: ${p.sent}/${p.total}` : "Badge Spoofer"}
            selected={running}
            onClick={(e: React.UIEvent) => ContextMenuApi.openContextMenu(e, () => <BadgeMenu />)}
        />
    );
}
