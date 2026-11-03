/*
 * TrashCord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import managedStyle from "./styles.css?managed";

import { ChannelToolbarButton } from "@api/HeaderBar";
import { definePluginSettings } from "@api/Settings";
import { Card } from "@components/Card";
import { Margins } from "@components/margins";
import { Text } from "@components/Text";
import { Devs } from "@utils/constants";
import { getCurrentChannel, insertTextIntoChatInputBox, sendMessage } from "@utils/discord";
import definePlugin, { OptionType } from "@utils/types";
import type { Message, ToApi, User } from "@velocity-types";
import {
    ChannelActionCreators,
    ChannelActions,
    ChannelStore,
    FluxDispatcher,
    MessageActions,
    NavigationRouter,
    openModal,
    RestAPI,
    ScrollerThin,
    SelectedChannelStore,
    SettingsRouter,
    UserStore,
    useMemo,
    useState,
    VoiceActions,
    VoiceStateStore
} from "@webpack/common";

import { type Action, ControlsPanel } from "./controlsPanel";
import { Categories, cl, decodeCommand } from "./utils";

function ControllerIcon({ width = 24, height = 24, className, color = "currentColor" }: { width?: number; height?: number; className?: string; color?: string; }) {
    return (
        <svg className={className} width={width} height={height} viewBox="0 0 24 24" fill={color} aria-hidden="true">
            <path d="M6.5 6h11A4.5 4.5 0 0 1 22 10.5v3a4.5 4.5 0 0 1-4.5 4.5c-1.3 0-2.1-.5-2.9-1.4L13.9 15h-3.8l-.7.6c-.8.9-1.6 1.4-2.9 1.4A4.5 4.5 0 0 1 2 13.5v-3A4.5 4.5 0 0 1 6.5 6Zm.5 3v1H6v2h1v1h2v-1h1v-2H9V9H7Zm9.5 1a1 1 0 1 0 0 2 1 1 0 0 0 0-2Zm2 2a1 1 0 1 0 0 2 1 1 0 0 0 0-2Z" />
        </svg>
    );
}

type AllowedState = { users: string[]; permissions: Record<string, string[]>; };

let allowedCache: AllowedState | null = null;

function readAllowed(): AllowedState {
    if (allowedCache) return allowedCache;
    const raw = settings.store.allowedUsers as Partial<AllowedState> | undefined;
    const rawUsers = raw?.users;
    const rawPerms = raw?.permissions ?? {};
    allowedCache = {
        users: Array.isArray(rawUsers) ? rawUsers.map(String) : [],
        permissions: Object.fromEntries(
            Object.entries(rawPerms).map(([id, list]) => [id, Array.isArray(list) ? list.map(String) : []])
        )
    };
    return allowedCache;
}

let allowedDirty = false;
const ui = { active: null as string | null, query: "" };

function flushAllowed() {
    if (!allowedDirty || !allowedCache) return;
    allowedDirty = false;
    try {
        settings.store.allowedUsers = allowedCache;
    } catch { }
}

function writeAllowed(next: AllowedState) {
    allowedCache = next;
    allowedDirty = true;
}

interface Bind { ctrl: boolean; alt: boolean; shift: boolean; meta: boolean; code: string; }

let bindRaw = "";
let bind: Bind = { ctrl: true, alt: false, shift: false, meta: false, code: "F9" };

function parseBind(raw: string): Bind {
    const out: Bind = { ctrl: false, alt: false, shift: false, meta: false, code: "" };
    for (const part of raw.split("+")) {
        const p = part.trim().toLowerCase();
        if (!p) continue;
        if (p === "ctrl" || p === "control") out.ctrl = true;
        else if (p === "alt") out.alt = true;
        else if (p === "shift") out.shift = true;
        else if (p === "meta" || p === "cmd" || p === "win") out.meta = true;
        else if (/^f\d{1,2}$/.test(p)) out.code = p.toUpperCase();
        else if (/^[a-z]$/.test(p)) out.code = `Key${p.toUpperCase()}`;
        else if (/^\d$/.test(p)) out.code = `Digit${p}`;
        else out.code = p.charAt(0).toUpperCase() + p.slice(1);
    }
    return out;
}

function onKeyDown(e: KeyboardEvent) {
    if (e.repeat) return;
    const raw = settings.store.keybind || "Ctrl+F9";
    if (raw !== bindRaw) {
        bindRaw = raw;
        bind = parseBind(raw);
    }
    if (!bind.code || e.code !== bind.code) return;
    if (e.ctrlKey !== bind.ctrl || e.altKey !== bind.alt || e.shiftKey !== bind.shift || e.metaKey !== bind.meta) return;
    e.preventDefault();
    openMenu();
}

async function processMessage(message: ToApi<Message>) {
    const currentUserId = UserStore.getCurrentUser()?.id;
    const authorId = message.author?.id;
    if (!authorId) return;

    const decoded = decodeCommand(message.content);
    if (!decoded) return;

    if (authorId === currentUserId) {
        MessageActions.deleteMessage(message.channel_id, message.id);
        return;
    }

    const { users, permissions } = readAllowed();
    if (!users.includes(authorId)) return;
    if (!(permissions[authorId] ?? []).includes(decoded.id)) return;

    const action = getActions(message.author, message.channel_id).find(a => a.id === decoded.id);
    if (action && (!action.predicate || action.predicate(currentUserId!))) {
        await action.execute(decoded.options);
    }
}

function onFluxMessage(event: { message?: ToApi<Message>; optimistic?: boolean; }) {
    const message = event?.message;
    if (!message || event.optimistic) return;
    if (typeof message.content !== "string" || !message.content.includes("\u2060")) return;
    void processMessage(message);
}

interface UserOption { label: string; description: string; value: string; avatar: string; }

function buildOptions(): UserOption[] {
    const out: UserOption[] = [];
    for (const id of ChannelStore.getDMUserIds()) {
        const user = UserStore.getUser(id);
        if (!user) continue;
        out.push({
            label: user.username,
            description: user.globalName ?? "",
            value: user.id,
            avatar: user.getAvatarURL()
        });
    }
    return out;
}

function AllowedUsersComponent() {
    const [state, setState] = useState<AllowedState>(() => readAllowed());
    const [activeUserId, setActiveUserId] = useState<string | null>(ui.active);
    const [query, setQuery] = useState(ui.query);
    const { users, permissions } = state;

    const actions = useMemo(() => getActions(UserStore.getCurrentUser()), []);
    const options = useMemo(buildOptions, []);
    const optionById = useMemo(() => new Map(options.map(o => [o.value, o])), [options]);

    const visibleOptions = useMemo(() => {
        const q = query.trim().toLowerCase();
        const list = q
            ? options.filter(o => o.label.toLowerCase().includes(q) || o.description.toLowerCase().includes(q))
            : options;
        return list.slice(0, 60);
    }, [options, query]);

    const setActive = (id: string | null) => {
        ui.active = id;
        setActiveUserId(id);
    };

    const onQuery = (value: string) => {
        ui.query = value;
        setQuery(value);
    };

    const commit = (next: AllowedState, flush: boolean) => {
        writeAllowed(next);
        if (flush) flushAllowed();
        setState(next);
    };

    const applyUsers = (selectedUsers: string[]) => {
        const current = readAllowed();
        const nextPermissions: Record<string, string[]> = {};
        for (const id of selectedUsers) {
            nextPermissions[id] = current.permissions[id] ?? actions.map(action => action.id);
        }
        commit({ users: selectedUsers, permissions: nextPermissions }, true);
        if (!ui.active || !selectedUsers.includes(ui.active)) {
            setActive(selectedUsers[0] ?? null);
        }
    };

    const toggleUser = (id: string) => {
        const current = readAllowed().users;
        applyUsers(current.includes(id) ? current.filter(u => u !== id) : [...current, id]);
    };

    const removeUser = (id: string) => applyUsers(readAllowed().users.filter(u => u !== id));

    const setPermissions = (userId: string, list: string[]) => {
        const current = readAllowed();
        commit({ users: current.users, permissions: { ...current.permissions, [userId]: list } }, false);
    };

    const togglePermission = (actionId: string) => {
        const id = ui.active;
        if (!id) return;
        const current = readAllowed().permissions[id] ?? [];
        setPermissions(id, current.includes(actionId) ? current.filter(a => a !== actionId) : [...current, actionId]);
    };

    const activeSelectedUser = activeUserId ? optionById.get(activeUserId) : undefined;
    const activePermissions = activeUserId ? permissions[activeUserId] ?? [] : [];

    return (
        <div onMouseLeave={flushAllowed}>
            <div className={cl("users-head")}>
                <div>
                    <Text size="md" weight="semibold">Allowed Users</Text>
                    <Text size="sm" color="text-muted">Select users that can execute actions on your account</Text>
                </div>
                {users.length > 0 && (
                    <button type="button" className={cl("btn", "btn-secondary")} onClick={() => applyUsers([])}>
                        Clear all
                    </button>
                )}
            </div>
            <input
                className={cl("users-search")}
                type="text"
                placeholder="Search users..."
                value={query}
                onChange={e => onQuery(e.target.value)}
            />
            <div className={cl("users-list")}>
                <ScrollerThin className={cl("perms-scroller")}>
                    {visibleOptions.map(opt => (
                        <label key={opt.value} className={cl("user-row")}>
                            <input
                                type="checkbox"
                                checked={users.includes(opt.value)}
                                onChange={() => toggleUser(opt.value)}
                            />
                            <img className={cl("perms-item-avatar")} src={opt.avatar} loading="lazy" decoding="async" />
                            <Text className={cl("perms-item-text")}>{opt.label}</Text>
                        </label>
                    ))}
                </ScrollerThin>
            </div>
            {users.length > 0 && (
                <div className={Margins.top16}>
                    <Text size="md" weight="semibold">Permissions</Text>
                    <Text size="sm" color="text-muted" className={Margins.bottom8}>Control which actions users can execute on you</Text>
                    <div className={cl("perms-container")}>
                        <div className={cl("perms-left")}>
                            <ScrollerThin className={cl("perms-scroller")}>
                                {users.map(userId => {
                                    const userOpt = optionById.get(userId);
                                    return (
                                        <div key={userId} className={cl("perms-item-bttn")}>
                                            <div
                                                onClick={() => setActive(userId)}
                                                className={`${cl("perms-item")} ${activeUserId === userId ? cl("perms-item-active") : ""}`}
                                            >
                                                <img className={cl("perms-item-avatar")} src={userOpt?.avatar} loading="lazy" decoding="async" />
                                                <Text className={cl("perms-item-text")}>
                                                    {userOpt?.label || userId}
                                                </Text>
                                                <button
                                                    type="button"
                                                    title="Remove"
                                                    className={cl("btn", "btn-secondary", "perms-item-remove")}
                                                    onClick={e => {
                                                        e.stopPropagation();
                                                        removeUser(userId);
                                                    }}
                                                >
                                                    ✕
                                                </button>
                                            </div>
                                        </div>
                                    );
                                })}
                            </ScrollerThin>
                        </div>

                        <div className={cl("perms-right")}>
                            {activeUserId ? (
                                <ScrollerThin className={cl("perms-scroller")}>
                                    <div className={cl("perms-head")}>
                                        <Text size="md" weight="semibold">
                                            Permissions for {activeSelectedUser?.label ?? activeUserId}
                                        </Text>
                                        <div className={cl("perms-head-btns")}>
                                            <button
                                                type="button"
                                                className={cl("btn", "btn-secondary")}
                                                onClick={() => setPermissions(activeUserId, actions.map(action => action.id))}
                                            >
                                                All
                                            </button>
                                            <button
                                                type="button"
                                                className={cl("btn", "btn-secondary")}
                                                onClick={() => setPermissions(activeUserId, [])}
                                            >
                                                None
                                            </button>
                                        </div>
                                    </div>
                                    {actions.map(action => (
                                        <label key={action.id} className={cl("perm-row")}>
                                            <input
                                                type="checkbox"
                                                checked={activePermissions.includes(action.id)}
                                                onChange={() => togglePermission(action.id)}
                                            />
                                            <div className={cl("perm-text")}>
                                                <Text size="md" weight="medium">{action.label}</Text>
                                                <Text size="sm" color="text-muted">{action.description}</Text>
                                            </div>
                                        </label>
                                    ))}
                                </ScrollerThin>
                            ) : (
                                <Text color="text-muted">Select a user from the left to configure actions.</Text>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

const settings = definePluginSettings({
    showButton: {
        type: OptionType.BOOLEAN,
        description: "Show the Controller button in the channel toolbar",
        default: true
    },
    keybind: {
        type: OptionType.STRING,
        description: "Shortcut to open the control panel (examples: Ctrl+F9, Ctrl+Shift+K, Alt+F8)",
        default: "Ctrl+F9"
    },
    allowedUsers: {
        type: OptionType.COMPONENT,
        component: AllowedUsersComponent,
        default: { users: [], permissions: {} } as { users: string[]; permissions: Record<string, string[]>; }
    }
});

const getActions = (target: User, channelId?: string): Action[] => {
    const isInVoice = (selfId: string) => !!VoiceStateStore.getVoiceStateForUser(selfId)?.channelId;

    return [
        {
            id: "openSettings",
            label: "Open User Settings",
            description: "Opens the user settings modal, in addition with a path.",
            options: {
                text: {
                    type: OptionType.STRING,
                    description: "Panel node key",
                    default: ""
                }
            },
            execute: options => SettingsRouter.openUserSettings(options.text)
        },
        {
            id: "mentionUser",
            label: "Mention",
            description: "Sends a command message that triggers a mention on the target's client",
            category: Categories.CHAT,
            execute: async () => await sendMessage(channelId ?? SelectedChannelStore.getChannelId(), { content: `<@${target.id}>` })
        },
        {
            id: "typeInChat",
            label: "Type in Chat",
            description: "Types text into the target's chat input box and optionally sends it",
            category: Categories.CHAT,
            options: {
                text: {
                    type: OptionType.STRING,
                    description: "Text to insert",
                    default: ""
                },
                send: {
                    type: OptionType.BOOLEAN,
                    description: "Send the message after typing it",
                    default: true
                }
            },
            execute: options => {
                const text = options.text ?? "";
                if (!text) return;
                const channel = SelectedChannelStore.getChannelId();
                if (options.send && channel) {
                    void sendMessage(channel, { content: text });
                    return;
                }
                insertTextIntoChatInputBox(text);
            }
        },
        {
            id: "callUser",
            label: "Call User",
            description: "Makes the target user start a voice call",
            category: Categories.VOICE,
            execute: () => ChannelActionCreators.openPrivateChannel({ recipientIds: target.id, joinCall: true })
        },
        {
            id: "leaveCall",
            label: "Leave Call",
            description: "Makes the target user disconnect from their current voice call",
            category: Categories.VOICE,
            predicate: isInVoice,
            execute: () => ChannelActions.disconnect()
        },
        {
            id: "mute",
            label: "Mute",
            description: "Toggles self-mute on the target's client",
            category: Categories.VOICE,
            predicate: isInVoice,
            execute: () => VoiceActions.toggleSelfMute()
        },
        {
            id: "deafen",
            label: "Deafen",
            description: "Toggles self-deafen on the target's client",
            category: Categories.VOICE,
            predicate: isInVoice,
            execute: () => VoiceActions.toggleSelfDeaf()
        },
        {
            id: "setStatus",
            label: "Set Status",
            description: "Changes the target's active presence status",
            category: Categories.USER,
            options: {
                status: {
                    type: OptionType.SELECT,
                    options: [
                        { label: "Online", value: "online", default: true },
                        { label: "Idle", value: "idle" },
                        { label: "Do Not Disturb", value: "dnd" },
                        { label: "Invisible", value: "invisible" }
                    ],
                    description: "Status to change to",
                    default: "online"
                }
            },
            execute: options => {
                RestAPI.patch({
                    url: "/users/@me/settings",
                    body: {
                        status: options.status
                    }
                });
            }
        },
        {
            id: "setCustomStatus",
            label: "Set Custom Status",
            description: "Updates the custom text status on the target's client",
            category: Categories.USER,
            options: {
                text: {
                    type: OptionType.STRING,
                    description: "Status text to set",
                    default: ""
                }
            },
            execute: options => {
                RestAPI.patch({
                    url: "/users/@me/settings",
                    body: {
                        custom_status: {
                            text: options.text
                        }
                    }
                });
            }
        },
        {
            id: "setTheme",
            label: "Set Theme",
            description: "Changes the target's theme",
            category: Categories.USER,
            options: {
                theme: {
                    type: OptionType.SELECT,
                    options: [
                        { label: "Light", value: "light", default: true },
                        { label: "Ash", value: "dark" },
                        { label: "Dark", value: "darker" },
                        { label: "Onyx", value: "midnight" }
                    ],
                    description: "Which theme to change",
                    default: "light"
                }
            },
            execute: options => {
                RestAPI.patch({
                    url: "/users/@me/settings",
                    body: {
                        theme: options.theme
                    }
                });
            }
        },
        {
            id: "setLocale",
            label: "Set Locale",
            description: "Changes the target's locale language",
            category: Categories.USER,
            options: {
                locale: {
                    type: OptionType.SELECT,
                    options: [
                        { label: "Bulgarian (български)", value: "bg" },
                        { label: "Chinese Simplified (简体中文)", value: "zh-CN" },
                        { label: "Chinese Traditional (繁體中文)", value: "zh-TW" },
                        { label: "Croatian (Hrvatski)", value: "hr" },
                        { label: "Czech (Čeština)", value: "cs" },
                        { label: "Danish (Dansk)", value: "da" },
                        { label: "Dutch (Nederlands)", value: "nl" },
                        { label: "English (UK)", value: "en-GB" },
                        { label: "English (US)", value: "en-US", default: true },
                        { label: "Finnish (Suomi)", value: "fi" },
                        { label: "French (Français)", value: "fr" },
                        { label: "German (Deutsch)", value: "de" },
                        { label: "Greek (Ελληνικά)", value: "el" },
                        { label: "Hindi (हिन्दी)", value: "hi" },
                        { label: "Hungarian (Magyar)", value: "hu" },
                        { label: "Italian (Italiano)", value: "it" },
                        { label: "Japanese (日本語)", value: "ja" },
                        { label: "Korean (한국어)", value: "ko" },
                        { label: "Lithuanian (Lietuvių)", value: "lt" },
                        { label: "Norwegian (Norsk)", value: "no" },
                        { label: "Polish (Polski)", value: "pl" },
                        { label: "Portuguese, Brazilian (Português do Brasil)", value: "pt-BR" },
                        { label: "Romanian (Română)", value: "ro" },
                        { label: "Russian (Русский)", value: "ru" },
                        { label: "Spanish, Spain (Español de España)", value: "es-ES" },
                        { label: "Spanish, LATAM (Español de América Latina)", value: "es-419" },
                        { label: "Swedish (Svenska)", value: "sv-SE" },
                        { label: "Thai (ไทย)", value: "th" },
                        { label: "Turkish (Türkçe)", value: "tr" },
                        { label: "Ukrainian (Українська)", value: "uk" },
                        { label: "Vietnamese (Tiếng Việt)", value: "vi" }
                    ],
                    description: "Which language to change",
                    default: "en-US"
                }
            },
            execute: options => {
                RestAPI.patch({
                    url: "/users/@me/settings",
                    body: {
                        locale: options.locale
                    }
                });
            }
        },
        {
            id: "openChannel",
            label: "Open Channel",
            description: "Changes the active channel focused on the target's client",
            options: {
                guildId: {
                    type: OptionType.STRING,
                    description: "Guild ID (use '@me' for private messages/DMs)",
                    default: "@me"
                },
                channelId: {
                    type: OptionType.STRING,
                    description: "Channel ID",
                    default: ""
                }
            },
            execute: options => {
                if (options.channelId) {
                    NavigationRouter.transitionTo(`/channels/${options.guildId || "@me"}/${options.channelId}`);
                }
            }
        },
        {
            id: "reload",
            label: "Reload",
            description: "Reloads the target's Discord client",
            category: Categories.SYSTEM,
            execute: () => location.reload()
        },
        {
            id: "crash",
            label: "Crash",
            description: "Crashes the target's Discord client",
            category: Categories.SYSTEM,
            execute: () => window.DiscordErrors.softCrash({ message: "Unexpected crash" })
        }
    ];
};

function openMenu() {
    const recipientId = getCurrentChannel()?.recipients?.find(id => id !== UserStore.getCurrentUser()?.id);
    if (!recipientId) return;

    const target = UserStore.getUser(recipientId);
    if (!target) return;
    void openModal(({ actions: _, ...props }) => <ControlsPanel actions={getActions(target)} target={target} {...props} />);
}

function ToolbarButton() {
    const show = typeof settings.use === "function"
        ? settings.use(["showButton"]).showButton
        : settings.store.showButton;
    if (show === false) return null;
    return (
        <ChannelToolbarButton
            tooltip="Control Users Panel"
            icon={ControllerIcon}
            onClick={openMenu}
        />
    );
}

export default definePlugin({
    name: "ControlUsers",
    description: "Allows you to make other users do specific prebuilt actions when sending message. (requires other user to have this plugin enabled)",
    authors: [Devs.RoScripter999, { name: "zFrxncesck1", id: 456195985404592149n }],
    tags: ["Commands", "Voice", "Chat", "Utility"],
    enabledByDefault: false,
    managedStyle,
    settings,
    settingsAboutComponent: () => (
        <Card padding="sm">
            <Text size="md">Open the control menu inside a DM with the shortcut set below (default Ctrl+F9) or with the Controller icon in the Channel Bar</Text>
        </Card>
    ),

    headerBarButton: {
        location: "channeltoolbar",
        required: true,
        icon: () => ControllerIcon,
        render: () => <ToolbarButton />
    },

    start() {
        allowedCache = null;
        FluxDispatcher.subscribe("MESSAGE_CREATE", onFluxMessage);
        window.addEventListener("keydown", onKeyDown, true);
    },

    stop() {
        flushAllowed();
        allowedCache = null;
        FluxDispatcher.unsubscribe("MESSAGE_CREATE", onFluxMessage);
        window.removeEventListener("keydown", onKeyDown, true);
    }
});