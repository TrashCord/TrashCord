import definePlugin, { OptionType } from "@utils/types";
import { definePluginSettings } from "@api/Settings";
import * as DataStore from "@api/DataStore";
import { FluxDispatcher, UserStore, Menu, React } from "@webpack/common";
import { addContextMenuPatch, removeContextMenuPatch } from "@api/ContextMenu";
import { addMessageAccessory, removeMessageAccessory } from "@api/MessageAccessories";
import { openModal, ModalRoot, ModalHeader, ModalContent, ModalCloseButton, ModalSize } from "@utils/modal";

interface ReactionLog {
    type: "MESSAGE_REACTION_ADD" | "MESSAGE_REACTION_REMOVE";
    messageId: string;
    userId: string;
    emoji: {
        name: string;
        id?: string | null;
        animated?: boolean;
    };
    timestamp: number;
}

const STORAGE_KEY = "reaction-logger";

let logCache: ReactionLog[] | null = null;
let isSaving = false;
const saveQueue: any[] = [];

async function getLogs(): Promise<ReactionLog[]> {
    if (!logCache) {
        logCache = (await DataStore.get<ReactionLog[]>(STORAGE_KEY)) ?? [];
    }
    return logCache;
}

export const settings = definePluginSettings({
    maxLogs: {
        type: OptionType.NUMBER,
        description: "Maximum number of total reaction logs to retain across all messages",
        default: 5000,
    },
    clearData: {
        type: OptionType.COMPONENT,
        description: "Wipe all stored reaction log data",
        component: () => (
            <button
                style={{
                    backgroundColor: "#da373c",
                    color: "#ffffff",
                    border: "none",
                    borderRadius: "3px",
                    padding: "8px 16px",
                    cursor: "pointer",
                    fontWeight: 500,
                    fontSize: "14px"
                }}
                onClick={async () => {
                    logCache = [];
                    await DataStore.set(STORAGE_KEY, []);
                }}
            >
                Clear All Reaction Logs
            </button>
        )
    }
});

function getMaxLogs(): number {
    try {
        return settings.store.maxLogs ?? 5000;
    } catch {
        return 5000;
    }
}

async function processQueue() {
    if (isSaving || saveQueue.length === 0) return;
    isSaving = true;

    const payload = saveQueue.shift();
    const logs = await getLogs();

    const newEntry: ReactionLog = {
        type: payload.type,
        messageId: String(payload.messageId),
        userId: String(payload.userId),
        emoji: {
            name: payload.emoji.name ?? "❓",
            id: payload.emoji.id ?? null,
            animated: payload.emoji.animated ?? false
        },
        timestamp: Date.now()
    };

    logs.push(newEntry);

    const max = getMaxLogs();
    if (logs.length > max) {
        logs.splice(0, logs.length - max);
    }

    await DataStore.set(STORAGE_KEY, logs);
    isSaving = false;

    if (saveQueue.length > 0) {
        processQueue();
    }
}

function saveReaction(payload: any) {
    if (!payload?.messageId || !payload?.userId || !payload?.emoji) return;
    saveQueue.push(payload);
    processQueue();
}

function getUnicodeEmojiUrl(emoji: string) {
    const codePoints = [...emoji]
        .map(c => c.codePointAt(0)!.toString(16))
        .filter(cp => cp !== "fe0f")
        .join("-");
    return `https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/${codePoints}.png`;
}

function ReactionEmoji({ emoji }: { emoji: ReactionLog["emoji"] }) {
    if (!emoji) return <span style={{ fontSize: "24px" }}>❓</span>;

    const src = emoji.id
        ? `https://cdn.discordapp.com/emojis/${emoji.id}.${emoji.animated ? "gif" : "png"}?size=64`
        : getUnicodeEmojiUrl(emoji.name);

    return (
        <img
            src={src}
            width={28}
            height={28}
            style={{ objectFit: "contain", flexShrink: 0 }}
            onError={(e) => {
                (e.currentTarget as HTMLElement).replaceWith(emoji.name || "❓");
            }}
        />
    );
}

function ReactionHistoryModal({
    messageId,
    onClose,
    transitionState
}: {
    messageId: string;
    transitionState: any;
    onClose: () => void;
}) {
    const [logs, setLogs] = React.useState<ReactionLog[]>([]);

    React.useEffect(() => {
        getLogs().then(all => {
            const filtered = all
                .filter(x => x.messageId === messageId)
                .reverse();
            setLogs(filtered);
        });
    }, [messageId]);

    return (
        <ModalRoot transitionState={transitionState} size={ModalSize.MEDIUM}>
            <ModalHeader separator={false}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%" }}>
                    <h3 style={{ margin: 0, fontSize: "18px", fontWeight: 600, color: "#f2f3f5" }}>
                        Reaction History
                    </h3>
                    <ModalCloseButton onClick={onClose} />
                </div>
            </ModalHeader>

            <ModalContent style={{ padding: "16px", display: "flex", flexDirection: "column", gap: "8px" }}>
                {logs.length === 0 ? (
                    <div style={{ color: "#949ba4", textAlign: "center", padding: "24px 0" }}>
                        No reactions logged for this message.
                    </div>
                ) : (
                    logs.map((log, i) => {
                        const user = UserStore.getUser(log.userId);
                        const isRemoved = log.type === "MESSAGE_REACTION_REMOVE";

                        return (
                            <div
                                key={`${log.timestamp}-${i}`}
                                style={{
                                    backgroundColor: "rgba(255, 255, 255, 0.04)",
                                    border: "1px solid rgba(255, 255, 255, 0.06)",
                                    padding: "10px 14px",
                                    borderRadius: "8px",
                                    display: "flex",
                                    alignItems: "center",
                                    gap: "12px"
                                }}
                            >
                                <ReactionEmoji emoji={log.emoji} />

                                <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                                    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                                        <span
                                            style={{
                                                color: isRemoved ? "#f23f43" : "#23a55a",
                                                fontWeight: 700,
                                                fontSize: "13px"
                                            }}
                                        >
                                            {isRemoved ? "Removed" : "Added"}
                                        </span>
                                        <span style={{ color: "#f2f3f5", fontWeight: 600, fontSize: "14px" }}>
                                            {user?.username ?? log.userId}
                                        </span>
                                    </div>

                                    <small style={{ color: "#b5bac1", fontSize: "12px", marginTop: "2px" }}>
                                        {new Date(log.timestamp).toLocaleString()}
                                    </small>
                                </div>
                            </div>
                        );
                    })
                )}
            </ModalContent>
        </ModalRoot>
    );
}

function hasUnmatchedReactions(message: any, logs: ReactionLog[]): boolean {
    const msgLogs = logs.filter(l => l.messageId === message.id);
    if (msgLogs.length === 0) return false;

    const hasRemovals = msgLogs.some(l => l.type === "MESSAGE_REACTION_REMOVE");
    if (hasRemovals) return true;

    if (!message.reactions || !Array.isArray(message.reactions)) return false;

    const loggedCounts = new Map<string, number>();
    for (const log of msgLogs) {
        const key = log.emoji.id ? `${log.emoji.name}:${log.emoji.id}` : log.emoji.name;
        const current = loggedCounts.get(key) ?? 0;
        if (log.type === "MESSAGE_REACTION_ADD") {
            loggedCounts.set(key, current + 1);
        } else if (log.type === "MESSAGE_REACTION_REMOVE") {
            loggedCounts.set(key, Math.max(0, current - 1));
        }
    }

    const visibleCounts = new Map<string, number>();
    for (const react of message.reactions) {
        const key = react.emoji.id ? `${react.emoji.name}:${react.emoji.id}` : react.emoji.name;
        visibleCounts.set(key, react.count ?? 0);
    }

    for (const [key, count] of loggedCounts.entries()) {
        if ((visibleCounts.get(key) ?? 0) !== count) return true;
    }

    return false;
}

function LoggedReactionIndicator({ message }: { message: any }) {
    const [shouldShow, setShouldShow] = React.useState(false);

    React.useEffect(() => {
        getLogs().then(logs => {
            setShouldShow(hasUnmatchedReactions(message, logs));
        });
    }, [message.id, JSON.stringify(message.reactions)]);

    if (!shouldShow) return null;

    return (
        <div
            style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "6px",
                marginTop: "4px",
                padding: "2px 8px",
                borderRadius: "4px",
                backgroundColor: "rgba(88, 101, 242, 0.12)",
                border: "1px solid rgba(88, 101, 242, 0.25)",
                color: "#949ba4",
                fontSize: "12px",
                fontWeight: 500,
                width: "fit-content",
                userSelect: "none"
            }}
        >
            <span style={{ fontSize: "13px" }}>📜</span>
            <span>this message has logged reactions that aren't visible</span>
        </div>
    );
}

function messageContextPatch(children: any[], props: any) {
    if (!props?.message?.id) return;

    children.push(
        <Menu.MenuSeparator key="reaction-history-sep" />,
        <Menu.MenuItem
            id="reaction-history"
            label="Reaction History"
            action={() => {
                const msgId = String(props.message.id);
                openModal(modalProps => (
                    <ReactionHistoryModal
                        {...modalProps}
                        messageId={msgId}
                    />
                ));
            }}
        />
    );
}

export default definePlugin({
    name: "ReactionLogger",
    description: "Logs reaction history per message and indicates non-visible changes",
    authors: [{ name: "pfew", id: "931645562246275093" }],
    tags: ["Reactions", "Utility"],
    enabledByDefault: false,
    settings,
    start() {
        getLogs();

        FluxDispatcher.subscribe("MESSAGE_REACTION_ADD", saveReaction);
        FluxDispatcher.subscribe("MESSAGE_REACTION_REMOVE", saveReaction);
        addContextMenuPatch("message", messageContextPatch);

        addMessageAccessory("reaction-logger-badge", props => (
            <LoggedReactionIndicator message={props.message} />
        ));
    },

    stop() {
        FluxDispatcher.unsubscribe("MESSAGE_REACTION_ADD", saveReaction);
        FluxDispatcher.unsubscribe("MESSAGE_REACTION_REMOVE", saveReaction);
        removeContextMenuPatch("message", messageContextPatch);
        removeMessageAccessory("reaction-logger-badge");
        logCache = null;
    }
});
