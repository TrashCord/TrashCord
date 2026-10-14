import { NavContextMenuPatchCallback } from "@api/ContextMenu";
import { HeaderBarButton } from "@api/HeaderBar";
import { definePluginSettings } from "@api/Settings";
import { HeadingSecondary } from "@components/Heading";
import { openPluginModal } from "@components/settings/tabs/plugins/PluginModal";
import definePlugin, { makeRange, OptionType } from "@utils/types";
import {
    Button, ChannelStore, GuildChannelStore, GuildStore, Menu, PermissionsBits, PermissionStore,
    RestAPI, showToast, useEffect, UserStore, useState, VoiceStateStore,
} from "@webpack/common";
import type { SVGProps } from "react";

interface VoiceState {
    userId: string;
    channelId?: string;
    oldChannelId?: string;
}

interface Target {
    id: string;
    guild_id: string;
}

const OP_OPTIONS = [
    { label: "Off", value: "off", default: true },
    { label: "More than", value: ">" },
    { label: "Less than", value: "<" },
    { label: "Equal to", value: "==" },
] as const;

function Separator(title: string) {
    return (
        <>
            <hr style={{ width: "100%" }} />
            <HeadingSecondary>{title}</HeadingSecondary>
            <hr style={{ width: "100%" }} />
        </>
    );
}

const settings = definePluginSettings({
    targetUserIds: {
        type: OptionType.STRING,
        description: "Targeted user IDs (managed automatically)",
        restartNeeded: false,
        hidden: true,
        default: "[]",
    },
    _sepGeneral: {
        type: OptionType.COMPONENT,
        description: "",
        component: () => Separator("🎲 VoiceRandomUser"),
    },
    showToasts: {
        type: OptionType.BOOLEAN,
        description: "Show toast notifications",
        restartNeeded: false,
        default: true,
    },
    moveDelay: {
        type: OptionType.NUMBER,
        description: "Delay in milliseconds before moving a user (0 = instant)",
        default: 0,
    },
    reshuffleSeconds: {
        type: OptionType.NUMBER,
        description: "Move the user again to another random channel every N seconds after each move (0 = only when they join a channel)",
        default: 0,
    },
    excludedChannels: {
        type: OptionType.STRING,
        description: "Channel IDs to never move users into (slash-separated, e.g. 123456789/987654321)",
        default: "",
    },
    avoidStages: {
        type: OptionType.BOOLEAN,
        description: "Avoid stage channels",
        default: false,
    },
    avoidAFK: {
        type: OptionType.BOOLEAN,
        description: "Avoid the AFK channel",
        default: false,
    },
    _sepFilters: {
        type: OptionType.COMPONENT,
        description: "",
        component: () => Separator("🔢 Channel Filters"),
    },
    userAmountOperation: {
        type: OptionType.SELECT,
        description: "User amount filter operation (Off ignores this filter)",
        options: [...OP_OPTIONS],
    },
    userAmount: {
        type: OptionType.SLIDER,
        description: "Target user amount in candidate channels",
        markers: makeRange(0, 15, 1),
        default: 3,
        stickToMarkers: true,
    },
    spacesLeftOperation: {
        type: OptionType.SELECT,
        description: "Spaces left filter operation (Off ignores this filter)",
        options: [...OP_OPTIONS],
    },
    spacesLeft: {
        type: OptionType.SLIDER,
        description: "Target spaces left in candidate channels",
        markers: makeRange(0, 15, 1),
        default: 3,
        stickToMarkers: true,
    },
    vcLimitOperation: {
        type: OptionType.SELECT,
        description: "Voice channel limit filter operation (Off ignores this filter)",
        options: [...OP_OPTIONS],
    },
    vcLimit: {
        type: OptionType.SLIDER,
        description: "Target user limit of candidate channels",
        markers: makeRange(1, 15, 1),
        default: 5,
        stickToMarkers: true,
    },
    _sepStates: {
        type: OptionType.COMPONENT,
        description: "",
        component: () => Separator("🎭 State Filters"),
    },
    filterVideo: {
        type: OptionType.BOOLEAN,
        description: "Match users with camera on",
        default: false,
    },
    filterStream: {
        type: OptionType.BOOLEAN,
        description: "Match users who are streaming",
        default: false,
    },
    filterMute: {
        type: OptionType.BOOLEAN,
        description: "Match users who are muted",
        default: false,
    },
    filterDeafen: {
        type: OptionType.BOOLEAN,
        description: "Match users who are deafened",
        default: false,
    },
    includeStates: {
        type: OptionType.BOOLEAN,
        description: "Only use channels containing a user matching all selected states",
        default: false,
    },
    avoidStates: {
        type: OptionType.BOOLEAN,
        description: "Avoid channels containing a user matching all selected states",
        default: false,
    },
});

const MAX_ACTIVE = 3;
const THROTTLE_MS = 3000;
const IGNORED_CODES = new Set([40032, 10007]);

const followed = new Set<string>();
const listeners = new Set<() => void>();
const queue = new Map<string, Target>();
const tries = new Map<string, number>();
const known = new Map<string, string | null>();
const expected = new Map<string, string>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();
const lastToast = new Map<string, number>();
let followedList: string[] = [];
let active = 0;

function emit() {
    followedList = [...followed];
    listeners.forEach(fn => fn());
}

function commit() {
    emit();
    settings.store.targetUserIds = JSON.stringify(followedList);
}

function load() {
    followed.clear();
    try {
        const parsed = JSON.parse(settings.store.targetUserIds);
        if (Array.isArray(parsed)) for (const id of parsed) if (typeof id === "string") followed.add(id);
    } catch { }
    emit();
}

function useFollowedIds() {
    const [, tick] = useState(0);
    useEffect(() => {
        const fn = () => tick(n => n + 1);
        listeners.add(fn);
        return () => { listeners.delete(fn); };
    }, []);
    return followedList;
}

function toast(message: string, type: "success" | "failure" | "message") {
    if (settings.store.showToasts) showToast(message, type);
}

function throttledToast(message: string, type: "success" | "failure" | "message") {
    const now = Date.now();
    if (now - (lastToast.get(message) ?? 0) < THROTTLE_MS) return;
    lastToast.set(message, now);
    toast(message, type);
}

function Dice({ className, width = 24, height = 24, stopped }: SVGProps<SVGSVGElement> & { stopped?: boolean; }) {
    return (
        <svg className={className} width={width} height={height} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <g opacity={stopped ? 0.55 : 1}>
                <rect x="3" y="3" width="18" height="18" rx="4" />
                <circle cx="8" cy="8" r="1.2" fill="currentColor" />
                <circle cx="16" cy="8" r="1.2" fill="currentColor" />
                <circle cx="12" cy="12" r="1.2" fill="currentColor" />
                <circle cx="8" cy="16" r="1.2" fill="currentColor" />
                <circle cx="16" cy="16" r="1.2" fill="currentColor" />
            </g>
            {stopped && <line x1="3" y1="21" x2="21" y2="3" stroke="var(--status-danger)" strokeWidth="2.5" />}
        </svg>
    );
}

function DiceIcon(props: SVGProps<SVGSVGElement>) {
    return <Dice {...props} />;
}

function StopDiceIcon(props: SVGProps<SVGSVGElement>) {
    return <Dice {...props} stopped />;
}

function getName(userId: string) {
    return UserStore.getUser(userId)?.username ?? userId;
}

function compare(op: string, a: number, b: number) {
    if (op === ">") return a > b;
    if (op === "<") return a < b;
    if (op === "==") return a === b;
    return true;
}

function pickChannel(guildId: string, excludeId: string): string | null {
    const c = settings.store;
    const entries: any[] = GuildChannelStore.getChannels(guildId)?.VOCAL ?? [];
    const excluded = new Set(c.excludedChannels.split(/[/,\s]+/));
    const afkId = GuildStore.getGuild(guildId)?.afkChannelId;

    const keys: string[] = [];
    if (c.filterVideo) keys.push("selfVideo");
    if (c.filterStream) keys.push("selfStream");
    if (c.filterMute) keys.push("selfMute");
    if (c.filterDeafen) keys.push("selfDeaf");
    const useStates = keys.length > 0 && (c.avoidStates || c.includeStates);

    let picked: string | null = null;
    let seen = 0;

    for (const entry of entries) {
        const ch = entry.channel ?? entry;
        const id: string | undefined = ch?.id;
        if (!id || id === excludeId || excluded.has(id)) continue;
        if (c.avoidStages && ch.isGuildStageVoice?.()) continue;
        if (c.avoidAFK && id === afkId) continue;
        if (!PermissionStore.can(PermissionsBits.CONNECT, ch) || !PermissionStore.can(PermissionsBits.MOVE_MEMBERS, ch)) continue;

        const states = Object.values(VoiceStateStore.getVoiceStatesForChannel(id) ?? {}) as any[];
        const count = states.length;
        const limit = ch.userLimit || 99;
        if (count >= limit) continue;
        if (!compare(c.userAmountOperation, count, c.userAmount)) continue;
        if (!compare(c.spacesLeftOperation, limit - count, c.spacesLeft)) continue;
        if (!compare(c.vcLimitOperation, limit, c.vcLimit)) continue;

        if (useStates) {
            const any = states.some(s => keys.every(k => s[k]));
            if (c.avoidStates ? any : !any) continue;
        }

        if (Math.random() * ++seen < 1) picked = id;
    }

    return picked;
}

function fail(userId: string) {
    tries.delete(userId);
    expected.delete(userId);
}

function drain() {
    while (active < MAX_ACTIVE && queue.size) {
        const [userId, target] = queue.entries().next().value as [string, Target];
        queue.delete(userId);
        if (!followed.has(userId)) continue;

        active++;

        Promise.resolve()
            .then(() => RestAPI.patch({
                url: `/guilds/${target.guild_id}/members/${userId}`,
                body: { channel_id: target.id },
            }))
            .then(() => { tries.delete(userId); })
            .catch((e: any) => {
                if (e?.status === 403) {
                    fail(userId);
                    throttledToast("VoiceRandomUser: no permission to move members", "failure");
                    return;
                }

                const ignored = IGNORED_CODES.has(e?.body?.code);
                const n = tries.get(userId) ?? 0;

                if (!ignored && n < 1) {
                    tries.set(userId, n + 1);
                    if (!queue.has(userId)) queue.set(userId, target);
                    return;
                }

                fail(userId);
                if (!ignored) throttledToast(`VoiceRandomUser: move failed (${e?.status ?? "error"})`, "failure");
            })
            .finally(() => {
                active--;
                drain();
            });
    }
}

function run(userId: string) {
    if (!followed.has(userId)) return;

    const from = known.get(userId);
    if (!from) return;

    const guildId = ChannelStore.getChannel(from)?.guild_id;
    if (!guildId) return;

    const target = pickChannel(guildId, from);
    if (!target) {
        throttledToast("VoiceRandomUser: no suitable channel found", "failure");
        return;
    }

    expected.set(userId, target);
    queue.set(userId, { id: target, guild_id: guildId });
    drain();
}

function plan(userId: string, delay: number) {
    clearTimeout(timers.get(userId));
    timers.delete(userId);

    if (delay > 0) {
        timers.set(userId, setTimeout(() => {
            timers.delete(userId);
            run(userId);
        }, delay));
    } else {
        run(userId);
    }
}

function forget(userId: string) {
    clearTimeout(timers.get(userId));
    timers.delete(userId);
    queue.delete(userId);
    tries.delete(userId);
    known.delete(userId);
    expected.delete(userId);
}

function followUser(userId: string) {
    if (followed.has(userId)) return;
    followed.add(userId);
    commit();

    const channelId = VoiceStateStore.getVoiceStateForUser(userId)?.channelId;
    if (channelId) {
        known.set(userId, channelId);
        plan(userId, settings.store.moveDelay);
    }

    toast(`VoiceRandomUser: user added [${getName(userId)}]`, "success");
}

function unfollowUser(userId: string) {
    if (!followed.delete(userId)) return;
    forget(userId);
    commit();
    toast(`VoiceRandomUser: user removed [${getName(userId)}]`, "message");
}

function unfollowAll() {
    const n = followed.size;
    if (!n) return;
    for (const id of followed) forget(id);
    followed.clear();
    commit();
    toast(`VoiceRandomUser: ${n} user${n === 1 ? "" : "s"} cleared`, "failure");
}

function TrackedUsersList() {
    const ids = useFollowedIds();

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            <span style={{ color: "var(--text-brand)", fontWeight: 700, fontSize: "13px", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                Targeted Users {ids.length > 0 ? `(${ids.length})` : ""}
            </span>
            {ids.length === 0
                ? <span style={{ color: "var(--text-muted)", fontSize: "13px" }}>No users targeted. Right-click a user to add them.</span>
                : (
                    <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                        <div style={{ display: "flex", flexDirection: "column", gap: "4px", maxHeight: "220px", overflowY: "auto", paddingRight: "4px" }}>
                            {ids.map(id => (
                                <div key={id} style={{
                                    display: "flex", alignItems: "center", justifyContent: "space-between",
                                    background: "var(--background-tertiary)", borderRadius: "6px", padding: "6px 10px",
                                    border: "1px solid var(--background-modifier-accent)", flexShrink: 0,
                                }}>
                                    <div style={{ display: "flex", flexDirection: "column" }}>
                                        <span style={{ color: "var(--text-link)", fontSize: "14px", fontWeight: 700 }}>
                                            {UserStore.getUser(id)?.username ?? "Unknown User"}
                                        </span>
                                        <span style={{ color: "var(--text-muted)", fontSize: "11px" }}>{id}</span>
                                    </div>
                                    <Button size={Button.Sizes.SMALL} color={Button.Colors.RED} onClick={() => unfollowUser(id)}>Remove</Button>
                                </div>
                            ))}
                        </div>
                        <Button style={{ marginTop: "4px" }} size={Button.Sizes.SMALL} color={Button.Colors.RED} onClick={unfollowAll}>Clear All</Button>
                    </div>
                )}
        </div>
    );
}

const UserContextMenuPatch: NavContextMenuPatchCallback = (children, props) => {
    const userId: string | undefined = props?.user?.id;
    if (!userId || userId === UserStore.getCurrentUser()?.id) return;

    const isFollowed = followed.has(userId);
    const icon = isFollowed ? StopDiceIcon : DiceIcon;

    children.splice(-1, 0, (
        <Menu.MenuGroup key="voice-random-user-group">
            <Menu.MenuItem
                id="voice-random-user-ctx"
                color={isFollowed ? "danger" : undefined}
                label={isFollowed ? "Stop Voice Random User" : "Voice Random User"}
                icon={icon}
                leadingAccessory={{ type: "icon", icon }}
                action={() => isFollowed ? unfollowUser(userId) : followUser(userId)}
            />
        </Menu.MenuGroup>
    ));
};

function VoiceRandomUserHeaderButton() {
    const ids = useFollowedIds();
    if (!ids.length) return null;

    const shown = ids.slice(0, 3).map(getName).join(", ");
    const extra = ids.length > 3 ? ` +${ids.length - 3}` : "";

    return (
        <HeaderBarButton
            icon={StopDiceIcon}
            tooltip={`VoiceRandomUser: ${shown}${extra} (click to stop all)`}
            onClick={unfollowAll}
        />
    );
}

export default definePlugin({
    name: "VoiceRandomUser",
    description: "Moves targeted users to a random voice channel every time they join one, until you stop it (if you have permissions). Right-click a user -> Voice Random User.",
    authors: [{ name: "zfrancesck1", id: 456195985404592149n }],
    tags: ["Voice", "Friends", "Utility"],
    enabledByDefault: false,
    dependencies: ["HeaderBarAPI"],
    settings,
    settingsAboutComponent: TrackedUsersList,

    toolboxActions: {
        "Open VoiceRandomUser Settings": () => openPluginModal(Vencord.Plugins.plugins.VoiceRandomUser),
    },

    headerBarButton: {
        icon: DiceIcon,
        render: VoiceRandomUserHeaderButton,
        priority: 7,
    },

    contextMenus: {
        "user-context": UserContextMenuPatch,
        "user-profile-actions": UserContextMenuPatch,
    },

    start() {
        load();
    },

    stop() {
        for (const id of followed) forget(id);
        followed.clear();
        queue.clear();
        lastToast.clear();
        active = 0;
        commit();
    },

    flux: {
        VOICE_STATE_UPDATES({ voiceStates }: { voiceStates: VoiceState[]; }) {
            if (!followed.size) return;

            for (const s of voiceStates) {
                const id = s.userId;
                if (!followed.has(id)) continue;

                const channelId = s.channelId ?? null;
                if (known.get(id) === channelId) continue;
                known.set(id, channelId);

                if (!channelId) {
                    clearTimeout(timers.get(id));
                    timers.delete(id);
                    expected.delete(id);
                    continue;
                }

                if (expected.get(id) === channelId) {
                    expected.delete(id);
                    const again = settings.store.reshuffleSeconds;
                    if (again > 0) plan(id, again * 1000);
                    continue;
                }

                plan(id, settings.store.moveDelay);
            }
        },
    },
});