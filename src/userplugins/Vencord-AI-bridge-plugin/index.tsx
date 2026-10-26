/*
 * TrashCord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import managedStyle from "./styles.css?managed";

import { addChatBarButton, removeChatBarButton } from "@api/ChatButtons";
import { RobotIcon } from "@components/Icons";
import { React } from "@webpack/common";
import definePlugin from "@utils/types";

import {
    connectBridge,
    disconnectBridge,
    isConnected,
    onConnectionChange,
    startForwarding,
    stopForwarding,
} from "./bridge";
import { settings } from "./settings";

// ---------------------------------------------------------------------------
// Chat bar status indicator
// ---------------------------------------------------------------------------

function BridgeStatusBar() {
    const [connected, setConnected] = React.useState(isConnected());

    React.useEffect(() => onConnectionChange(setConnected), []);

    if (!settings.store.showStatusIndicator) return null;

    return (
        <div
            className={`vc-aibridge-status ${connected ? "vc-aibridge-connected" : "vc-aibridge-disconnected"}`}
            title={connected ? "AI Bridge connected" : "AI Bridge disconnected — click to reconnect"}
            onClick={() => {
                if (!connected) {
                    connectBridge(settings.store.backendUrl);
                }
            }}
        >
            <div className={`vc-aibridge-dot ${connected ? "connected" : "disconnected"}`} />
            {connected ? "AI" : "AI OFF"}
        </div>
    );
}

// ---------------------------------------------------------------------------
// Plugin definition
// ---------------------------------------------------------------------------

export default definePlugin({
    name: "AIBridge",
    description: "Connects Discord to the AI VTuber backend via WebSocket. The AI can send messages, join voice, and interact with Discord.",
    authors: [{ name: "leand", id: 0n }],
    tags: ["Voice", "Chat", "Utility"],
    enabledByDefault: false,
    managedStyle,
    settings,
    settingsAboutComponent: () => (
        <div style={{ padding: "8px 0" }}>
            <p style={{ marginBottom: 8 }}>
                This plugin bridges your Discord client to the AI VTuber backend.
                When enabled, the AI can:
            </p>
            <ul style={{ paddingLeft: 16, lineHeight: 1.6 }}>
                <li>Read messages in channels you're in</li>
                <li>Send messages and replies</li>
                <li>Join and leave voice channels</li>
                <li>React to messages</li>
                <li>Track voice state changes</li>
                <li>Edit and delete its own messages</li>
            </ul>
            <p style={{ marginTop: 12, fontSize: 12, color: "var(--text-muted)" }}>
                Make sure the AI VTuber backend is running with the bridge endpoint enabled.
                Set the WebSocket URL to match your backend address (default: ws://127.0.0.1:8000/api/ws/discord).
            </p>
        </div>
    ),

    start() {
        // Add status indicator to chat bar
        addChatBarButton("AIBridge", BridgeStatusBar, RobotIcon);

        // Auto-connect if enabled
        if (settings.store.autoConnect) {
            connectBridge(settings.store.backendUrl);
        }

        // Start forwarding events when connected
        onConnectionChange((c) => {
            if (c) {
                startForwarding(
                    settings.store.forwardMessages,
                    settings.store.forwardVoiceState,
                    settings.store.forwardTyping
                );
            } else {
                stopForwarding();
            }
        });
    },

    stop() {
        disconnectBridge();
        stopForwarding();
        removeChatBarButton("AIBridge");
    },
});
