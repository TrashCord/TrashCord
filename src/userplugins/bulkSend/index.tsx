/*
 * Vault, a Discord client mod
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ChatBarButton, ChatBarButtonFactory } from "@api/ChatButtons";
import { definePluginSettings } from "@api/Settings";
import { sendMessage } from "@utils/discord";
import definePlugin, { OptionType } from "@utils/types";
import { RenderModalProps } from "@vencord/discord-types";
import { Modal, openModal, Text, TextArea, TextInput, useState } from "@webpack/common";

const settings = definePluginSettings({
    delayMs: {
        type: OptionType.NUMBER,
        description: "Delay between each message, in milliseconds (0 = as fast as possible).",
        default: 0
    }
});

function VaultIcon(props: any) {
    return (
        <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
            <rect x="3" y="3" width="18" height="18" rx="4" />
            <circle cx="12" cy="12" r="4.5" />
            <circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" />
            <line x1="12" y1="3.2" x2="12" y2="7.5" />
            <line x1="12" y1="16.5" x2="12" y2="20.8" />
            <line x1="3.2" y1="12" x2="7.5" y2="12" />
            <line x1="16.5" y1="12" x2="20.8" y2="12" />
        </svg>
    );
}

async function sendAll(channelId: string, messages: string[], delayMs: number) {
    // Fire in order. RestAPI queues + auto-handles rate limits.
    const delay = Math.max(0, delayMs || 0);
    for (const content of messages) {
        if (!content.trim()) continue;
        try {
            await sendMessage(channelId, { content });
        } catch {
            // ignore individual failures
        }
        if (delay > 0) await new Promise(r => setTimeout(r, delay));
    }
}

function BulkSendModal(props: RenderModalProps & { channelId: string; }) {
    const [text, setText] = useState("");
    const [delay, setDelay] = useState(String(settings.store.delayMs ?? 0));
    const messages = text.split("\n").filter(l => l.trim());
    const delayMs = Math.max(0, parseInt(delay, 10) || 0);

    return (
        <Modal
            {...props}
            title="Bulk Send"
            actions={[
                {
                    text: `Send all (${messages.length})`,
                    variant: "brand",
                    onClick() {
                        settings.store.delayMs = delayMs; // remember for next time
                        props.onClose();
                        sendAll(props.channelId, messages, delayMs);
                    }
                },
                { text: "Cancel", variant: "link", onClick: props.onClose }
            ]}
        >
            <Text variant="text-sm/normal" style={{ marginBottom: 10, color: "var(--text-muted)" }}>
                One message per line. They are sent top to bottom, in order.
            </Text>
            <TextArea
                value={text}
                onChange={setText}
                rows={9}
                placeholder={"First message\nSecond message\nThird message..."}
                autoFocus
            />
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 12 }}>
                <Text variant="text-sm/semibold" style={{ whiteSpace: "nowrap" }}>Delay between messages (ms)</Text>
                <div style={{ width: 110 }}>
                    <TextInput
                        type="number"
                        value={delay}
                        onChange={(v: string) => setDelay(v)}
                        placeholder="0"
                    />
                </div>
            </div>
        </Modal>
    );
}

const BulkSendButton: ChatBarButtonFactory = ({ channel }) => (
    <ChatBarButton
        tooltip="Bulk Send"
        onClick={() => openModal(props => <BulkSendModal {...props} channelId={channel.id} />)}
    >
        <VaultIcon />
    </ChatBarButton>
);

export default definePlugin({
    name: "BulkSend",
    description: "Adds a chat bar button to queue several messages (one per line) and send them all at once, in order.",
    authors: [{ name: "eqen", id: 1483151471183921346n }],
    tags: ["Chat", "Utility"],
    enabledByDefault: false,
    settings,
    chatBarButton: {
        icon: VaultIcon,
        render: BulkSendButton
    }
});