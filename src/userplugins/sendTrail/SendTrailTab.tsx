/*
 * TrashCord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { BaseText } from "@components/BaseText";
import { Button, TextButton } from "@components/Button";
import { Card } from "@components/Card";
import { Heading } from "@components/Heading";
import { CogWheel, DeleteIcon, LogIcon, MagnifyingGlassIcon, OpenExternalIcon } from "@components/Icons";
import { Notice } from "@components/Notice";
import { Paragraph } from "@components/Paragraph";
import { SettingsTab, wrapTab } from "@components/settings";
import { SpecialCard } from "@components/settings/SpecialCard";
import { Switch } from "@components/Switch";
import { classNameFactory } from "@utils/css";
import { Margins } from "@utils/margins";
import { sleep } from "@utils/misc";
import type { Channel, RenderModalProps, ToastVariant, User } from "@vencord/discord-types";
import { Alerts, ChannelStore, IconUtils, MessageActions, Modal, NavigationRouter, openModal, React, Select, showToast as showDiscordToast, TextInput, UserStore, UserUtils, useStateFromStores } from "@webpack/common";

import { BRAND_ICON_DATA_URL, BRAND_NAME } from "../_kamidereCompat/branding";
import { getKamidereRuntimeTask, removeKamidereRuntimeTask, SEND_TRAIL_PURGE_TASK_ID, subscribeKamidereRuntimeActivity, upsertKamidereRuntimeTask } from "../_kamidereCompat/runtimeActivity";
import { parseIdList, SendTrailPurgeTarget, settings } from "./settings";
import { clearSentTrailRecords, removeSentTrailRecord, useSentTrailRecords } from "./store";
import type { SentTrailMediaItem, SentTrailRecord } from "./types";
import { buildSearchIndex, formatDayLabel, formatTime, getRecordRecipientIds, recordMatchesScope, resolveRecordContext } from "./utils";

type ScopeValue = "all" | "dms" | `guild:${string}`;
type KindValue = "all" | "text" | "media";
type PeriodValue = "all" | "24h" | "7d";
type PageSizeValue = "5" | "10" | "20" | "30" | "50";
type PurgePhase = "idle" | "running" | "success" | "partial" | "failure";
type IdListKey = "protectedDmChannels" | "protectedDmUserIds";

interface Option<T extends string> {
    label: string;
    value: T;
}

interface PurgeStatus {
    phase: PurgePhase;
    total: number;
    processed: number;
    deleted: number;
    failed: number;
    skipped: number;
    currentLabel?: string;
}

interface RawUser {
    avatar?: string | null;
    username?: string;
    globalName?: string;
    global_name?: string;
}

interface UserIdentity {
    label: string;
    details: string;
    avatarUrl: string;
}

interface DmConversation {
    channelId: string;
    label: string;
    details: string;
    count: number;
}

interface DmUserContact extends UserIdentity {
    userId: string;
    count: number;
}

const cl = classNameFactory("vc-send-trail-");
const DELETE_DELAY_MS = 850;
const PURGE_SETTINGS: Array<keyof typeof settings.def> = ["purgeTarget", "protectAllDms", "protectedDmChannels", "protectedDmUserIds"];
const EMPTY_STATUS: PurgeStatus = { phase: "idle", total: 0, processed: 0, deleted: 0, failed: 0, skipped: 0 };
const HERO_BACKGROUND = `data:image/svg+xml;utf8,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 4"><rect width="8" height="4" fill="#27221d"/></svg>')}`;
const requestedUsers = new Set<string>();

const PURGE_TARGET_OPTIONS: Option<SendTrailPurgeTarget>[] = [
    { label: "Everything", value: "all" },
    { label: "Direct Messages only", value: "dms" },
    { label: "Servers only", value: "servers" },
];
const PERIOD_OPTIONS: Option<PeriodValue>[] = [
    { label: "All time", value: "all" },
    { label: "Last 24 hours", value: "24h" },
    { label: "Last 7 days", value: "7d" },
];
const KIND_OPTIONS: Option<KindValue>[] = [
    { label: "Everything", value: "all" },
    { label: "Text only", value: "text" },
    { label: "Media only", value: "media" },
];
const PAGE_SIZE_OPTIONS: Option<PageSizeValue>[] = [
    { label: "5", value: "5" },
    { label: "10", value: "10" },
    { label: "20", value: "20" },
    { label: "30", value: "30" },
    { label: "50", value: "50" },
];

function showToast(message: string, variant: ToastVariant) {
    showDiscordToast({ text: message, variant, position: "bottom" });
}

function plural(count: number, one: string, many = `${one}s`) {
    return `${count} ${count === 1 ? one : many}`;
}

function isDm(record: SentTrailRecord) {
    return record.guildId === "@me";
}

function isProtected(
    record: SentTrailRecord,
    purgeTarget: SendTrailPurgeTarget,
    protectAllDms: boolean,
    protectedChannels: Set<string>,
    protectedUsers: Set<string>,
) {
    const dm = isDm(record);

    if (purgeTarget === "dms" && !dm) return true;
    if (purgeTarget === "servers" && dm) return true;
    if (!dm) return false;
    if (protectAllDms || protectedChannels.has(record.channelId)) return true;
    return getRecordRecipientIds(record).some(id => protectedUsers.has(id));
}

function identityFromUser(userId: string, user: RawUser): UserIdentity {
    const name = user.globalName || user.global_name;

    return {
        label: name || user.username || userId,
        details: user.username && name && name !== user.username ? `@${user.username}` : `User ID ${userId}`,
        avatarUrl: user.avatar
            ? IconUtils.getUserAvatarURL({ id: userId, avatar: user.avatar } as User, true, 80)
            : IconUtils.getDefaultAvatarURL(userId),
    };
}

function resolveIdentity(userId: string, channel?: Channel): UserIdentity {
    const user = UserStore.getUser(userId) as RawUser | undefined;
    if (user) return identityFromUser(userId, user);

    const raw = (channel as { rawRecipients?: Array<RawUser & { id?: string; }>; } | undefined)
        ?.rawRecipients
        ?.find(recipient => recipient?.id === userId);

    return identityFromUser(userId, raw ?? {});
}

function buildDmConversations(records: SentTrailRecord[]) {
    const conversations = new Map<string, DmConversation>();

    for (const record of records) {
        if (!isDm(record)) continue;

        const existing = conversations.get(record.channelId);
        if (existing) {
            existing.count++;
            continue;
        }

        const channel = ChannelStore.getChannel(record.channelId);
        const names = getRecordRecipientIds(record).map(id => resolveIdentity(id, channel).label);
        const channelName = resolveRecordContext(record).channelName;

        conversations.set(record.channelId, {
            channelId: record.channelId,
            label: names[0] ?? channelName,
            details: names.length > 1 ? names.join(", ") : channelName,
            count: 1,
        });
    }

    return Array.from(conversations.values()).sort((left, right) => left.label.localeCompare(right.label));
}

function buildDmUserContacts(records: SentTrailRecord[], protectedUsers: Set<string>) {
    const contacts = new Map<string, DmUserContact>();

    for (const record of records) {
        if (!isDm(record)) continue;

        let channel: Channel | undefined;
        for (const userId of getRecordRecipientIds(record)) {
            const existing = contacts.get(userId);
            if (existing) {
                existing.count++;
                continue;
            }

            channel ??= ChannelStore.getChannel(record.channelId);
            contacts.set(userId, { userId, count: 1, ...resolveIdentity(userId, channel) });
        }
    }

    for (const userId of protectedUsers) {
        if (contacts.has(userId)) continue;

        const identity = resolveIdentity(userId);
        contacts.set(userId, {
            userId,
            count: 0,
            ...identity,
            details: UserStore.getUser(userId) ? identity.details : "Manual user ID rule",
        });
    }

    return Array.from(contacts.values()).sort((left, right) =>
        left.label.localeCompare(right.label) || left.userId.localeCompare(right.userId),
    );
}

function writeIdList(key: IdListKey, ids: Set<string>) {
    settings.store[key] = Array.from(ids).sort().join(",");
}

function toggleId(key: IdListKey, current: Set<string>, id: string, enabled: boolean) {
    const next = new Set(current);
    if (enabled) next.add(id);
    else next.delete(id);
    writeIdList(key, next);
}

function MediaPreview({ media }: { media: SentTrailMediaItem[]; }) {
    if (media.length === 0) return null;

    return (
        <div className={cl("preview-grid")}>
            {media.map(item => (
                <div key={`${item.source}:${item.kind}:${item.url}`} className={cl("preview-card")}>
                    {item.kind === "image" ? (
                        <img
                            className={cl("preview-image")}
                            src={item.url}
                            alt={item.filename ?? "Sent media"}
                            loading="lazy"
                            decoding="async"
                        />
                    ) : (
                        <video
                            className={cl("preview-video")}
                            src={item.url}
                            controls
                            muted
                            preload="none"
                            playsInline
                        />
                    )}
                    <span className={cl("preview-caption")}>
                        {item.filename ?? (item.kind === "image" ? "Image" : "Video")}
                    </span>
                </div>
            ))}
        </div>
    );
}

function PurgeBanner({ status, onDismiss }: { status: PurgeStatus; onDismiss(): void; }) {
    const running = status.phase === "running";
    const skipped = status.skipped ? `, skipped ${status.skipped} protected` : "";
    const progress = status.total > 0 ? Math.max(8, Math.round((status.processed / status.total) * 100)) : 0;

    let title: string;
    let subtitle: string;

    if (running) {
        title = `Purging ${status.processed}/${status.total}`;
        subtitle = status.currentLabel
            ? `Deleting ${status.currentLabel} one message at a time.`
            : "Deleting queued messages one by one to keep the pace safe.";
    } else if (status.phase === "success") {
        title = "Purge complete";
        subtitle = `Deleted ${plural(status.deleted, "message")}${skipped}.`;
    } else if (status.phase === "partial") {
        title = "Purge finished with some skips";
        subtitle = `Deleted ${status.deleted}, failed ${status.failed}${skipped}.`;
    } else {
        title = "Purge could not finish";
        subtitle = `Nothing was deleted${status.skipped ? ` and ${status.skipped} entries were protected by config` : ""}.`;
    }

    return (
        <div className={cl("purge-status", `purge-status-${status.phase}`)} aria-live="polite">
            <div className={cl("purge-status-icon")}>
                <span className={cl("checkmark")}>{running ? "..." : status.phase === "success" ? "OK" : "!"}</span>
            </div>

            <div className={cl("purge-status-body")}>
                <div className={cl("purge-status-title-row")}>
                    <BaseText size="md" weight="semibold">{title}</BaseText>
                    <span className={cl("meta-tag")}>
                        {status.deleted} deleted{status.failed ? ` / ${status.failed} failed` : ""}{status.skipped ? ` / ${status.skipped} skipped` : ""}
                    </span>
                </div>
                <Paragraph className={cl("purge-status-text")}>{subtitle}</Paragraph>
                <div className={cl("purge-progress-track")}>
                    <div className={cl("purge-progress-fill")} style={{ width: `${running ? progress : 100}%` }} />
                </div>
            </div>

            {!running && (
                <TextButton variant="secondary" onClick={onDismiss}>Dismiss</TextButton>
            )}
        </div>
    );
}

function ConfigModal({ modalProps, records }: { modalProps: RenderModalProps; records: SentTrailRecord[]; }) {
    const config = settings.use(PURGE_SETTINGS);
    const protectedChannels = React.useMemo(() => parseIdList(config.protectedDmChannels), [config.protectedDmChannels]);
    const protectedUsers = React.useMemo(() => parseIdList(config.protectedDmUserIds), [config.protectedDmUserIds]);
    const [tick, refresh] = React.useReducer((value: number) => value + 1, 0);
    const [manualId, setManualId] = React.useState("");
    const conversations = React.useMemo(() => buildDmConversations(records), [records]);
    const contacts = React.useMemo(() => buildDmUserContacts(records, protectedUsers), [records, protectedUsers, tick]);

    React.useEffect(() => {
        let alive = true;
        const pending: Promise<unknown>[] = [];

        for (const { userId } of contacts) {
            if (requestedUsers.has(userId) || UserStore.getUser(userId)) continue;
            requestedUsers.add(userId);
            pending.push(Promise.resolve(UserUtils.getUser(userId)).catch(() => null));
        }

        if (pending.length) void Promise.all(pending).then(() => alive && refresh());

        return () => {
            alive = false;
        };
    }, [contacts]);

    const addUser = () => {
        const id = manualId.trim();

        if (!/^\d{5,24}$/.test(id)) return showToast("Enter a numeric Discord user ID to save a friend rule.", "critical");
        if (protectedUsers.has(id)) return showToast("That DM user ID is already protected.", "critical");

        toggleId("protectedDmUserIds", protectedUsers, id, true);
        setManualId("");
        showToast("Saved permanent DM protection for that user ID.", "success");
    };

    return (
        <Modal
            {...modalProps}
            size="md"
            title={<BaseText size="lg" weight="semibold">Purge Config</BaseText>}
            actions={[{ text: "Close", variant: "secondary", onClick: modalProps.onClose }]}
        >
            <div className={cl("config-modal")}>
                <Paragraph className={cl("config-copy")}>
                    These rules decide what the `Purge` action is allowed to delete. Protected direct messages stay in Send Trail until you change the config.
                </Paragraph>

                <div className={cl("config-grid")}>
                    <div className={cl("config-field")}>
                        <span className={cl("field-label")}>Purge Target</span>
                        <Select
                            options={PURGE_TARGET_OPTIONS}
                            select={(value: SendTrailPurgeTarget) => settings.store.purgeTarget = value}
                            isSelected={(value: SendTrailPurgeTarget) => value === config.purgeTarget}
                            serialize={(value: SendTrailPurgeTarget) => value}
                        />
                    </div>

                    <div className={cl("config-switch-row")}>
                        <div>
                            <BaseText size="md" weight="semibold">Protect all DMs</BaseText>
                            <Paragraph className={cl("config-hint")}>
                                When enabled, no DM or group DM is ever purged, even if it is selected.
                            </Paragraph>
                        </div>
                        <Switch checked={config.protectAllDms} onChange={value => settings.store.protectAllDms = value} />
                    </div>
                </div>

                <div className={cl("config-list-header")}>
                    <BaseText size="md" weight="semibold">Protected DM conversations</BaseText>
                    {!!protectedChannels.size && (
                        <TextButton variant="secondary" onClick={() => settings.store.protectedDmChannels = ""}>
                            Clear protected DM list
                        </TextButton>
                    )}
                </div>

                {conversations.length === 0 ? (
                    <Card className={cl("config-empty")} defaultPadding>
                        <Paragraph className={Margins.reset}>
                            No direct-message history has been captured yet. Once you send a DM from this client, it can be protected here.
                        </Paragraph>
                    </Card>
                ) : (
                    <div className={cl("config-list")}>
                        {conversations.map(conversation => (
                            <Card key={conversation.channelId} className={cl("config-item")} defaultPadding>
                                <div className={cl("config-item-copy")}>
                                    <BaseText size="md" weight="semibold">{conversation.label}</BaseText>
                                    <Paragraph className={cl("config-hint")}>
                                        {conversation.details} / {plural(conversation.count, "saved message")}
                                    </Paragraph>
                                </div>
                                <Switch
                                    checked={protectedChannels.has(conversation.channelId)}
                                    onChange={value => toggleId("protectedDmChannels", protectedChannels, conversation.channelId, value)}
                                />
                            </Card>
                        ))}
                    </div>
                )}

                <div className={cl("config-list-header")}>
                    <BaseText size="md" weight="semibold">Always protected DM users</BaseText>
                    {!!protectedUsers.size && (
                        <TextButton variant="secondary" onClick={() => settings.store.protectedDmUserIds = ""}>
                            Clear protected user list
                        </TextButton>
                    )}
                </div>

                <Paragraph className={cl("config-hint")}>
                    Save friends here by user ID and every DM that includes them stays protected from purge.
                </Paragraph>

                <div className={cl("config-manual-row")}>
                    <div className={cl("config-field", "config-manual-field")}>
                        <span className={cl("field-label")}>Discord User ID</span>
                        <TextInput
                            className={cl("config-id-input")}
                            type="text"
                            inputMode="numeric"
                            autoComplete="off"
                            autoCorrect="off"
                            autoCapitalize="off"
                            value={manualId}
                            placeholder="Add a friend by user ID"
                            onChange={setManualId}
                            onKeyDown={event => {
                                if (event.key !== "Enter") return;
                                event.preventDefault();
                                addUser();
                            }}
                            spellCheck={false}
                            maxLength={null}
                        />
                    </div>

                    <Button size="small" variant="secondary" className={cl("config-save-button")} onClick={addUser}>
                        Save Friend
                    </Button>
                </div>

                {contacts.length === 0 ? (
                    <Card className={cl("config-empty")} defaultPadding>
                        <Paragraph className={Margins.reset}>
                            No DM users are known yet. You can still save a friend manually by Discord user ID above.
                        </Paragraph>
                    </Card>
                ) : (
                    <div className={cl("config-list")}>
                        {contacts.map(contact => (
                            <Card key={contact.userId} className={cl("config-item")} defaultPadding>
                                <div className={cl("config-user-row")}>
                                    <img
                                        className={cl("config-user-avatar")}
                                        src={contact.avatarUrl}
                                        alt={contact.label}
                                        loading="lazy"
                                        decoding="async"
                                    />
                                    <div className={cl("config-item-copy")}>
                                        <BaseText size="md" weight="semibold">{contact.label}</BaseText>
                                        <Paragraph className={cl("config-hint")}>
                                            {contact.details} / User ID {contact.userId}
                                            {contact.count
                                                ? ` / ${plural(contact.count, "saved DM message")}`
                                                : " / no DM history loaded yet"}
                                        </Paragraph>
                                    </div>
                                </div>
                                <Switch
                                    checked={protectedUsers.has(contact.userId)}
                                    onChange={value => toggleId("protectedDmUserIds", protectedUsers, contact.userId, value)}
                                />
                            </Card>
                        ))}
                    </div>
                )}
            </div>
        </Modal>
    );
}

const RecordCard = React.memo(function RecordCard({
    record,
    selected,
    deleting,
    protectedFromPurge,
    onToggle,
}: {
    record: SentTrailRecord;
    selected: boolean;
    deleting: boolean;
    protectedFromPurge: boolean;
    onToggle(id: string): void;
}) {
    const context = resolveRecordContext(record);

    return (
        <Card
            className={cl("record-card", selected && "record-card-selected", deleting && "record-card-deleting")}
            defaultPadding
            role="button"
            tabIndex={deleting ? -1 : 0}
            aria-pressed={selected}
            onClick={() => {
                if (!deleting) onToggle(record.id);
            }}
            onKeyDown={event => {
                if (deleting || event.target !== event.currentTarget) return;
                if (event.key !== "Enter" && event.key !== " ") return;
                event.preventDefault();
                onToggle(record.id);
            }}
        >
            <div className={cl("record-header")}>
                <div className={cl("record-meta")}>
                    <div className={cl("record-origin-line")}>
                        <span className={cl("record-scope-label")}>
                            {context.isDirectMessage ? "Direct Messages" : context.guildName}
                        </span>
                        <span className={cl("record-separator")}>/</span>
                        <span className={cl("channel-name")}>
                            {context.isDirectMessage ? context.channelName : `#${context.channelName}`}
                        </span>
                        {protectedFromPurge && <span className={cl("record-flag")}>Protected</span>}
                        {selected && <span className={cl("record-flag", "record-flag-selected")}>Selected</span>}
                    </div>

                    <Paragraph className={cl("record-timestamp")}>
                        {new Date(record.timestamp).toLocaleString()}
                    </Paragraph>
                </div>
            </div>

            {record.hasText ? (
                <div className={cl("record-message-shell")}>
                    <span className={cl("record-message-label")}>Sent Message</span>
                    <Paragraph className={cl("record-content")}>{record.preview || record.content}</Paragraph>
                </div>
            ) : (
                <Paragraph className={cl("record-muted")}>
                    This entry is media-only. Use the preview below to inspect what was sent.
                </Paragraph>
            )}

            <MediaPreview media={record.media} />

            <div className={cl("record-footer")}>
                <span className={cl("record-time")}>{formatTime(record.timestamp)}</span>

                <div className={cl("record-buttons")}>
                    <TextButton
                        variant="secondary"
                        className={cl("record-open-button")}
                        onClick={event => {
                            event.stopPropagation();
                            NavigationRouter.transitionTo(record.jumpLink);
                        }}
                    >
                        <OpenExternalIcon className={cl("record-open-icon")} width={14} height={14} />
                        <span>Open Message</span>
                    </TextButton>
                </div>
            </div>
        </Card>
    );
});

function PageButton({ glyph, label, disabled, onClick }: { glyph: string; label: string; disabled: boolean; onClick(): void; }) {
    return (
        <button
            type="button"
            className={cl("pagination-nav-button")}
            disabled={disabled}
            aria-label={label}
            title={label}
            onClick={onClick}
        >
            {glyph}
        </button>
    );
}

function SendTrailTab() {
    const userId = useStateFromStores([UserStore], () => UserStore.getCurrentUser()?.id ?? null);
    return <SendTrailAccount key={userId} userId={userId} />;
}

function SendTrailAccount({ userId }: { userId: string | null; }) {
    const [records, pending] = useSentTrailRecords(userId);
    const config = settings.use(PURGE_SETTINGS);
    const protectedChannels = React.useMemo(() => parseIdList(config.protectedDmChannels), [config.protectedDmChannels]);
    const protectedUsers = React.useMemo(() => parseIdList(config.protectedDmUserIds), [config.protectedDmUserIds]);
    const purgeTarget = config.purgeTarget as SendTrailPurgeTarget;

    const [scope, setScope] = React.useState<ScopeValue>("all");
    const [kind, setKind] = React.useState<KindValue>("all");
    const [period, setPeriod] = React.useState<PeriodValue>("all");
    const [pageSize, setPageSize] = React.useState<PageSizeValue>("5");
    const [page, setPage] = React.useState(1);
    const [query, setQuery] = React.useState("");
    const [selectedIds, setSelectedIds] = React.useState<Set<string>>(() => new Set());
    const [deletingId, setDeletingId] = React.useState<string | null>(null);
    const [status, setStatus] = React.useState<PurgeStatus>(EMPTY_STATUS);
    const mounted = React.useRef(true);
    const deferredQuery = React.useDeferredValue(query);

    const busy = React.useSyncExternalStore(subscribeKamidereRuntimeActivity, () =>
        getKamidereRuntimeTask(SEND_TRAIL_PURGE_TASK_ID)?.status === "running",
    );

    React.useEffect(() => {
        mounted.current = true;
        return () => {
            mounted.current = false;
        };
    }, []);

    const checkProtected = (record: SentTrailRecord) =>
        isProtected(record, purgeTarget, config.protectAllDms, protectedChannels, protectedUsers);

    const scopeOptions = React.useMemo<Option<ScopeValue>[]>(() => {
        const guilds = new Map<string, string>();

        for (const record of records) {
            if (record.guildId === "@me" || guilds.has(record.guildId)) continue;
            guilds.set(record.guildId, resolveRecordContext(record).guildName);
        }

        return [
            { label: "All destinations", value: "all" },
            { label: "Direct Messages", value: "dms" },
            ...Array.from(guilds.entries())
                .sort((left, right) => left[1].localeCompare(right[1]))
                .map(([guildId, name]) => ({ label: name, value: `guild:${guildId}` as ScopeValue })),
        ];
    }, [records]);

    const searchCache = React.useMemo(() => new Map<string, string>(), [records]);

    const filtered = React.useMemo(() => {
        const search = deferredQuery.trim().toLowerCase();
        const cutoff = period === "24h" ? Date.now() - 86_400_000 : period === "7d" ? Date.now() - 604_800_000 : 0;

        return records.filter(record => {
            if (!recordMatchesScope(record, scope)) return false;
            if (kind === "text" && !record.hasText) return false;
            if (kind === "media" && !record.hasMedia) return false;
            if (cutoff && record.timestamp < cutoff) return false;
            if (!search) return true;

            let index = searchCache.get(record.id);
            if (index === undefined) {
                index = buildSearchIndex(record);
                searchCache.set(record.id, index);
            }
            return index.includes(search);
        });
    }, [deferredQuery, kind, period, records, scope, searchCache]);

    const pageSizeNumber = Number(pageSize);
    const totalPages = Math.max(1, Math.ceil(filtered.length / pageSizeNumber));
    const currentPage = Math.min(page, totalPages);
    const pageStart = (currentPage - 1) * pageSizeNumber;

    const groups = React.useMemo(() => {
        const byLabel = new Map<string, SentTrailRecord[]>();

        for (const record of filtered.slice(pageStart, pageStart + pageSizeNumber)) {
            const label = formatDayLabel(record.timestamp);
            const list = byLabel.get(label);
            if (list) list.push(record);
            else byLabel.set(label, [record]);
        }

        return Array.from(byLabel.entries());
    }, [filtered, pageSizeNumber, pageStart]);

    const selectedRecords = React.useMemo(
        () => records.filter(record => selectedIds.has(record.id)),
        [records, selectedIds],
    );
    const purgeRecords = selectedRecords.length > 0 ? selectedRecords : filtered;

    const dmThreadCount = React.useMemo(() => {
        const channels = new Set<string>();
        for (const record of records) if (isDm(record)) channels.add(record.channelId);
        return channels.size;
    }, [records]);

    const scopeLabel = scopeOptions.find(option => option.value === scope)?.label ?? "All destinations";
    const kindLabel = KIND_OPTIONS.find(option => option.value === kind)?.label ?? "Everything";
    const periodLabel = PERIOD_OPTIONS.find(option => option.value === period)?.label ?? "All time";
    const rangeStart = filtered.length === 0 ? 0 : pageStart + 1;
    const rangeEnd = Math.min(filtered.length, pageStart + pageSizeNumber);
    const navLocked = busy || filtered.length === 0;

    const toggleRecord = React.useCallback((recordId: string) => {
        setSelectedIds(current => {
            const next = new Set(current);
            if (next.has(recordId)) next.delete(recordId);
            else next.add(recordId);
            return next;
        });
    }, []);

    const runPurge = async (targets: SentTrailRecord[]) => {
        if (!userId || UserStore.getCurrentUser()?.id !== userId || !targets.length) return;
        if (getKamidereRuntimeTask(SEND_TRAIL_PURGE_TASK_ID)?.status === "running") return;

        const eligible = targets.filter(record => !checkProtected(record));
        const skipped = targets.length - eligible.length;

        if (!eligible.length) {
            setStatus({ ...EMPTY_STATUS, phase: "failure", skipped });
            showToast("Nothing in the current purge target is allowed by your purge config.", "critical");
            return;
        }

        const startedAt = Date.now();
        const total = eligible.length;
        let deleted = 0;
        let failed = 0;

        const isCurrent = () =>
            getKamidereRuntimeTask(SEND_TRAIL_PURGE_TASK_ID)?.startedAt === startedAt
            && UserStore.getCurrentUser()?.id === userId;

        const report = (processed: number, currentLabel?: string) => {
            upsertKamidereRuntimeTask({
                id: SEND_TRAIL_PURGE_TASK_ID,
                toolId: "send-trail-purge",
                name: "Send Trail Purge",
                status: "running",
                subtitle: currentLabel ? `Deleting ${currentLabel}` : "Purging queued messages",
                detail: `${processed}/${total}`,
                progressCurrent: processed,
                progressTotal: total,
                startedAt,
            });
            if (mounted.current) setStatus({ phase: "running", total, processed, deleted, failed, skipped, currentLabel });
        };

        report(0);

        for (let index = 0; index < total; index++) {
            if (!isCurrent()) break;

            const record = eligible[index];
            const context = resolveRecordContext(record);
            report(index, context.isDirectMessage ? context.channelName : `#${context.channelName}`);
            if (mounted.current) setDeletingId(record.id);

            try {
                await MessageActions.deleteMessage(record.channelId, record.messageId);
                await removeSentTrailRecord(userId, record.channelId, record.messageId).catch(() => null);
                deleted++;
                if (mounted.current) {
                    setSelectedIds(current => {
                        if (!current.has(record.id)) return current;
                        const next = new Set(current);
                        next.delete(record.id);
                        return next;
                    });
                }
            } catch {
                failed++;
            }

            if (index < total - 1) await sleep(DELETE_DELAY_MS);
        }

        if (mounted.current) setDeletingId(null);

        const cancelled = !isCurrent();
        removeKamidereRuntimeTask(SEND_TRAIL_PURGE_TASK_ID, startedAt);

        if (cancelled) {
            if (mounted.current) setStatus(EMPTY_STATUS);
            return;
        }

        const phase: PurgePhase = failed === 0 ? "success" : deleted > 0 ? "partial" : "failure";
        if (mounted.current) setStatus({ phase, total, processed: total, deleted, failed, skipped });

        if (phase === "success") showToast(`Purged ${plural(deleted, "message")} from Discord.`, "success");
        else if (phase === "partial") showToast(`Purged ${plural(deleted, "message")}, but ${failed} failed.`, "critical");
        else showToast("No selected messages could be purged from Discord.", "critical");
    };

    const confirmPurge = () => {
        if (!purgeRecords.length) return;

        const total = purgeRecords.length;
        const eligible = purgeRecords.reduce((count, record) => count + (checkProtected(record) ? 0 : 1), 0);
        const skipped = total - eligible;
        const label = selectedRecords.length > 0 ? "selected" : "matching";

        Alerts.show({
            title: `Purge ${total} ${label} message${total === 1 ? "" : "s"}?`,
            body: eligible === 0
                ? "Everything in the current purge target is currently protected by your purge config."
                : `Send Trail will delete ${plural(eligible, `${label} message`)} from Discord one by one.${skipped ? ` ${plural(skipped, `${label} entry`, `${label} entries`)} protected by config will be skipped.` : ""}`,
            confirmText: "Start Purge",
            cancelText: "Cancel",
            onConfirm() {
                void runPurge(purgeRecords);
            },
        });
    };

    const confirmLocalClear = () => {
        Alerts.show({
            title: "Clear local Send Trail history?",
            body: `This removes ${plural(records.length, "saved entry", "saved entries")} from Send Trail only. It will not delete anything from Discord itself.`,
            confirmText: "Clear Local History",
            cancelText: "Cancel",
            async onConfirm() {
                await clearSentTrailRecords(userId);
                setSelectedIds(new Set());
                showToast("Cleared local Send Trail history.", "success");
            },
        });
    };

    return (
        <SettingsTab>
            <SpecialCard
                title="Send Trail"
                subtitle="Selective outbound purge"
                description={`Track what you send from ${BRAND_NAME}, choose exactly which messages should go, and purge them one by one without losing control of DMs or protected conversations.`}
                cardImage={BRAND_ICON_DATA_URL}
                backgroundImage={HERO_BACKGROUND}
                backgroundColor="#27221d"
            >
                <div className={cl("hero-metrics")}>
                    <span className={cl("hero-tag")}>{records.length} tracked</span>
                    <span className={cl("hero-tag")}>{filtered.length} visible</span>
                    <span className={cl("hero-tag")}>{selectedRecords.length} selected</span>
                    <span className={cl("hero-tag")}>{dmThreadCount} DM threads known</span>
                </div>
            </SpecialCard>

            <Notice.Info className={Margins.top20} style={{ width: "100%" }}>
                Send Trail is local to this device. `Purge` deletes the real Discord messages one by one, while `Clear Local History` only removes the saved index shown here.
            </Notice.Info>

            <Heading className={Margins.top20}>History</Heading>
            <Card className={cl("history-shell")} defaultPadding>
                <div className={cl("history-shell-header")}>
                    <div className={cl("history-shell-copy")}>
                        <Heading tag="h4" className={Margins.reset}>Sent Messages</Heading>
                        <Paragraph className={cl("history-subtitle")}>
                            Review your global send history, narrow it down, and purge the exact set you want.
                        </Paragraph>
                    </div>
                </div>

                <div className={cl("history-filter-surface")}>
                    <div className={cl("history-filter-header")}>
                        <div className={cl("history-filter-meta")}>
                            <Paragraph className={cl("history-summary")}>
                                {scopeLabel} / {kindLabel} / {periodLabel}
                            </Paragraph>
                            <Paragraph className={cl("history-summary")}>
                                Purge target: {purgeTarget === "all" ? "everything" : purgeTarget === "dms" ? "DMs only" : "servers only"}
                                {config.protectAllDms ? " / all DMs protected" : ""}
                                {protectedChannels.size ? ` / ${plural(protectedChannels.size, "DM thread")} protected` : ""}
                                {protectedUsers.size ? ` / ${plural(protectedUsers.size, "DM user")} protected` : ""}
                            </Paragraph>
                        </div>
                    </div>

                    <div className={cl("toolbar-grid")}>
                        <div className={cl("toolbar-field")}>
                            <Paragraph className={cl("field-label")}>Destination</Paragraph>
                            <Select
                                options={scopeOptions}
                                select={(value: ScopeValue) => {
                                    setScope(value);
                                    setPage(1);
                                }}
                                isSelected={(value: ScopeValue) => scope === value}
                                serialize={(value: ScopeValue) => value}
                                isDisabled={busy}
                            />
                        </div>

                        <div className={cl("toolbar-field")}>
                            <Paragraph className={cl("field-label")}>Content Type</Paragraph>
                            <Select
                                options={KIND_OPTIONS}
                                select={(value: KindValue) => {
                                    setKind(value);
                                    setPage(1);
                                }}
                                isSelected={(value: KindValue) => kind === value}
                                serialize={(value: KindValue) => value}
                                isDisabled={busy}
                            />
                        </div>

                        <div className={cl("toolbar-field")}>
                            <Paragraph className={cl("field-label")}>Period</Paragraph>
                            <Select
                                options={PERIOD_OPTIONS}
                                select={(value: PeriodValue) => {
                                    setPeriod(value);
                                    setPage(1);
                                }}
                                isSelected={(value: PeriodValue) => period === value}
                                serialize={(value: PeriodValue) => value}
                                isDisabled={busy}
                            />
                        </div>
                    </div>
                </div>

                <div className={cl("history-actions-row")}>
                    <label className={cl("search-shell", "history-search-shell")}>
                        <MagnifyingGlassIcon className={cl("search-icon")} width={16} height={16} />
                        <input
                            className={cl("search-input")}
                            type="text"
                            autoComplete="off"
                            value={query}
                            placeholder="Search messages, channels, servers, or media"
                            onChange={event => {
                                setQuery(event.currentTarget.value);
                                setPage(1);
                            }}
                            disabled={busy}
                            spellCheck={false}
                            aria-label="Search sent messages"
                        />
                    </label>

                    <div className={cl("history-actions-buttons")}>
                        <Button
                            size="iconOnly"
                            variant="secondary"
                            className={cl("action-icon-button")}
                            disabled={busy}
                            onClick={() => openModal(modalProps => <ConfigModal modalProps={modalProps} records={records} />)}
                            title="Open purge config"
                            aria-label="Open purge config"
                        >
                            <CogWheel width={16} height={16} />
                        </Button>
                        <Button
                            size="xs"
                            variant="dangerPrimary"
                            className={cl("action-button", "action-button-purge")}
                            disabled={purgeRecords.length === 0 || busy}
                            onClick={confirmPurge}
                        >
                            <DeleteIcon width={13} height={13} />
                            <span>{selectedRecords.length > 0 ? "Purge Selected" : "Purge All"}</span>
                        </Button>
                    </div>
                </div>

                {status.phase !== "idle" && (
                    <PurgeBanner status={status} onDismiss={() => setStatus(EMPTY_STATUS)} />
                )}

                <div className={cl("history-list")}>
                    {pending && !busy && (
                        <Card className={cl("empty-card")} defaultPadding>
                            <LogIcon className={cl("empty-icon")} />
                            <Heading tag="h4">Loading Send Trail history...</Heading>
                        </Card>
                    )}

                    {!pending && records.length === 0 && (
                        <Card className={cl("empty-card")} defaultPadding>
                            <LogIcon className={cl("empty-icon")} />
                            <Heading tag="h4">No saved sends yet</Heading>
                            <Paragraph>
                                Send a message, image, GIF, video, or direct media link from this client and it will start appearing here.
                            </Paragraph>
                        </Card>
                    )}

                    {!pending && records.length > 0 && filtered.length === 0 && (
                        <Card className={cl("empty-card")} defaultPadding>
                            <LogIcon className={cl("empty-icon")} />
                            <Heading tag="h4">No results match this view</Heading>
                            <Paragraph>
                                Broaden the destination, type, period, or search query to bring more sent messages into view.
                            </Paragraph>
                        </Card>
                    )}

                    {groups.map(([label, list]) => (
                        <div key={label} className={cl("group")}>
                            <div className={cl("group-header")}>
                                <Heading tag="h4" className={Margins.reset}>{label}</Heading>
                                <span className={cl("group-count")}>{plural(list.length, "entry", "entries")}</span>
                            </div>

                            <div className={cl("group-list")}>
                                {list.map(record => (
                                    <RecordCard
                                        key={record.id}
                                        record={record}
                                        selected={selectedIds.has(record.id)}
                                        deleting={deletingId === record.id}
                                        protectedFromPurge={checkProtected(record)}
                                        onToggle={toggleRecord}
                                    />
                                ))}
                            </div>
                        </div>
                    ))}
                </div>

                <div className={cl("history-footer")}>
                    <div className={cl("history-footer-main")}>
                        <span className={cl("pagination-summary")}>
                            Showing {rangeStart}-{rangeEnd} from {filtered.length}
                        </span>

                        <div className={cl("pagination-center")}>
                            <PageButton glyph="«" label="First page" disabled={currentPage <= 1 || navLocked} onClick={() => setPage(1)} />
                            <PageButton glyph="‹" label="Previous page" disabled={currentPage <= 1 || navLocked} onClick={() => setPage(currentPage - 1)} />
                            <span className={cl("pagination-page-chip")}>{currentPage}</span>
                            <span className={cl("pagination-of-label")}>of {totalPages}</span>
                            <PageButton glyph="›" label="Next page" disabled={currentPage >= totalPages || navLocked} onClick={() => setPage(currentPage + 1)} />
                            <PageButton glyph="»" label="Last page" disabled={currentPage >= totalPages || navLocked} onClick={() => setPage(totalPages)} />
                        </div>

                        <div className={cl("pagination-page-size")}>
                            <span className={cl("pagination-page-size-label")}>Rows per page:</span>
                            <div className={cl("pagination-page-size-select")}>
                                <Select
                                    className={cl("pagination-page-size-control")}
                                    options={PAGE_SIZE_OPTIONS}
                                    select={(value: PageSizeValue) => {
                                        setPageSize(value);
                                        setPage(1);
                                    }}
                                    isSelected={(value: PageSizeValue) => pageSize === value}
                                    serialize={(value: PageSizeValue) => value}
                                    isDisabled={navLocked}
                                />
                            </div>
                        </div>
                    </div>

                    <div className={cl("history-footer-secondary")}>
                        <Paragraph className={cl("history-summary")}>
                            Local only. Purge deletes live Discord messages one by one.
                        </Paragraph>

                        <TextButton
                            variant="secondary"
                            className={cl("history-footer-clear")}
                            disabled={records.length === 0 || busy}
                            onClick={confirmLocalClear}
                        >
                            Clear Local History
                        </TextButton>
                    </div>
                </div>
            </Card>
        </SettingsTab>
    );
}

export default wrapTab(SendTrailTab, "Send Trail");