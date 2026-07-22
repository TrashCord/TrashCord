/*
* Vencord, a Discord client mod
* Copyright (c) 2026 Vendicated and contributors*
* SPDX-License-Identifier: GPL-3.0-or-later
*/


import { EmoteSetData, ParsedEmoteSet, ParsedEmoteUrls, SevenTVEmoteData } from "./interfaces/data";
import { GQLBody, GQLFuncResult } from "./interfaces/gql";
import { settings } from "./settings";
import { logger } from "./logger";


const emoteImageSizes: number = 4;
const emoteSetFields = `
    id
    name
    emotes {
        items {
            id
            alias
            emote {
                images {
                    scale
                    url
                    height
                    width
                }
                flags {
                    animated
                }
            }
        }
    }
    owner {
        id
        style {
            activeProfilePicture {
                id
            }
        }
        mainConnection {
            platformAvatarUrl
        }
    }
`;


export class SevenTVApi {
    public readonly baseUrl: string;

    constructor() {
        this.baseUrl = "https://api.7tv.app";
    }


    async gql(query: string, variables: Record<string, unknown> = {}, version: number = 4): Promise<GQLFuncResult> {
        let url = `${this.baseUrl}/v${version}/gql`;

        let res: Response = await fetch(url, {
            method: "POST",
            body: JSON.stringify({
                query: query,
                variables: variables,
            })
        });

        let data: Record<string, object>;
        let body: GQLBody | null = null;
        try {
            body = await res.json() as GQLBody;
            data = body.data ?? {};
        } catch (e) {
            if (!(e instanceof TypeError || e instanceof SyntaxError)) {
                throw e;
            }
            data = {};
        }

        let result: GQLFuncResult = {
            status: res.status,
            ok: res.ok,
            data: data,
        };

        if (res.status != 200) {
            return result;
        }

        if (body && body.errors) {
            result["errors"] = body.errors;
        }

        return result;
    }


    async getGlobals(): Promise<ParsedEmoteSet | null> {
        let query = `
            query GetGlobalEmotes {
                emoteSets {
                    global {
                        ${emoteSetFields}
                    }
                }
            }
        `;

        let res = await this.gql(query);

        if (!res.ok || res.errors) {
            logger.error(`Failed to get global emotes, ${JSON.stringify(res)}`);
            return null;
        }

        let data = res.data;
        let globalSet: EmoteSetData = data["emoteSets"]["global"];

        return parseEmoteSet(globalSet);
    }


    async getEmoteSets(emoteSetIds: string[]): Promise<ParsedEmoteSet[] | null> {
        if (!emoteSetIds.length) {
            return [];
        }

        let query = `
            query GetEmoteSets($ids: [Id!]) {
                emoteSets {
                    emoteSets(ids: $ids) {
                        ${emoteSetFields}
                    }
                }
            }
        `;
        let variables = {
            ids: emoteSetIds
        };

        let res = await this.gql(query, variables);

        if (!res.ok || res.errors) {
            logger.error(`Failed to get emote sets, ${JSON.stringify(res)}`);
            return null;
        }
        let data = res.data;
        let emoteSets: EmoteSetData[] = data["emoteSets"]["emoteSets"];

        let parsedEmoteSets = emoteSets.map((emoteSet) => {
            emoteSetIds.splice(emoteSetIds.indexOf(emoteSet.id), 1);
            return parseEmoteSet(emoteSet);
        });

        if (emoteSetIds.length) {
            logger.warn(`${emoteSetIds.length} emote sets not found: ${emoteSetIds}`);
        }

        return parsedEmoteSets;
    }
}


function getEmoteUrls(emote: SevenTVEmoteData): ParsedEmoteUrls {
    let result: ParsedEmoteUrls = {
        width: 0,
        static: {},
        animated: {},
    };

    let images = emote.emote.images;
    let animated = emote.emote.flags.animated;

    let imageCount: number = 0;
    for (let i = 0; i < images.length; i++) {
        if (imageCount >= emoteImageSizes * 2) {
            break;
        }

        let image = images[i];

        if (!result.width) {
            result.width = (image.width / image.scale) * 1.25;
        }

        if (animated) {
            if (image.url.endsWith(`x.${settings.store.animatedImageFormat}`)) {
                result.animated[image.scale] = image.url;
            } else if (image.url.endsWith(`x_static.${settings.store.animatedImageFormat}`)) {
                result.static[image.scale] = image.url;
            } else {
                continue;
            }

        } else {
            if (!image.url.endsWith(`x.${settings.store.staticImageFormat}`)) { continue; }

            result.static[image.scale] = image.url;
            result.animated[image.scale] = image.url;
        }

        imageCount += 1;
    }

    return result;
};


function parseEmoteSet(setData: EmoteSetData): ParsedEmoteSet {
    let emotes = setData.emotes.items ?? [];
    let parsedEmotes = emotes.map((emote) => {
        return {
            id: emote.id,
            alias: emote.alias,
            animated: emote.emote.flags.animated,
            urls: getEmoteUrls(emote),
        };
    });

    let setOwner = setData.owner;
    let customAvatarId = setOwner.style.activeProfilePicture?.id;

    let staticAvatar: string, animatedAvatar: string;
    if (customAvatarId) {
        let basePfpUrl = `https://cdn.7tv.app/user/${setOwner.id}/profile-picture/${customAvatarId}/${settings.store.loadEmoteScale}x`;
        staticAvatar = `${basePfpUrl}_static.${settings.store.staticImageFormat}`;
        animatedAvatar = `${basePfpUrl}.${settings.store.animatedImageFormat}`;
    } else {
        let platformAvatarUrl = setOwner.mainConnection.platformAvatarUrl;
        staticAvatar = platformAvatarUrl;
        animatedAvatar = platformAvatarUrl;
    }

    let result = {
        id: setData.id,
        name: setData.name,
        emotes: parsedEmotes,
        avatarUrl: {
            static: staticAvatar,
            animated: animatedAvatar,
        }
    };

    return result;
}


export const stv = new SevenTVApi();
