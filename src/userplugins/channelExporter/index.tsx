import { getCurrentChannel } from "@utils/discord";
import { openModal } from "@utils/modal";
import definePlugin from "@utils/types";
import { ExportModal } from "./ExportModal";
import { UserStore, useState } from "@webpack/common";

function DownloadIcon() {
    return (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 16l-5-5h3V4h4v7h3l-5 5zm-7 2h14v2H5v-2z" />
        </svg>
    );
}

function ExportButton() {
    const channel = getCurrentChannel();
    const [hovered, setHovered] = useState(false);
    if (!channel) return null;

    let title = `#${channel.name}`;
    if (channel.isDM()) {
        const recipientId = channel.recipients?.[0];
        const user = recipientId ? UserStore.getUser(recipientId) : null;
        title = `DMs with ${user?.username ?? "Unknown"}`;
    } else if (channel.isGroupDM()) {
        title = channel.name?.trim() || "Group DM";
    }

    return (
        <button
            onClick={() => openModal(props => (
                <ExportModal
                    modalProps={props}
                    channelId={channel.id}
                    channelTitle={title}
                />
            ))}
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
            style={{
                background: hovered ? "var(--background-modifier-hover)" : "none",
                border: "none",
                borderRadius: "4px",
                cursor: "pointer",
                color: hovered ? "var(--interactive-hover)" : "var(--interactive-normal)",
                padding: "0 8px",
                height: "32px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                transition: "background 0.15s ease, color 0.15s ease",
            }}
            title="Export messages"
        >
            <DownloadIcon />
        </button>
    );
}

export default definePlugin({
    name: "ChannelExporter",
    description: "Adds a toolbar button to export messages from the current channel.",
    authors: [{ name: "pythonprogamer", id: 1155323774397333634n }],
    enabledByDefault: false,
    tags: ["Chat", "Utility"],

    patches: [
        {
            find: "toolbar:function",
            replacement: {
                match: /(?<=toolbar:function.{0,200})\]/,
                replace: ",$self.ExportButton()]",
            },
        },
    ],

    ExportButton: () => <ExportButton />,
});