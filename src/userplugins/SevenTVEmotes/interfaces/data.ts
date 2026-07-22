export interface EmoteSetData {
    id: string;
    name: string;
    emotes: {
        items: SevenTVEmoteData[];
    };
    owner: {
        id: string;
        style: {
            activeProfilePicture: {
                id: string;
            } | null;
        },
        mainConnection: {
            platformAvatarUrl: string;
        };
    };
}

export interface SevenTVEmoteData {
    id: string,
    alias: string,
    emote: {
        images: {
            scale: number,
            url: string;
            height: number;
            width: number;
        }[];
        flags: {
            animated: boolean;
        };
    };
}



export interface ParsedEmoteSet {
    id: string;
    name: string;
    emotes: ParsedEmote[];
    avatarUrl: {
        static: string;
        animated: string;
    };
}

export interface ParsedEmote {
    id: string;
    alias: string;
    animated: boolean;
    urls: ParsedEmoteUrls;
}

export interface ParsedEmoteUrls {
    width: number,
    static: Record<number, string>;
    animated: Record<number, string>;
}
