/*
 * Vencord, a Discord client mod
 * SilentGroupCall - start DM/group calls without ringing the other members.
 *
 * When you start a call, Discord's client sends a separate
 * `POST /channels/{id}/call/ring` request to notify the other members. This
 * plugin wraps Discord's HTTP client and skips that one request when the call is
 * in scope. You stay connected and the call is still joinable; nobody gets buzzed.
 *
 * Only the call button's *automatic* ring is silenced: a ring is dropped only if
 * it comes shortly after you join that channel's call (VOICE_CHANNEL_SELECT) and
 * isn't aimed at specific users. Right-click "Ring to Call" and in-call ring
 * buttons later on go through untouched.
 *
 * Right-clicking the "Start Voice Call" button in a group DM opens a picker: the
 * call starts, and its automatic ring is rewritten to target only the members you
 * ticked (or dropped if you ticked nobody). Still no extra request is ever sent.
 *
 * Why the HTTP layer and not the `ring()` action itself: webpack module exports
 * are getter-only (assigning to them throws), and regex patches against minified
 * code break on every Discord update. The REST endpoint path is part of Discord's
 * public API and far more stable, and `RestAPI` is a plain, writable object.
 */

import { findGroupChildrenByChildId } from "@api/ContextMenu";
import { ChannelToolbarButton } from "@api/HeaderBar";
import { definePluginSettings } from "@api/Settings";
import { Logger } from "@utils/Logger";
import definePlugin, { OptionType } from "@utils/types";
import { Channel } from "@vencord/discord-types";
import { findByPropsLazy } from "@webpack";
import {
    ChannelStore,
    ContextMenuApi,
    FluxDispatcher,
    Menu,
    RelationshipStore,
    RestAPI,
    SelectedChannelStore,
    UserStore,
    useStateFromStores,
    useState,
} from "@webpack/common";

const CHANNEL_TYPE_DM = 1;
const CHANNEL_TYPE_GROUP_DM = 3;

const RING_URL = /\/channels\/(\d+)\/call\/ring(?:$|[?#])/;

const AUTO_RING_WINDOW_MS = 15_000;

const settings = definePluginSettings({
    silenceGroupCalls: {
        type: OptionType.BOOLEAN,
        description: "Don't ring members when you start a group call",
        default: true,
    },
    silenceDMCalls: {
        type: OptionType.BOOLEAN,
        description: "Don't ring the other person when you start a 1-on-1 DM call",
        default: false,
    },
    contextMenuUser: {
        type: OptionType.BOOLEAN,
        description: "Show the silent call option in the DM (user) context menu",
        default: true,
    },
    contextMenuGroup: {
        type: OptionType.BOOLEAN,
        description: "Show the silent call options in the group context menu",
        default: true,
    },
    headerButtonUser: {
        type: OptionType.BOOLEAN,
        description: "Show a silent call button in the header bar of DMs",
        default: false,
    },
    headerButtonGroup: {
        type: OptionType.BOOLEAN,
        description: "Show a silent call button in the header bar of group chats (right-click to pick who to ring)",
        default: false,
    },
    disableOnCanary: {
        type: OptionType.BOOLEAN,
        description: "Do nothing when running in Discord Canary (settings are shared between clients)",
        default: false,
        restartNeeded: true,
    },
    debugLogs: {
        type: OptionType.BOOLEAN,
        description: "Log plugin activity to the console (DevTools → Console, filter 'SilentGroupCall')",
        default: true,
    },
});

const logger = new Logger("SilentGroupCall");
const debug = (...args: any[]) => {
    if (settings.store.debugLogs) logger.info(...args);
};

const ChannelActions: { selectVoiceChannel: (channelId: string) => void; } = findByPropsLazy("disconnect", "selectVoiceChannel");

const pendingAutoRings = new Map<string, number>();
const silentCalls = new Map<string, number>();
const draftPicks = new Map<string, string[]>();

function onVoiceChannelSelect({ channelId }: { channelId?: string | null; }) {
    if (channelId) pendingAutoRings.set(channelId, Date.now());
}

function takePendingAutoRing(channelId: string): boolean {
    const t = pendingAutoRings.get(channelId);
    if (t === undefined) return false;
    pendingAutoRings.delete(channelId);
    return Date.now() - t <= AUTO_RING_WINDOW_MS;
}

function isSilentCall(channelId: string): boolean {
    const until = silentCalls.get(channelId);
    if (until === undefined) return false;
    if (until > Date.now()) return true;
    silentCalls.delete(channelId);
    return false;
}

function isTargetedRing(req: unknown): boolean {
    const recipients = (req as any)?.body?.recipients;
    return Array.isArray(recipients) && recipients.length > 0;
}

type PostFn = (...args: any[]) => any;

let originalPost: PostFn | null = null;
let active = false;

function getUrl(req: unknown): string | undefined {
    if (typeof req === "string") return req;
    if (req && typeof req === "object" && typeof (req as any).url === "string") return (req as any).url;
    return undefined;
}

function shouldDrop(channelId: string, req: unknown): boolean {
    const targeted = isTargetedRing(req);
    const joined = takePendingAutoRing(channelId);
    const silentCall = isSilentCall(channelId);

    const channel = ChannelStore.getChannel(channelId) as any;
    const inScope =
        channel?.type === CHANNEL_TYPE_GROUP_DM ? settings.store.silenceGroupCalls :
        channel?.type === CHANNEL_TYPE_DM ? settings.store.silenceDMCalls :
        false;

    const drop = !targeted && (silentCall || (joined && inScope));

    if (settings.store.debugLogs) logger.info("ring request", {
        channelId,
        type: channel?.type,
        joined,
        targeted,
        silentCall,
        inScope,
        decision: drop ? "silencing" : targeted ? "ringing (targeted)" : "ringing normally",
    });

    return drop;
}

function wrappedPost(this: unknown, ...args: any[]) {
    if (active) {
        const match = getUrl(args[0])?.match(RING_URL);
        if (match && shouldDrop(match[1], args[0])) {
            return Promise.resolve({ ok: true, status: 204, body: null, headers: {}, text: "" });
        }
    }
    return originalPost!.apply(this, args);
}

type Kind = "dm" | "group";

function isBot(userId: string): boolean {
    return !!UserStore.getUser(userId)?.bot;
}

function getKind(channel: Channel | undefined): Kind | null {
    if (!channel) return null;
    if (channel.type === CHANNEL_TYPE_GROUP_DM) return "group";
    if (channel.type === CHANNEL_TYPE_DM && !isBot(channel.recipients[0])) return "dm";
    return null;
}

function startCall(channel: Channel, recipients: string[] = []) {
    silentCalls.set(channel.id, Date.now() + AUTO_RING_WINDOW_MS);
    draftPicks.delete(channel.id);
    debug("starting silent call", { channelId: channel.id, recipients });

    ChannelActions.selectVoiceChannel(channel.id);
    if (recipients.length) RestAPI.post({ url: `/channels/${channel.id}/call/ring`, body: { recipients } });
}

function toggleDraft(channelId: string, userId: string) {
    const current = draftPicks.get(channelId) ?? [];
    const next = current.includes(userId) ? current.filter(x => x !== userId) : [...current, userId];
    if (next.length) draftPicks.set(channelId, next);
    else draftPicks.delete(channelId);
}

function displayName(userId: string): string {
    const user = UserStore.getUser(userId);
    return RelationshipStore.getNickname(userId) ?? user?.globalName ?? user?.username ?? userId;
}

const STRINGS: Record<string, string[]> = {
    en: ["Silent call", "Ring only…", "Start", "not a friend"],
    it: ["Chiama in silenzio", "Chiama solo…", "Avvia", "non amico"],
    es: ["Llamar en silencio", "Llamar solo a…", "Iniciar", "no es amigo"],
    fr: ["Appel silencieux", "Appeler seulement…", "Lancer", "pas ami"],
    de: ["Stiller Anruf", "Nur anrufen…", "Starten", "kein Freund"],
    pt: ["Chamar em silêncio", "Chamar apenas…", "Iniciar", "não é amigo"],
    nl: ["Stil bellen", "Alleen bellen…", "Start", "geen vriend"],
    pl: ["Zadzwoń po cichu", "Zadzwoń tylko do…", "Start", "nie jest znajomym"],
    ru: ["Беззвучный звонок", "Звонить только…", "Начать", "не друг"],
    tr: ["Sessiz ara", "Sadece şunları ara…", "Başlat", "arkadaş değil"],
};

function getStrings(): string[] {
    const lang = (navigator.language || "en").slice(0, 2).toLowerCase();
    return STRINGS[lang] ?? STRINGS.en;
}

function BellIcon({ color, className, width = 24, height = 24 }: any) {
    const fill = color ?? "currentColor";
    return (
        <svg className={className} width={width} height={height} viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <mask id="sgc-icon-mask">
                <rect width="24" height="24" fill="white" />
                <path d="M3 3l18 18" stroke="black" strokeWidth="5" strokeLinecap="round" />
            </mask>
            <path
                mask="url(#sgc-icon-mask)"
                fill={fill}
                d="M12 22a2.2 2.2 0 0 0 2.2-2.2H9.8A2.2 2.2 0 0 0 12 22Zm6-6v-5a6 6 0 0 0-4.5-5.8V4.5a1.5 1.5 0 0 0-3 0v.7A6 6 0 0 0 6 11v5l-2 2v1h16v-1l-2-2Z"
            />
            <path d="M3 3l18 18" stroke={fill} strokeWidth="2.2" strokeLinecap="round" />
        </svg>
    );
}

function getMemberItems(channel: Channel, refresh: () => void, idPrefix: string): any[] {
    const s = getStrings();
    const picked = draftPicks.get(channel.id) ?? [];

    return channel.recipients.filter(userId => !isBot(userId)).map(userId => {
        const friend = RelationshipStore.isFriend(userId);
        const name = displayName(userId);
        return (
            <Menu.MenuCheckboxItem
                key={userId}
                id={`${idPrefix}-${userId}`}
                label={friend ? name : `${name} (${s[3]})`}
                checked={picked.includes(userId)}
                disabled={!friend}
                action={() => {
                    toggleDraft(channel.id, userId);
                    refresh();
                }}
            />
        );
    });
}

function getMenuItems(channel: Channel, kind: Kind, refresh: () => void): any[] {
    const s = getStrings();
    const items: any[] = [
        <Menu.MenuItem key="sgc-silent" id="sgc-silent-call" label={s[0]} action={() => startCall(channel)} />,
    ];

    if (kind === "group") {
        const sub = getMemberItems(channel, refresh, "sgc-ring");
        sub.push(<Menu.MenuSeparator key="sgc-sep" />);
        sub.push(
            <Menu.MenuItem
                key="sgc-start"
                id="sgc-start"
                label={`${s[2]} (${(draftPicks.get(channel.id) ?? []).length})`}
                action={() => startCall(channel, draftPicks.get(channel.id) ?? [])}
            />
        );
        items.push(
            <Menu.MenuItem key="sgc-ring-who" id="sgc-ring-who" label={s[1]}>
                {sub}
            </Menu.MenuItem>
        );
    }

    return items;
}

function PickerMenu({ channel }: { channel: Channel; }) {
    const [, rerender] = useState(0);
    const s = getStrings();

    return (
        <Menu.Menu
            navId="silent-group-call-picker"
            onClose={() => FluxDispatcher.dispatch({ type: "CONTEXT_MENU_CLOSE" })}
            aria-label={s[1]}
        >
            <Menu.MenuGroup label={s[1]}>
                {getMemberItems(channel, () => rerender(n => n + 1), "sgc-picker")}
            </Menu.MenuGroup>
            <Menu.MenuSeparator />
            <Menu.MenuGroup>
                <Menu.MenuItem
                    id="sgc-picker-start"
                    label={`${s[2]} (${(draftPicks.get(channel.id) ?? []).length})`}
                    action={() => startCall(channel, draftPicks.get(channel.id) ?? [])}
                />
            </Menu.MenuGroup>
        </Menu.Menu>
    );
}

function SilentButton() {
    settings.use(["headerButtonUser", "headerButtonGroup"]);
    const channelId = useStateFromStores([SelectedChannelStore], () => SelectedChannelStore.getChannelId());
    const voiceChannelId = useStateFromStores([SelectedChannelStore], () => SelectedChannelStore.getVoiceChannelId());

    const channel = channelId ? ChannelStore.getChannel(channelId) : undefined;
    const kind = getKind(channel);
    if (!channel || !kind || voiceChannelId === channel.id) return null;
    if (!(kind === "group" ? settings.store.headerButtonGroup : settings.store.headerButtonUser)) return null;

    return (
        <ChannelToolbarButton
            tooltip={getStrings()[0]}
            position="bottom"
            icon={BellIcon}
            onClick={() => startCall(channel)}
            onContextMenu={kind === "group"
                ? e => ContextMenuApi.openContextMenu(e, () => <PickerMenu channel={channel} />)
                : undefined}
        />
    );
}

function resolveDM(props: any): Channel | undefined {
    if (props?.channel) return props.channel;
    const id = props?.user?.id && ChannelStore.getDMFromUserId(props.user.id);
    return id ? ChannelStore.getChannel(id) : undefined;
}

function applyMenu(children: any[], channel: Channel | undefined, anchors: string[], expected: Kind) {
    const [, rerender] = useState(0);
    settings.use(["contextMenuUser", "contextMenuGroup"]);

    const kind = getKind(channel);
    if (!channel || kind !== expected) return;
    if (!(expected === "group" ? settings.store.contextMenuGroup : settings.store.contextMenuUser)) return;
    if (SelectedChannelStore.getVoiceChannelId() === channel.id) return;

    const items = getMenuItems(channel, kind, () => rerender(n => n + 1));

    const group = findGroupChildrenByChildId(anchors, children);
    if (group) group.splice(group.findIndex((c: any) => anchors.includes(c?.props?.id)) + 1, 0, ...items);
    else children.push(<Menu.MenuGroup key="sgc-group">{items}</Menu.MenuGroup>);

    debug("context menu entries added", { kind, anchored: !!group });
}

export default definePlugin({
    name: "SilentGroupCall",
    description: "Start DM and group calls without ringing the other members - they can still see and join the call, they just don't get the incoming-call notification. Silent call actions in the context menus and the header bar.",
    authors: [{ name: "gandhistyle", id: 0n }, { name: "zfrancesck1", id: 456195985404592149n }],
    tags: ["Voice", "Utility"],
    dependencies: ["HeaderBarAPI"],
    enabledByDefault: false,
    settings,
    contextMenus: {
        "user-context": (children, props) => applyMenu(children, resolveDM(props), ["call", "user-context-call"], "dm"),
        "gdm-context": (children, props) => applyMenu(children, props?.channel, ["edit-gdm", "gdm-context-edit-gdm"], "group"),
    },
    headerBarButton: {
        icon: BellIcon,
        render: SilentButton,
        location: "channeltoolbar",
    },
    start() {
        if (settings.store.disableOnCanary && (window as any).GLOBAL_ENV?.RELEASE_CHANNEL === "canary") {
            logger.info("running in Discord Canary - staying inactive");
            return;
        }

        if (originalPost) {
            active = true;
            FluxDispatcher.subscribe("VOICE_CHANNEL_SELECT", onVoiceChannelSelect);
            logger.info("re-enabled ring interception");
            return;
        }

        let post: unknown;
        try {
            post = RestAPI?.post;
        } catch (e) {
            logger.error("could not find Discord's HTTP module - plugin inactive", e);
            return;
        }

        if (typeof post !== "function") {
            logger.error("RestAPI.post is not a function - plugin inactive");
            return;
        }

        try {
            originalPost = post as PostFn;
            RestAPI.post = wrappedPost;
        } catch (e) {
            originalPost = null;
            logger.error("RestAPI.post is not writable - plugin inactive", e);
            return;
        }

        active = true;
        FluxDispatcher.subscribe("VOICE_CHANNEL_SELECT", onVoiceChannelSelect);
        logger.info("intercepting call ring requests");
    },

    stop() {
        active = false;
        pendingAutoRings.clear();
        silentCalls.clear();
        draftPicks.clear();
        if (!originalPost) return;

        FluxDispatcher.unsubscribe("VOICE_CHANNEL_SELECT", onVoiceChannelSelect);

        if (RestAPI.post === wrappedPost) {
            try {
                RestAPI.post = originalPost;
                originalPost = null;
            } catch (e) {
                logger.error("failed to restore RestAPI.post", e);
            }
        }

        logger.info("stopped intercepting call ring requests");
    },
});