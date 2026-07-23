export type PresenceStatus =
    | "online"
    | "idle"
    | "dnd"
    | "offline"
    | "invisible"
    | string;

export interface ProfileSnapshot {
    username?: string;
    avatar?: string | null;
    discriminator?: string;
    global_name?: string | null;
    bio?: string | null;
    banner?: string | null;
    banner_color?: string | null;
    avatarDecoration?: string | null;
    avatarDecorationData?: {
        asset: string;
        skuId: string;
    } | null;
    connected_accounts?: Array<{
        type: string;
        name: string;
        verified: boolean;
    }>;
    pronouns?: string | null;
    theme_colors?: [number, number] | null;
    emoji?: any | null;
    customStatus?: string | null;
}

export interface VoiceSession {
    userId: string;

    guildId?: string;
    guildName?: string;

    channelId: string;
    channelName: string;

    joinedAt: number;
    leftAt?: number;

    duration?: number;

    action: "join" | "leave" | "move";
}

export interface ProfileChanges {
    changedFields: string[];
    before: ProfileSnapshot;
    after: ProfileSnapshot;
}

export interface PresenceLogEntry {
    userId: string;
    username: string;
    discriminator?: string;

    timestamp: number;

    previousStatus?: PresenceStatus | null;
    currentStatus: PresenceStatus | null;

    guildId?: string;
    guildName?: string | null;

    clientStatus?: Record<string, string>;

    activitySummary?: string;
    clientStatusSummary?: string;

    type?:
        | "presence"
        | "profile"
        | "message"
        | "typing"
        | "voice";

    profileChanges?: ProfileChanges;

    offlineDuration?: number;
    onlineDuration?: number;

    activities?: any[];

    channelId?: string;
    channelName?: string;

    messageContent?: string;
    messageId?: string;

    /* =========================
       Voice Channel Tracking
       ========================= */

    voiceAction?: "join" | "leave" | "move";

    oldChannelId?: string;
    oldChannelName?: string;

    newChannelId?: string;
    newChannelName?: string;

    voiceDuration?: number;
}

export interface UserStalkerConfig {
    userId: string;

    logPresenceChanges: boolean;
    logProfileChanges: boolean;
    logMessages: boolean;

    notifyPresenceChanges: boolean;
    notifyProfileChanges: boolean;
    notifyMessages: boolean;
    notifyTyping: boolean;

    typingConversationWindow?: number;

    serverFilterMode:
        | "all"
        | "whitelist"
        | "blacklist";

    serverList: string[];

    notifyOnline?: boolean;
    notifyOffline?: boolean;
    notifyIdle?: boolean;
    notifyDnd?: boolean;

    notifyUsername?: boolean;
    notifyAvatar?: boolean;
    notifyBanner?: boolean;
    notifyBio?: boolean;
    notifyPronouns?: boolean;
    notifyGlobalName?: boolean;
}