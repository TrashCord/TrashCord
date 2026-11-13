/*
 * TrashCord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { findGroupChildrenByChildId } from "@api/ContextMenu";
import { HeaderBarButton } from "@api/HeaderBar";
import { definePluginSettings } from "@api/Settings";
import definePlugin, { OptionType } from "@utils/types";
import { Channel } from "@vencord/discord-types";
import { findByPropsLazy } from "@webpack";
import {
    ChannelStore,
    FluxDispatcher,
    Menu,
    React,
    RelationshipStore,
    RestAPI,
    SelectedChannelStore,
    UserStore,
    useEffect,
    useState,
    useStateFromStores,
    VoiceStateStore,
} from "@webpack/common";
import type { SVGProps } from "react";

const CHANNEL_TYPE_DM = 1;
const CHANNEL_TYPE_GROUP_DM = 3;

const settings = definePluginSettings({
    headerStopButton: {
        type: OptionType.BOOLEAN,
        description: "Show a stop button in the header bar while ringing",
        default: true
    }
});

const ChannelActions: { selectVoiceChannel: (channelId: string) => void; } = findByPropsLazy("disconnect", "selectVoiceChannel");

let ringChannel: string | null = null;
let ringTargets: string[] = [];
let inflight = false;
let pending: Promise<unknown> | null = null;

const draftPicks = new Map<string, string[]>();
const listeners = new Set<() => void>();
const notify = () => listeners.forEach(fn => fn());

const STRINGS: Record<string, string[]> = {
    en: ["Infinite ring", "Stop infinite ring", "Ring all", "Start", "not a friend", "Infinite ring active (click to stop)", "Stop all"],
    it: ["Squillo infinito", "Ferma squillo infinito", "Squilla a tutti", "Avvia", "non amico", "Squillo infinito attivo (clicca per fermare)", "Ferma tutti"],
    es: ["Timbre infinito", "Detener timbre infinito", "Llamar a todos", "Iniciar", "no es amigo", "Timbre infinito activo (clic para detener)", "Detener todos"],
    fr: ["Sonnerie infinie", "Arrêter la sonnerie infinie", "Appeler tout le monde", "Lancer", "pas ami", "Sonnerie infinie active (cliquer pour arrêter)", "Tout arrêter"],
    de: ["Endloses Klingeln", "Endloses Klingeln stoppen", "Alle anrufen", "Starten", "kein Freund", "Endloses Klingeln aktiv (klicken zum Stoppen)", "Alle stoppen"],
    pt: ["Toque infinito", "Parar toque infinito", "Chamar todos", "Iniciar", "não é amigo", "Toque infinito ativo (clique para parar)", "Parar todos"],
    nl: ["Eindeloos bellen", "Stop eindeloos bellen", "Bel iedereen", "Start", "geen vriend", "Eindeloos bellen actief (klik om te stoppen)", "Stop alles"],
    pl: ["Nieskończone dzwonienie", "Zatrzymaj dzwonienie", "Zadzwoń do wszystkich", "Start", "nie jest znajomym", "Nieskończone dzwonienie aktywne (kliknij, aby zatrzymać)", "Zatrzymaj wszystkich"],
    ru: ["Бесконечный звонок", "Остановить бесконечный звонок", "Звонить всем", "Начать", "не друг", "Бесконечный звонок активен (нажмите, чтобы остановить)", "Остановить всех"],
    tr: ["Sonsuz çaldır", "Sonsuz çaldırmayı durdur", "Herkesi ara", "Başlat", "arkadaş değil", "Sonsuz çaldırma aktif (durdurmak için tıkla)", "Hepsini durdur"],
};

function getStrings(): string[] {
    const lang = (navigator.language || "en").slice(0, 2).toLowerCase();
    return STRINGS[lang] ?? STRINGS.en;
}

function useRinging() {
    const [, tick] = useState(0);
    useEffect(() => {
        const fn = () => tick(n => n + 1);
        listeners.add(fn);
        return () => { listeners.delete(fn); };
    }, []);
    return ringChannel;
}

const noop = () => { };

function callApi(channelId: string, path: string, recipients: string[]) {
    return Promise.resolve(RestAPI.post({
        url: `/channels/${channelId}/call/${path}`,
        body: { recipients }
    })).catch(noop);
}

function ring(recipients: string[]) {
    const channelId = ringChannel;
    if (!channelId || !recipients.length || SelectedChannelStore.getVoiceChannelId() !== channelId) return;
    inflight = true;
    pending = callApi(channelId, "ring", recipients).then(() => { inflight = false; });
}

function onCall({ channelId, ongoingRings }: { channelId?: string; ongoingRings?: Record<string, string>; }) {
    const channel = ringChannel;
    if (!channel || channelId !== channel || inflight) return;
    if (ongoingRings && Object.keys(ongoingRings).length) return;
    const inCall = VoiceStateStore.getVoiceStatesForChannel(channel) ?? {};
    ring(ringTargets.filter(id => !inCall[id]));
}

function onVoiceSelect({ channelId }: { channelId?: string | null; }) {
    if (channelId === ringChannel) ring(ringTargets);
    else stopRing();
}

function stopRing() {
    const channelId = ringChannel;
    if (!channelId) return;
    const targets = ringTargets;
    ringChannel = null;
    ringTargets = [];
    const wait = inflight ? pending : null;
    inflight = false;
    FluxDispatcher.unsubscribe("VOICE_CHANNEL_SELECT", onVoiceSelect);
    FluxDispatcher.unsubscribe("CALL_CREATE", onCall);
    FluxDispatcher.unsubscribe("CALL_UPDATE", onCall);
    if (targets.length) {
        const send = () => callApi(channelId, "stop-ringing", targets);
        send();
        wait?.then(send);
    }
    notify();
}

function startRing(channel: Channel, recipients: string[]) {
    if (!recipients.length) return;
    stopRing();
    ringChannel = channel.id;
    ringTargets = [...recipients];
    draftPicks.delete(channel.id);

    FluxDispatcher.subscribe("VOICE_CHANNEL_SELECT", onVoiceSelect);
    FluxDispatcher.subscribe("CALL_CREATE", onCall);
    FluxDispatcher.subscribe("CALL_UPDATE", onCall);

    if (SelectedChannelStore.getVoiceChannelId() === channel.id) ring(ringTargets);
    else ChannelActions.selectVoiceChannel(channel.id);
    notify();
}

function addTarget(userId: string) {
    if (!ringChannel) return;
    if (!ringTargets.includes(userId)) ringTargets = [...ringTargets, userId];
    ring([userId]);
}

function removeTarget(userId: string, send = true) {
    const channelId = ringChannel;
    if (!channelId || !ringTargets.includes(userId)) return;
    ringTargets = ringTargets.filter(id => id !== userId);
    if (send) callApi(channelId, "stop-ringing", [userId]);
    if (!ringTargets.length) stopRing();
}

function toggleDraft(channelId: string, userId: string) {
    const current = draftPicks.get(channelId) ?? [];
    const next = current.includes(userId) ? current.filter(x => x !== userId) : [...current, userId];
    if (next.length) draftPicks.set(channelId, next);
    else draftPicks.delete(channelId);
}

function isBot(userId: string): boolean {
    return !!UserStore.getUser(userId)?.bot;
}

function isFriendUser(userId: string): boolean {
    return !isBot(userId) && RelationshipStore.isFriend(userId);
}

function displayName(userId: string): string {
    const user = UserStore.getUser(userId);
    return RelationshipStore.getNickname(userId) ?? user?.globalName ?? user?.username ?? userId;
}

function RingStopIcon({ className, width = 24, height = 24 }: SVGProps<SVGSVGElement>) {
    return (
        <svg className={className} width={width} height={height} viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <mask id="ir-icon-mask">
                <rect width="24" height="24" fill="white" />
                <rect x="9" y="8.5" width="6" height="6" rx="1.2" fill="black" />
            </mask>
            <path
                mask="url(#ir-icon-mask)"
                fill="currentColor"
                d="M12 22a2.2 2.2 0 0 0 2.2-2.2H9.8A2.2 2.2 0 0 0 12 22Zm6-6v-5a6 6 0 0 0-4.5-5.8V4.5a1.5 1.5 0 0 0-3 0v.7A6 6 0 0 0 6 11v5l-2 2v1h16v-1l-2-2Z"
            />
        </svg>
    );
}

function StopButton() {
    const active = useRinging();
    const voiceId = useStateFromStores([SelectedChannelStore], () => SelectedChannelStore.getVoiceChannelId());
    const { headerStopButton } = settings.use(["headerStopButton"]);
    if (!active || voiceId !== active || !headerStopButton) return null;

    return (
        <HeaderBarButton
            icon={RingStopIcon}
            tooltip={getStrings()[5]}
            onClick={stopRing}
        />
    );
}

function insertItems(children: any[], anchors: string[], items: any[], key: string) {
    const group = findGroupChildrenByChildId(anchors, children);
    if (group) group.splice(group.findIndex((c: any) => anchors.includes(c?.props?.id)) + 1, 0, ...items);
    else children.push(<Menu.MenuGroup key={key}>{items}</Menu.MenuGroup>);
}

function applyGroupMenu(children: any[], channel: Channel | undefined) {
    const [, rerender] = useState(0);
    if (!channel || channel.type !== CHANNEL_TYPE_GROUP_DM) return;

    const friends = channel.recipients.filter(isFriendUser);
    if (!friends.length) return;

    const s = getStrings();
    let items: any[];

    if (ringChannel === channel.id) {
        const sub: any[] = [
            <Menu.MenuItem key="ir-stop-all" id="ir-stop-all" label={s[6]} action={stopRing} />,
            <Menu.MenuSeparator key="ir-sep1" />,
            ...friends.map(userId => (
                <Menu.MenuCheckboxItem
                    key={userId}
                    id={`ir-manage-${userId}`}
                    label={displayName(userId)}
                    checked={ringTargets.includes(userId)}
                    action={() => {
                        if (ringTargets.includes(userId)) removeTarget(userId);
                        else addTarget(userId);
                        rerender(n => n + 1);
                    }}
                />
            ))
        ];
        items = [
            <Menu.MenuItem key="ir-manage" id="ir-manage" label={s[1]}>
                {sub}
            </Menu.MenuItem>
        ];
    } else {
        const picked = draftPicks.get(channel.id) ?? [];
        const sub: any[] = [
            <Menu.MenuItem key="ir-all" id="ir-all" label={s[2]} action={() => startRing(channel, friends)} />,
            <Menu.MenuSeparator key="ir-sep1" />,
            ...channel.recipients.filter(id => !isBot(id)).map(userId => {
                const friend = RelationshipStore.isFriend(userId);
                const name = displayName(userId);
                return (
                    <Menu.MenuCheckboxItem
                        key={userId}
                        id={`ir-${userId}`}
                        label={friend ? name : `${name} (${s[4]})`}
                        checked={picked.includes(userId)}
                        disabled={!friend}
                        action={() => {
                            toggleDraft(channel.id, userId);
                            rerender(n => n + 1);
                        }}
                    />
                );
            }),
            <Menu.MenuSeparator key="ir-sep2" />,
            <Menu.MenuItem
                key="ir-go"
                id="ir-go"
                label={`${s[3]} (${picked.length})`}
                disabled={!picked.length}
                action={() => startRing(channel, draftPicks.get(channel.id) ?? [])}
            />
        ];
        items = [
            <Menu.MenuItem key="ir-multi" id="ir-multi" label={s[0]}>
                {sub}
            </Menu.MenuItem>
        ];
    }

    insertItems(children, ["edit-gdm", "gdm-context-edit-gdm"], items, "ir-group");
}

function resolveDM(props: any): Channel | undefined {
    if (props?.guildId) return undefined;
    const channel = props?.channel ?? (props?.channelId ? ChannelStore.getChannel(props.channelId) : undefined);
    if (channel) return channel.type === CHANNEL_TYPE_DM || channel.type === CHANNEL_TYPE_GROUP_DM ? channel : undefined;
    const userId = props?.user?.id;
    if (!userId) return undefined;
    const dmId = ChannelStore.getDMFromUserId(userId);
    return dmId ? ChannelStore.getChannel(dmId) : undefined;
}

const STOP_IDS = ["stop-ringing", "user-context-stop-ringing"];
const RING_IDS = ["ring", "user-context-ring", "call", "user-context-call"];

function wrapAction(children: any[], ids: string[], fn: (orig: ((...args: any[]) => any) | undefined, args: any[]) => any) {
    const group = findGroupChildrenByChildId(ids, children);
    const i = group ? group.findIndex((c: any) => ids.includes(c?.props?.id)) : -1;
    if (!group || i === -1) return;
    const el = group[i];
    const orig = el.props.action;
    group[i] = React.cloneElement(el, { action: (...args: any[]) => fn(orig, args) });
}

function applyUserMenu(children: any[], props: any) {
    const userId: string | undefined = props?.user?.id;
    if (!userId) return;

    if (findGroupChildrenByChildId(STOP_IDS, children)) {
        if (ringChannel && ringTargets.includes(userId)) {
            wrapAction(children, STOP_IDS, (orig, args) => {
                removeTarget(userId, false);
                return orig?.(...args);
            });
        }
        return;
    }

    if (!isFriendUser(userId)) return;
    const channel = resolveDM(props);
    if (!channel || channel.type !== CHANNEL_TYPE_DM || !channel.recipients.includes(userId)) return;

    const item = (
        <Menu.MenuItem
            key="ir-user-start"
            id="ir-user-start"
            label={getStrings()[0]}
            action={() => ringChannel === channel.id ? addTarget(userId) : startRing(channel, [userId])}
        />
    );
    insertItems(children, RING_IDS, [item], "ir-user-group");
}

type PostFn = (...args: any[]) => any;

const STOP_URL = /\/channels\/(\d+)\/call\/stop-ringing(?:$|[?#])/;

let originalPost: PostFn | null = null;

function wrappedPost(this: unknown, ...args: any[]) {
    const channel = ringChannel;
    if (channel) {
        const req = args[0];
        const url = typeof req === "string" ? req : req?.url;
        const match = typeof url === "string" ? STOP_URL.exec(url) : null;
        if (match && match[1] === channel) {
            const recipients = req?.body?.recipients;
            if (Array.isArray(recipients) && recipients.length) recipients.forEach((id: string) => removeTarget(id, false));
            else stopRing();
        }
    }
    return originalPost!.apply(this, args);
}

export default definePlugin({
    name: "InfiniteRing",
    description: "Rings you start from a DM or group DM keep ringing endlessly until you stop them. Pick who to ring or remove from the group menu. Stop with the native stop ringing option or the header bar.",
    authors: [{ name: "zfrancesck1", id: 456195985404592149n }],
    tags: ["Voice", "Utility", "Fun"],
    dependencies: ["HeaderBarAPI"],
    enabledByDefault: false,
    settings,

    headerBarButton: {
        icon: RingStopIcon,
        render: StopButton,
        priority: 6,
    },

    contextMenus: {
        "user-context": (children, props) => applyUserMenu(children, props),
        "gdm-context": (children, props) => applyGroupMenu(children, props?.channel),
    },

    start() {
        if (originalPost) return;
        const post = RestAPI?.post;
        if (typeof post !== "function") return;
        try {
            originalPost = post as PostFn;
            RestAPI.post = wrappedPost;
        } catch {
            originalPost = null;
        }
    },

    stop() {
        stopRing();
        draftPicks.clear();
        if (!originalPost) return;
        try {
            if (RestAPI.post === wrappedPost) RestAPI.post = originalPost;
        } catch { }
        originalPost = null;
    },
});