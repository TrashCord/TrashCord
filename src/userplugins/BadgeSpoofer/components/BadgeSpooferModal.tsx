/*
 * TrashCord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Settings } from "@api/Settings";
import { ModalContent, ModalFooter, openModal } from "@utils/modal";
import type { RenderModalProps } from "@vencord/discord-types";
import { Button } from "@components/Button";
import { Heading } from "@components/Heading";
import { Paragraph } from "@components/Paragraph";
import { Text } from "@components/Text";
import { Modal, React, TextInput, showToast, useEffect, useRef, useState } from "@webpack/common";

import { badgeSpooferEngine } from "../engine";
import { HypeSquadPicker } from "../hypesquad";
import { AnalyticsNotice, warnIfBlocked } from "./AnalyticsNotice";

const cfg = () => (Settings.plugins as any).BadgeSpoofer;

const MAX_HOURS = 500;
const toHours = (v: string) => Math.min(MAX_HOURS, Math.max(0, Number(v) || 0));

function persistTargets(v: { hours: string; streamHours: string; gameCount: string; fingerprint: string; }) {
    const c = cfg();
    c.defaultHours = toHours(v.hours);
    c.defaultStreamHours = toHours(v.streamHours);
    c.defaultGames = Math.min(99999, Math.max(0, Math.floor(Number(v.gameCount)) || 0));
    const fp = v.fingerprint.trim();
    if (fp !== badgeSpooferEngine.getStats().fingerprint) badgeSpooferEngine.setFingerprint(fp);
}

export function BadgeSpooferModal({ modalProps }: { modalProps: RenderModalProps }) {
    const [hours, setHours] = useState(() => String(cfg().defaultHours ?? 1));
    const [streamHours, setStreamHours] = useState(() => String(cfg().defaultStreamHours ?? 1));
    const [gameCount, setGameCount] = useState(() => cfg().defaultGames ? String(cfg().defaultGames) : "");
    const [fingerprint, setFingerprint] = useState(() => badgeSpooferEngine.getStats().fingerprint || "");
    const [totalAvailableGames, setTotalAvailableGames] = useState(0);
    const version = React.useSyncExternalStore(badgeSpooferEngine.subscribe, badgeSpooferEngine.getVersion);
    const stats = badgeSpooferEngine.getStats();
    const isRunning = badgeSpooferEngine.getIsRunning();
    const progress = badgeSpooferEngine.getProgress();
    const logs = badgeSpooferEngine.getLogs();
    const logsRef = useRef<HTMLDivElement>(null);
    const latest = useRef({ hours, streamHours, gameCount, fingerprint });
    latest.current = { hours, streamHours, gameCount, fingerprint };

    useEffect(() => {
        let alive = true;
        badgeSpooferEngine.loadGames().then(games => {
            if (alive) setTotalAvailableGames(games.length);
        });
        return () => {
            alive = false;
            persistTargets(latest.current);
        };
    }, []);

    useEffect(() => {
        const el = logsRef.current;
        if (el) el.scrollTop = el.scrollHeight;
    }, [version]);

    const handleStart = () => {
        if (warnIfBlocked()) return;
        persistTargets(latest.current);
        const parsedCount = !gameCount.trim() || gameCount.toLowerCase() === "all"
            ? totalAvailableGames
            : Math.min(Number(gameCount) || totalAvailableGames, totalAvailableGames);
        badgeSpooferEngine.startSpoofing({
            count: parsedCount,
            hours: toHours(hours),
            streamHours: toHours(streamHours),
            fingerprint: fingerprint.trim() || undefined,
            batchSize: cfg().batchSize || 50,
            batchDelay: cfg().batchDelay || 300
        });
    };

    const handleStop = () => badgeSpooferEngine.stopSpoofing();

    const handleRefreshGames = async () => {
        const games = await badgeSpooferEngine.loadGames(true);
        setTotalAvailableGames(games.length);
        showToast({ text: `Reloaded ${games.length} games from Discord CDN`, variant: "success" });
    };

    const handleClearStats = () => {
        badgeSpooferEngine.clearHistory();
        showToast({ text: "Claimed stats reset.", variant: "success" });
    };

    const percent = progress && progress.total > 0
        ? Math.min(100, Math.round((progress.sent / progress.total) * 100))
        : 0;

    return (
        <Modal
            {...modalProps}
            size="md"
            title="Discord Badge Spoofer"
            subtitle="Spoof Game Variety (Games Played), Game Time (Playtime), & Streaming (Hours Streamed)"
        >
            <ModalContent scrollbarType="none" style={{ padding: "12px 16px", display: "flex", flexDirection: "column", gap: "10px" }}>
                <AnalyticsNotice />
                <div style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(4, 1fr)",
                    gap: "10px",
                    background: "var(--background-secondary)",
                    padding: "12px 14px",
                    borderRadius: "8px",
                    border: "1px solid var(--background-modifier-accent)"
                }}>
                    <div>
                        <Heading tag="h5" style={{ margin: 0, marginBottom: "4px", fontSize: "11px" }}>GAMES SPOOFED</Heading>
                        <Text size="lg" weight="bold" color="header-primary">{stats.totalGamesClaimed.toLocaleString()}</Text>
                    </div>
                    <div>
                        <Heading tag="h5" style={{ margin: 0, marginBottom: "4px", fontSize: "11px" }}>HOURS PLAYED</Heading>
                        <Text size="lg" weight="bold" color="header-primary">{Math.round(stats.totalHoursClaimed).toLocaleString()}h</Text>
                    </div>
                    <div>
                        <Heading tag="h5" style={{ margin: 0, marginBottom: "4px", fontSize: "11px" }}>HOURS STREAMED</Heading>
                        <Text size="lg" weight="bold" color="header-primary">{Math.round(stats.totalStreamHoursClaimed || 0).toLocaleString()}h</Text>
                    </div>
                    <div>
                        <Heading tag="h5" style={{ margin: 0, marginBottom: "4px", fontSize: "11px" }}>DB GAMES</Heading>
                        <Text size="lg" weight="bold" color="header-primary">{totalAvailableGames.toLocaleString()}</Text>
                    </div>
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "12px" }}>
                        <div>
                            <Heading tag="h5">PLAY HOURS</Heading>
                            <TextInput
                                type="number"
                                disabled={isRunning}
                                value={hours}
                                onChange={setHours}
                                placeholder="1"
                            />
                            <Paragraph style={{ fontSize: "12px", color: "var(--text-muted)", marginTop: "4px" }}>
                                Playtime per game
                            </Paragraph>
                        </div>

                        <div>
                            <Heading tag="h5">STREAM HOURS</Heading>
                            <TextInput
                                type="number"
                                disabled={isRunning}
                                value={streamHours}
                                onChange={setStreamHours}
                                placeholder="1"
                            />
                            <Paragraph style={{ fontSize: "12px", color: "var(--text-muted)", marginTop: "4px" }}>
                                Streamed per game
                            </Paragraph>
                        </div>

                        <div>
                            <Heading tag="h5">GAME COUNT</Heading>
                            <TextInput
                                disabled={isRunning}
                                value={gameCount}
                                onChange={setGameCount}
                                placeholder={`All (${totalAvailableGames})`}
                            />
                            <Paragraph style={{ fontSize: "12px", color: "var(--text-muted)", marginTop: "4px" }}>
                                Number or blank
                            </Paragraph>
                        </div>
                    </div>

                    <div>
                        <Heading tag="h5">EXECUTABLE FINGERPRINT (OPTIONAL)</Heading>
                        <TextInput
                            disabled={isRunning}
                            value={fingerprint}
                            onChange={setFingerprint}
                            placeholder="Optional base64 executable_fingerprint for games-played count"
                        />
                        <Paragraph style={{ fontSize: "12px", color: "var(--text-muted)", marginTop: "4px" }}>
                            Used by Discord to verify the executable. Leave blank to use defaults.
                        </Paragraph>
                    </div>
                </div>

                <div style={{
                    background: "var(--background-secondary)",
                    padding: "12px 14px",
                    borderRadius: "8px",
                    border: "1px solid var(--background-modifier-accent)"
                }}>
                    <HypeSquadPicker />
                </div>

                {(isRunning || progress) && (
                    <div style={{
                        background: "var(--background-secondary)",
                        padding: "10px 14px",
                        borderRadius: "8px",
                        display: "flex",
                        flexDirection: "column",
                        gap: "6px"
                    }}>
                        <div style={{ display: "flex", justifyContent: "space-between" }}>
                            <Text size="xs" weight="medium" color="text-normal">
                                {progress?.status || (isRunning ? "Spoofing in progress..." : "Ready")}
                            </Text>
                            <Text size="xs" weight="bold" color="header-primary">{percent}%</Text>
                        </div>
                        <div style={{
                            width: "100%",
                            height: "6px",
                            background: "var(--background-secondary-alt)",
                            borderRadius: "3px",
                            overflow: "hidden"
                        }}>
                            <div style={{
                                width: `${percent}%`,
                                height: "100%",
                                background: "var(--brand-500)",
                                transition: "width 0.2s ease"
                            }} />
                        </div>
                    </div>
                )}

                <div>
                    <Heading tag="h5">LIVE OUTPUT LOGS</Heading>
                    <div className="tc-badge-spoofer-logs" ref={logsRef}>
                        {logs.map(log => (
                            <div key={log.id} className="tc-badge-spoofer-log-line">
                                <span className="tc-badge-spoofer-log-time">
                                    [{new Date(log.timestamp).toLocaleTimeString()}]
                                </span>
                                <span className={`tc-badge-spoofer-log-msg ${log.type}`}>
                                    {log.message}
                                </span>
                            </div>
                        ))}
                    </div>
                </div>

                <div style={{
                    padding: "10px 14px",
                    background: "var(--background-secondary)",
                    borderRadius: "6px",
                    borderLeft: "4px solid var(--brand-500)",
                    display: "flex",
                    flexDirection: "column",
                    gap: "2px"
                }}>
                    <Text size="xs" weight="medium" color="header-primary" style={{ fontWeight: 600 }}>
                        Note
                    </Text>
                    <Text size="xs" weight="normal" color="text-muted" style={{ lineHeight: 1.4 }}>
                        Discord accepts these events with status <code style={{ background: "rgba(0,0,0,0.3)", padding: "1px 4px", borderRadius: "3px", color: "var(--text-positive)" }}>204 OK</code>. Badge tiers refresh on their backend within 24-48 hours.
                    </Text>
                </div>
            </ModalContent>

            <ModalFooter>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px", width: "100%", flexWrap: "wrap" }}>
                    <div style={{ display: "flex", gap: "6px" }}>
                        <Button size="small" variant="secondary" disabled={isRunning} onClick={handleRefreshGames}>
                            Reload DB
                        </Button>
                        <Button size="small" variant="secondary" disabled={isRunning} onClick={handleClearStats}>
                            Reset Stats
                        </Button>
                    </div>
                    {isRunning ? (
                        <Button size="small" variant="dangerPrimary" onClick={handleStop}>
                            Stop
                        </Button>
                    ) : (
                        <Button size="small" variant="primary" onClick={handleStart}>
                            Start
                        </Button>
                    )}
                </div>
            </ModalFooter>
        </Modal>
    );
}

export function openBadgeSpooferModal() {
    openModal(props => <BadgeSpooferModal modalProps={props} />);
}