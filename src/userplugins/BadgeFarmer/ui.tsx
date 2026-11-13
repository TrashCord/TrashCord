/*
 * TrashCord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Settings } from "@api/Settings";
import { useForceUpdater } from "@utils/react";
import { ApplicationStreamingStore, React, SelectedChannelStore, TextInput, useEffect, useMemo, useState, useStateFromStores, UserProfileStore, UserStore } from "@webpack/common";
import type { JSX, ReactNode } from "react";

import type { DetectableApp, FarmerStatus } from "./farmer";
import * as Farmer from "./farmer";
import { type Key, LANGUAGES, t } from "./i18n";
import { TURBO_HOURS_PER_MINUTE } from "./science";

const cl = (name: string) => `vc-bf-${name}`;

const DETECTABLE_APPS_URL = "https://discord.com/api/v10/applications/detectable";
const MAX_RESULTS = 20;

let cataloguePromise: Promise<DetectableApp[]> | null = null;
const lowerCache = new WeakMap<DetectableApp[], string[]>();

export function loadCatalogue(): Promise<DetectableApp[]> {
    cataloguePromise ??= fetch(DETECTABLE_APPS_URL)
        .then(async response => {
            if (!response.ok) throw new Error(`Discord returned ${response.status}`);
            const text = await response.text();
            if (!text.trim()) throw new Error(t("errEmpty"));
            return JSON.parse(text) as DetectableApp[];
        })
        .then(apps => {
            const slim: DetectableApp[] = [];
            for (const app of apps) {
                if (app.id == null || app.name == null) continue;
                slim.push({
                    id: app.id,
                    name: app.name,
                    executables: app.executables?.map(e => ({ name: e.name, os: e.os, is_launcher: e.is_launcher }))
                });
            }
            return slim;
        })
        .catch(error => {
            cataloguePromise = null;
            throw error;
        });

    return cataloguePromise;
}

function lowerOf(apps: DetectableApp[]): string[] {
    let lower = lowerCache.get(apps);
    if (lower == null) {
        lower = apps.map(app => app.name.toLowerCase());
        lowerCache.set(apps, lower);
    }
    return lower;
}

function useCatalogue(): { apps: DetectableApp[] | null; error: string | null; } {
    const [apps, setApps] = useState<DetectableApp[] | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        loadCatalogue().then(
            loaded => { if (!cancelled) setApps(loaded); },
            cause => { if (!cancelled) setError(t("listErr", { e: cause.message })); }
        );
        return () => { cancelled = true; };
    }, []);

    return { apps, error };
}

export function useFarmerStatus(): FarmerStatus {
    const forceUpdate = useForceUpdater();
    useEffect(() => Farmer.subscribe(forceUpdate), []);
    return Farmer.getStatus();
}

const sameLive = (a: Farmer.LiveInfo, b: Farmer.LiveInfo) =>
    a.inVoice === b.inVoice && a.live === b.live && a.viewers === b.viewers;

export function useLiveInfo(): Farmer.LiveInfo {
    return useStateFromStores([SelectedChannelStore, ApplicationStreamingStore], Farmer.getLiveInfo, [], sameLive);
}

interface ProfileBadge { id: string; description: string; simple_icon_url?: string; }

const BADGES: Array<{ id: string; title: Key; }> = [
    { id: "game_time", title: "gameTime" },
    { id: "game_variety", title: "variety" },
    { id: "streaming", title: "streaming" }
];

function useOwnedBadges(): ProfileBadge[] {
    return useStateFromStores(
        [UserProfileStore, UserStore],
        () => {
            try {
                const me = UserStore.getCurrentUser();
                return ((UserProfileStore as any).getUserProfile(me.id)?.badges ?? []) as ProfileBadge[];
            } catch {
                return [];
            }
        },
        [],
        (a, b) => a.length === b.length && a.every((badge, i) => badge.id === b[i].id && badge.simple_icon_url === b[i].simple_icon_url)
    );
}

function BadgesPanel(): JSX.Element {
    const badges = useOwnedBadges();

    return (
        <div className={cl("check")}>
            <span className={cl("field-name")}>{t("badgesTitle")}</span>
            {BADGES.map(({ id, title }) => {
                const found = badges.find(b => b.id === id);
                return (
                    <div key={id} className={cl("badge-row")}>
                        {found?.simple_icon_url
                            ? <img className={cl("badge-icon")} src={found.simple_icon_url} alt="" loading="lazy" decoding="async" />
                            : <span className={cl("no")}>{"\u2717"}</span>}
                        <span className={found ? cl("yes") : cl("no")}>{t(title)}{found ? "" : `: ${t("badgeNone")}`}</span>
                    </div>
                );
            })}
            <Note text={t("badgesNote")} />
            <Note text={t("stackNote")} />
        </div>
    );
}

function randomGame(apps: DetectableApp[]): DetectableApp {
    const pool = apps.filter(app => app.executables?.some(e => e.os === "win32"));
    const list = pool.length > 0 ? pool : apps;
    return list[Math.floor(Math.random() * list.length)];
}

const TIME_AT = [1, 8, 20, 78, 250, 1000, 2500, 5000];
const VARIETY_AT = [3, 10, 25, 50, 100];

interface Progress { level: number; total: number; nextAt: number | null; pct: number; unit: string; credited: string; }

function progressOf(value: number, steps: number[], unit: string, credited: string): Progress {
    let level = 0;
    for (let i = 0; i < steps.length; i++) if (value >= steps[i]) level = i + 1;
    const floor = level > 0 ? steps[level - 1] : 0;
    const nextAt = steps[level] ?? null;
    const pct = nextAt == null ? 100 : Math.round(((value - floor) / (nextAt - floor)) * 100);
    return { level, total: steps.length, nextAt, pct, unit, credited };
}

function parseNum(value: string, min: number, max: number, int = false): number | null {
    if (!value.trim()) return null;
    const n = Number(value);
    if (!Number.isFinite(n) || n < min || n > max || (int && !Number.isInteger(n))) return null;
    return n;
}

function rangeError(parsed: number | null, min: number, max: number, int = false): string | null {
    return parsed == null ? t(int ? "errInt" : "errRange", { min, max }) : null;
}

function formatHours(hours: number): string {
    return hours >= 10 ? `${Math.round(hours)}h` : `${Math.round(hours * 10) / 10}h`;
}

function formatDuration(minutes: number): string {
    if (minutes < 1) return "<1 min";
    if (minutes < 120) return `${Math.round(minutes)} min`;
    const hours = minutes / 60;
    return hours < 48 ? `${hours.toFixed(1)} h` : `${(hours / 24).toFixed(1)} d`;
}

function pickVarietyPool(apps: DetectableApp[], count: number): DetectableApp[] {
    const pool = [...apps];
    for (let i = 0; i < count && i < pool.length; i++) {
        const j = i + Math.floor(Math.random() * (pool.length - i));
        [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    return pool.slice(0, count);
}

export function statusText(s: FarmerStatus): string {
    switch (s.mode) {
        case "GAME_TIME":
            return t("sGame", { name: s.activeGame?.name ?? "", h: formatHours(s.hoursCreditedThisRun) });
        case "VARIETY":
            return t("sVar", { a: s.gamesCreditedThisRun, b: s.varietyTotal });
        case "STREAM":
            return t("sStream", { h: formatHours(s.streamHoursCreditedThisRun), mode: t(s.streamPhase === "turbo" ? "modeTurbo" : s.streamPhase === "slow" ? "modeSlow" : "modeWait") });
        case "MAX_ALL":
            return t("sAll", {
                g: s.gamesCreditedThisRun, n: s.varietyTotal,
                h: formatHours(s.hoursCreditedThisRun), s: formatHours(s.streamHoursCreditedThisRun)
            });
        default:
            return t("hdrIdle");
    }
}

const HL = /(\d[\d.,]*(?:-\d+)?(?:\s?(?:h|min)\b)?|Turbo|Lento|Lent|Langsam|Slow|Max All)/;

function Note({ text }: { text: string; }) {
    return (
        <span className={cl("muted")}>
            {text.split(HL).map((part, i) => (i % 2 ? <b key={i} className={cl("hl")}>{part}</b> : part))}
        </span>
    );
}

function Field({ label, hint, value, onChange, error }: {
    label: string; hint: string; value: string; onChange: (v: string) => void; error: string | null;
}) {
    return (
        <div className={cl("field")}>
            <span className={cl("field-name")}>{label}</span>
            <TextInput value={value} onChange={onChange} />
            {error != null ? <span className={cl("err")}>{error}</span> : <Note text={hint} />}
        </div>
    );
}

function Card({ accent, title, blurb, steps, progress, children }: {
    accent: number; title: string; blurb: string; steps: string[]; progress: Progress | null; children: ReactNode;
}) {
    const [open, setOpen] = useState(false);

    return (
        <div className={`${cl("card")} ${cl(`acc-${accent}`)}`}>
            <div className={cl("card-head")}>
                <span className={cl("title")}>{title}</span>
                {progress != null && <span className={cl("tier")}>{t("lvl", { n: progress.level, total: progress.total })}</span>}
            </div>
            <Note text={blurb} />

            {progress != null && (
                <div className={cl("col")}>
                    <div className={cl("track")}><div className={cl("fill")} style={{ width: `${progress.pct}%` }} /></div>
                    <Note text={`${t("thisRun", { x: progress.credited })}${progress.nextAt != null ? ` · ${t("nextTier", { at: `${progress.nextAt}${progress.unit}` })}` : ""}`} />
                </div>
            )}

            {children}

            <button className={cl("link")} onClick={() => setOpen(o => !o)} aria-expanded={open}>
                {open ? "\u25BE " : "\u25B8 "}{open ? t("howClose") : t("howOpen")}
            </button>
            {open && <ol className={cl("steps")}>{steps.map(s => <li key={s}>{s}</li>)}</ol>}
        </div>
    );
}

function Row({ ok, text }: { ok: boolean; text: string; }) {
    return <span className={ok ? cl("yes") : cl("no")}>{ok ? "\u2713" : "\u2717"} {text}</span>;
}

export function LiveCheck(): JSX.Element {
    const info = useLiveInfo();
    const verdict = !info.inVoice ? "verdictNoVoice" : !info.live ? "verdictNoLive" : info.viewers === 0 ? "verdictNoViewer" : "verdictOk";

    return (
        <div className={cl("check")}>
            <span className={cl("field-name")}>{t("liveTitle")}</span>
            <div className={cl("check-rows")}>
                <Row ok={info.inVoice} text={t("inVoice")} />
                <Row ok={info.live} text={t("isLive")} />
                <Row ok={info.viewers > 0} text={t("viewers", { n: info.viewers })} />
            </div>
            <span className={verdict === "verdictOk" ? cl("yes") : cl("warn")}>{t(verdict)}</span>
        </div>
    );
}

function GameTimeCard({ apps, loadError, status, busy }: {
    apps: DetectableApp[] | null; loadError: string | null; status: FarmerStatus; busy: boolean;
}) {
    const [query, setQuery] = useState("");
    const [selected, setSelected] = useState<DetectableApp | null>(null);
    const [hours, setHours] = useState("5000");
    const [chunk, setChunk] = useState("24");
    const [adv, setAdv] = useState(false);
    const deferred = React.useDeferredValue(query);

    const results = useMemo(() => {
        const needle = deferred.trim().toLowerCase();
        if (apps == null || needle.length < 2 || selected != null) return [];

        const lower = lowerOf(apps);
        const starts: DetectableApp[] = [];
        const contains: DetectableApp[] = [];
        for (let i = 0; i < apps.length && starts.length < MAX_RESULTS; i++) {
            const at = lower[i].indexOf(needle);
            if (at === 0) starts.push(apps[i]);
            else if (at > 0 && contains.length < MAX_RESULTS) contains.push(apps[i]);
        }
        return starts.concat(contains).slice(0, MAX_RESULTS);
    }, [apps, deferred, selected]);

    const parsedHours = parseNum(hours, 1, Farmer.MAX_TIME_HOURS);
    const parsedChunk = parseNum(chunk, 1, 500, true);
    const requests = parsedHours != null && parsedChunk != null ? Math.ceil(parsedHours / parsedChunk) : null;

    function clear() {
        setSelected(null);
        setQuery("");
    }

    return (
        <Card
            accent={1}
            title={t("gameTime")}
            blurb={t("gtBlurb")}
            steps={[t("gtS1"), t("gtS2"), t("gtS3")]}
            progress={status.hoursCreditedThisRun > 0
                ? progressOf(status.hoursCreditedThisRun, TIME_AT, "h", formatHours(status.hoursCreditedThisRun))
                : null}
        >
            <div className={cl("col")}>
                <TextInput
                    value={query}
                    onChange={value => { setQuery(value); setSelected(null); }}
                    disabled={busy || apps == null}
                    placeholder={loadError != null ? t("listFail") : apps == null ? t("loading") : t("search")}
                />
                {selected != null && (
                    <div className={cl("picked")}>
                        <span>{selected.name}</span>
                        <button className={cl("link")} onClick={clear}>{t("clear")}</button>
                    </div>
                )}
                {results.length > 0 && (
                    <div className={cl("results")}>
                        {results.map(app => (
                            <button key={app.id} className={cl("result")} onClick={() => { setSelected(app); setQuery(app.name); }}>
                                <span className={cl("result-name")}>{app.name}</span>
                                <span className={cl("muted")}>{Farmer.executableFor(app)} · {app.id}</span>
                            </button>
                        ))}
                    </div>
                )}
            </div>

            <Field label={t("gtHoursL")} hint={t("gtHoursH")} value={hours} onChange={setHours}
                error={rangeError(parsedHours, 1, Farmer.MAX_TIME_HOURS)} />
            <button className={cl("link")} onClick={() => setAdv(a => !a)}>{adv ? "\u25BE " : "\u25B8 "}{adv ? t("advClose") : t("advOpen")}</button>
            {adv && <Field label={t("gtChunkL")} hint={t("gtChunkH")} value={chunk} onChange={setChunk}
                error={rangeError(parsedChunk, 1, 500, true)} />}
            {selected == null && <Note text={t("gtRandom")} />}
            {requests != null && <Note text={t("etaReq", { n: requests, eta: formatDuration(requests / 60) })} />}

            <button
                className={cl("btn")}
                disabled={busy || apps == null || parsedHours == null || parsedChunk == null}
                onClick={() => {
                    void Farmer.startGameTime(selected ?? randomGame(apps!), parsedHours!, parsedChunk!);
                    clear();
                }}
            >
                {selected == null ? t("creditRandom") : t("credit", { name: selected.name })}
            </button>
        </Card>
    );
}

function VarietyCard({ apps, status, busy }: { apps: DetectableApp[] | null; status: FarmerStatus; busy: boolean; }) {
    const [minutes, setMinutes] = useState("2");
    const [count, setCount] = useState("100");
    const [adv, setAdv] = useState(false);

    const parsedMinutes = parseNum(minutes, 1, 1440);
    const maxGames = apps?.length ?? 1000;
    const parsedCount = parseNum(count, 1, maxGames, true);

    return (
        <Card
            accent={2}
            title={t("variety")}
            blurb={t("varBlurb")}
            steps={[t("varS1"), t("varS2"), t("varS3")]}
            progress={status.gamesCreditedThisRun > 0
                ? progressOf(status.gamesCreditedThisRun, VARIETY_AT, "", String(status.gamesCreditedThisRun))
                : null}
        >
            <Field label={t("varCountL")} hint={`${t("varCountH")} \u2264 ${maxGames}`} value={count} onChange={setCount}
                error={rangeError(parsedCount, 1, maxGames, true)} />
            <button className={cl("link")} onClick={() => setAdv(a => !a)}>{adv ? "\u25BE " : "\u25B8 "}{adv ? t("advClose") : t("advOpen")}</button>
            {adv && <Field label={t("varMinL")} hint={t("varMinH")} value={minutes} onChange={setMinutes}
                error={rangeError(parsedMinutes, 1, 1440)} />}
            {parsedCount != null && <Note text={t("etaReq", { n: parsedCount, eta: formatDuration(parsedCount / 60) })} />}

            <button
                className={cl("btn")}
                disabled={busy || apps == null || parsedMinutes == null || parsedCount == null}
                onClick={() => void Farmer.startVariety(pickVarietyPool(apps!, parsedCount!), parsedMinutes!)}
            >
                {t("runVariety")}
            </button>
        </Card>
    );
}

function StreamCard({ status, busy }: { status: FarmerStatus; busy: boolean; }) {
    const [hours, setHours] = useState("5000");
    const info = useLiveInfo();

    const parsedHours = parseNum(hours, 1, Farmer.MAX_TIME_HOURS);
    const turbo = info.live && info.viewers > 0;
    const eta = parsedHours == null ? null
        : turbo ? t("etaTurbo", { eta: formatDuration(Math.ceil(parsedHours / TURBO_HOURS_PER_MINUTE)) })
            : t("etaSlow", { eta: formatDuration(parsedHours * 60) });

    return (
        <Card
            accent={3}
            title={t("streaming")}
            blurb={t("stBlurb")}
            steps={[t("stS1"), t("stS2"), t("stS3")]}
            progress={status.streamHoursCreditedThisRun > 0
                ? progressOf(status.streamHoursCreditedThisRun, TIME_AT, "h", formatHours(status.streamHoursCreditedThisRun))
                : null}
        >
            <LiveCheck />
            <Field label={t("stHoursL")} hint={t("stHoursH")} value={hours} onChange={setHours}
                error={rangeError(parsedHours, 1, Farmer.MAX_TIME_HOURS)} />
            {eta != null && <Note text={eta} />}
            {opt("autoSwitch", true) && <Note text={t("autoNote")} />}

            <button className={cl("btn")} disabled={busy || parsedHours == null} onClick={() => void Farmer.startStream(parsedHours!)}>
                {t("startStream")}
            </button>
        </Card>
    );
}

function opt(key: string, def: boolean): boolean {
    return (Settings.plugins as any).BadgeFarmer?.[key] ?? def;
}

const TOGGLES: Array<{ key: string; label: Key; hint: Key; def: boolean; }> = [
    { key: "toasts", label: "optToasts", hint: "optToastsH", def: true },
    { key: "headerButton", label: "optHeader", hint: "optHeaderH", def: true },
    { key: "autoSwitch", label: "optAuto", hint: "optAutoH", def: true },
    { key: "autoStartMaxAll", label: "optMaxAll", hint: "optMaxAllH", def: false },
    { key: "showGamePresence", label: "optPresence", hint: "optPresenceH", def: false }
];

function OptionsPanel({ onLanguage }: { onLanguage: () => void; }): JSX.Element {
    const update = useForceUpdater();
    const store = (Settings.plugins as any).BadgeFarmer;

    return (
        <div className={cl("check")}>
            <span className={cl("field-name")}>{t("optTitle")}</span>
            {TOGGLES.map(o => (
                <label key={o.key} className={cl("opt")}>
                    <input type="checkbox" checked={opt(o.key, o.def)} onChange={e => { store[o.key] = e.target.checked; update(); }} />
                    <span className={cl("opt-text")}>
                        <span>{t(o.label)}</span>
                        <Note text={t(o.hint)} />
                    </span>
                </label>
            ))}
            <label className={`${cl("opt")} ${cl("opt-lang")}`}>
                <select className={cl("select")} value={store?.language ?? "auto"} onChange={e => { store.language = e.target.value; onLanguage(); }}>
                    {LANGUAGES.map(l => <option key={l.value} value={l.value}>{l.value === "auto" ? t("langAuto") : l.label}</option>)}
                </select>
                <span>{t("optLang")}</span>
            </label>
        </div>
    );
}

export function BadgeFarmerDashboard(): JSX.Element {
    const { apps, error } = useCatalogue();
    const status = useFarmerStatus();
    const busy = status.mode !== "IDLE";
    const refresh = useForceUpdater();
    const [forced, setForced] = useState(false);
    const consentOff = Farmer.personalizationOff();
    const locked = consentOff && !forced;

    useEffect(() => () => Farmer.setForce(false), []);

    return (
        <div className={`vc-bf ${cl("dash")}`}>
            <div className={cl("top")}>
                <span className={cl("name")}>Badge Farmer</span>
                <span className={busy ? `${cl("pill")} ${cl("pill-on")}` : cl("pill")}>
                    <span className={busy ? cl("dot") : cl("dot-off")} />
                    {busy ? t("pillOn") : t("hdrIdle")}
                </span>
            </div>

            {error != null && <div className={cl("notice-bad")}>{error}</div>}

            {!busy && status.finishedMessage != null && (
                <div className={cl("done")}>&#10003; {status.finishedMessage}</div>
            )}

            {!busy && status.finishedMessage == null && status.lastError != null && (
                <div className={cl("notice-bad")}>{status.lastError}</div>
            )}

            {busy && (
                <div className={cl("run")}>
                    <span className={cl("title")}><span className={cl("dot")} />{statusText(status)}</span>
                    {status.lastError != null && <span className={cl("err")}>{status.lastError}</span>}
                    <Note text={`${t("runHint")}${opt("headerButton", true) ? ` ${t("runHintHeader")}` : ""}`} />
                    <div className={cl("stop-row")}>
                        <button className={cl("stop")} onClick={() => Farmer.stop()}>{"\u25A0"} {t("stopRun")}</button>
                        <span className={cl("muted")}>{t("stopHint")}</span>
                    </div>
                </div>
            )}

            {(consentOff || status.needsConsent) && (
                <div className={cl("attn")}>
                    <span className={cl("attn-title")}>{t("attn")}</span>
                    <span>{t("priv")}</span>
                    {locked && (
                        <div>
                            <button className={cl("btn")} onClick={() => { Farmer.setForce(true); setForced(true); }}>{t("forceBtn")}</button>
                        </div>
                    )}
                </div>
            )}

            <div className={cl("box")}>
                <span>{t("intro")}</span>
            </div>

            <BadgesPanel />

            <fieldset className={cl("fs")} disabled={locked}>
            <div className={cl("cards")}>
                <GameTimeCard apps={apps} loadError={error} status={status} busy={busy} />
                <VarietyCard apps={apps} status={status} busy={busy} />
                <StreamCard status={status} busy={busy} />
            </div>

            <div className={cl("maxall")}>
                <Note text={t("maxAllDesc", { n: Farmer.MAX_VARIETY_GAMES, h: Farmer.MAX_BADGE_HOURS })} />
                <button className={cl("btn")} disabled={busy || apps == null} onClick={() => void Farmer.maxAll(apps!)}>
                    {t("maxAll")}
                </button>
            </div>
            </fieldset>

            <OptionsPanel onLanguage={refresh} />

            <span className={cl("muted")}>{t("footer")}</span>
        </div>
    );
}
