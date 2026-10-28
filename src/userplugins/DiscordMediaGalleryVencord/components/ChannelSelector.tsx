/*
 * TrashCord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ChannelStore, useMemo } from "@webpack/common";

import { ChannelOption } from "../types";

interface ChannelSelectorProps {
    currentChannelId: string;
    onSelectChannel: (channelId: string) => void;
}

export function ChannelSelector({ currentChannelId, onSelectChannel }: ChannelSelectorProps) {
    const channelOptions = useMemo<ChannelOption[]>(() => {
        try {
            const current = ChannelStore.getChannel(currentChannelId);
            if (!current) {
                return [{ id: currentChannelId, name: "Current Channel" }];
            }

            // If Guild channel, get all text/announcement/thread channels in guild
            if (current.guild_id) {
                const guildChannels = ChannelStore.getMutableGuildChannelsForGuild(current.guild_id);
                if (guildChannels) {
                    const list: ChannelOption[] = [];
                    for (const ch of Object.values(guildChannels)) {
                        // 0 = GUILD_TEXT, 5 = GUILD_ANNOUNCEMENT, 10 = ANNOUNCEMENT_THREAD, 11 = PUBLIC_THREAD, 12 = PRIVATE_THREAD
                        if (ch && (ch.type === 0 || ch.type === 5 || ch.type === 10 || ch.type === 11 || ch.type === 12)) {
                            list.push({
                                id: ch.id,
                                name: `# ${ch.name}`,
                                isThread: ch.type === 10 || ch.type === 11 || ch.type === 12
                            });
                        }
                    }
                    return list.sort((a, b) => a.name.localeCompare(b.name));
                }
            }

            // DM or Group DM
            return [
                {
                    id: current.id,
                    name: current.name ? `@ ${current.name}` : "Direct Message",
                    isDM: true
                }
            ];
        } catch {
            return [{ id: currentChannelId, name: "Current Channel" }];
        }
    }, [currentChannelId]);

    if (channelOptions.length <= 1) {
        return (
            <span style={{ fontWeight: 600, color: "var(--text-normal)" }}>
                {channelOptions[0]?.name || "Channel"}
            </span>
        );
    }

    return (
        <select
            className="vc-mg-channel-select"
            value={currentChannelId}
            onChange={e => onSelectChannel(e.target.value)}
        >
            {channelOptions.map(opt => (
                <option key={opt.id} value={opt.id}>
                    {opt.name}
                </option>
            ))}
        </select>
    );
}
