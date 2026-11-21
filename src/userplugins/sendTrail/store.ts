/*
 * TrashCord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import * as DataStore from "@api/DataStore";
import { showNotification } from "@api/Notifications";
import { makeLazy } from "@utils/lazy";
import { sleep } from "@utils/misc";
import { React, UserStore } from "@webpack/common";
import type { DispatchWithoutAction } from "react";

import type { SentTrailMediaItem, SentTrailRecord } from "./types";

const STORAGE_PREFIX = "kamidere-send-trail:";
const getLegacyStore = makeLazy(() => DataStore.createStore(IS_REPORTER ? "VencordDataReporter" : "VencordData", "VencordStore"));
const getStore = makeLazy(() => {
    const databaseName = IS_REPORTER ? "SendTrailDataReporter" : "SendTrailData";
    let store = DataStore.createStore(databaseName, "SendTrailStore");
    const retryStore: DataStore.UseStore = async (mode, callback) => {
        let opened = false;
        try {
            return await store(mode, objectStore => {
                opened = true;
                return callback(objectStore);
            });
        } catch (error) {
            if (!(error instanceof DOMException) || error.name !== "UnknownError") throw error;
            if (!opened) store = DataStore.createStore(databaseName, "SendTrailStore");
            await sleep(250);
            return store(mode, callback).catch((cause: unknown) => {
                throw new Error("Could not access the separate Send Trail history database after retrying.", { cause });
            });
        }
    };
    return retryStore;
});
const migrations = new Map<string, Promise<void>>();
const signals = new Set<DispatchWithoutAction>();
const recordCache = new Map<string, SentTrailRecord[]>();

function getCachedRecords(userId: string | null) {
    if (!userId) return [];
    return recordCache.get(userId) ?? [];
}

function setCachedRecords(userId: string | null, records: SentTrailRecord[]) {
    if (!userId) return;
    recordCache.set(userId, records);
}

function sameMedia(left: SentTrailMediaItem, right: SentTrailMediaItem) {
    return left.source === right.source && left.kind === right.kind && left.url === right.url;
}

export function hasSentTrailRecord(userId: string | null, channelId: string, messageId: string) {
    if (!userId) return false;
    return getCachedRecords(userId).some(record => record.channelId === channelId && record.messageId === messageId);
}

export function mayHaveSentTrailRecord(userId: string | null, channelId: string, messageId: string) {
    if (!userId) return false;
    const cached = recordCache.get(userId);
    return !cached || cached.some(record => record.channelId === channelId && record.messageId === messageId);
}

function emit() {
    signals.forEach(signal => signal());
}

function getStorageKey(userId: string) {
    return `${STORAGE_PREFIX}${userId}`;
}

function migrateRecords(userId: string) {
    let migration = migrations.get(userId);
    if (!migration) {
        migration = (async () => {
            const key = getStorageKey(userId);
            if ((await DataStore.keys<string>(getStore())).includes(key)) return;
            let unreadable = false;
            const records = await DataStore.get<SentTrailRecord[]>(key, getLegacyStore()).catch((error: unknown) => {
                if (!(error instanceof DOMException) || (error.name !== "UnknownError" && (error.name !== "NotReadableError" || !error.message.includes("irrecoverable")))) throw error;
                unreadable = true;
                return getCachedRecords(userId);
            });
            await updateRecords(userId, existing => existing ?? records ?? []);
            if (unreadable) {
                void showNotification({
                    title: "Send Trail uses a separate archive",
                    body: "The previous history could not be read and was left unchanged. New messages will be saved in a separate archive.",
                });
            }
        })().catch((error: unknown) => {
            migrations.delete(userId);
            throw error;
        });
        migrations.set(userId, migration);
    }
    return migration;
}

async function updateRecords(userId: string, updater: (records: SentTrailRecord[] | undefined) => SentTrailRecord[] | undefined) {
    const key = getStorageKey(userId);
    let recovered = false;
    await getStore()("readwrite", store => new Promise<void>((resolve, reject) => {
        recovered = false;
        const request = store.get(key);
        void DataStore.promisifyRequest(store.transaction).then(resolve, (error: unknown) =>
            reject(error ?? new Error("Could not update Send Trail history.")));
        store.transaction.onerror = (event: Event) => {
            if (event.target instanceof IDBRequest) reject(event.target.error);
        };
        request.onsuccess = request.onerror = (event: Event) => {
            const { error } = request;
            if (error) {
                if (error.name !== "NotReadableError" || !error.message.includes("irrecoverable")) return;
                event.preventDefault();
                event.stopPropagation();
                recovered = true;
            }
            try {
                const existing: SentTrailRecord[] | undefined = recovered ? [...getCachedRecords(userId)] : request.result;
                const records = updater(existing);
                if (records !== undefined || recovered) store.put(records ?? existing, key);
            } catch (error) {
                reject(error);
            }
        };
    }));

    if (recovered) {
        void showNotification({
            title: "Send Trail tracking restored",
            body: "The saved history was damaged. Tracking has resumed using the entries still available in memory. Earlier entries may be missing.",
        });
    }
}

export async function getSentTrailRecords(userId: string | null) {
    if (!userId) return [];
    await migrateRecords(userId);
    const records = await DataStore.get<SentTrailRecord[]>(getStorageKey(userId), getStore()).catch(async (error: unknown) => {
        if (!(error instanceof DOMException) || error.name !== "NotReadableError" || !error.message.includes("irrecoverable")) throw error;
        let recovered: SentTrailRecord[] = [];
        await updateRecords(userId, existing => { recovered = existing ?? []; });
        return recovered;
    });
    const nextRecords = records ?? [];
    setCachedRecords(userId, nextRecords);
    return nextRecords;
}

export async function appendSentTrailRecord(record: SentTrailRecord) {
    const userId = UserStore.getCurrentUser()?.id;
    if (!userId) return;
    await migrateRecords(userId);
    let nextRecords = getCachedRecords(userId);

    await updateRecords(userId, existing => {
        const records = existing ?? [];
        const index = records.findIndex(item => item.channelId === record.channelId && item.messageId === record.messageId);

        if (index === -1) {
            records.unshift(record);
            if (records.length > 1 && records[1].timestamp > record.timestamp) {
                records.sort((left, right) => right.timestamp - left.timestamp);
            }
        } else {
            records[index] = { ...records[index], ...record };
        }

        nextRecords = records;
        return records;
    });

    setCachedRecords(userId, nextRecords);
    emit();
}

export async function mergeSentTrailRecordMedia(
    channelId: string,
    messageId: string,
    media: SentTrailMediaItem[],
    metadata?: Partial<Pick<SentTrailRecord, "guildId" | "jumpLink" | "channelNameSnapshot" | "guildNameSnapshot" | "recipientUserIds">>,
) {
    const userId = UserStore.getCurrentUser()?.id;
    if (!userId || media.length === 0) return;

    const cached = recordCache.get(userId);
    if (cached) {
        const known = cached.find(record => record.channelId === channelId && record.messageId === messageId);
        if (!known || media.every(item => known.media.some(existing => sameMedia(existing, item)))) return;
    }

    await migrateRecords(userId);

    let nextRecords: SentTrailRecord[] | undefined;

    await updateRecords(userId, records => {
        if (!records?.length) return;
        const index = records.findIndex(record => record.channelId === channelId && record.messageId === messageId);
        if (index === -1) return;

        const current = records[index];
        let nextMedia = current.media;

        for (const item of media) {
            if (nextMedia.some(existing => sameMedia(existing, item))) continue;
            if (nextMedia === current.media) nextMedia = [...current.media];
            nextMedia.push(item);
        }

        const nextRecord: SentTrailRecord = {
            ...current,
            media: nextMedia,
            hasMedia: nextMedia.length > 0,
            guildId: metadata?.guildId ?? current.guildId,
            jumpLink: metadata?.jumpLink ?? current.jumpLink,
            channelNameSnapshot: metadata?.channelNameSnapshot ?? current.channelNameSnapshot,
            guildNameSnapshot: metadata?.guildNameSnapshot ?? current.guildNameSnapshot,
            recipientUserIds: metadata?.recipientUserIds ?? current.recipientUserIds,
        };

        if (
            nextRecord.hasMedia === current.hasMedia &&
            nextRecord.media === current.media &&
            nextRecord.jumpLink === current.jumpLink &&
            nextRecord.guildId === current.guildId &&
            nextRecord.channelNameSnapshot === current.channelNameSnapshot &&
            nextRecord.guildNameSnapshot === current.guildNameSnapshot &&
            (nextRecord.recipientUserIds?.join(",") ?? "") === (current.recipientUserIds?.join(",") ?? "")
        ) {
            return;
        }

        records[index] = nextRecord;
        nextRecords = records;
        return records;
    });

    if (nextRecords) {
        setCachedRecords(userId, nextRecords);
        emit();
    }
}

export async function clearSentTrailRecords(userId: string | null) {
    if (!userId) return;
    await DataStore.set(getStorageKey(userId), [], getStore());
    setCachedRecords(userId, []);
    emit();
}

export async function clearSentTrailRecordsWhere(
    userId: string | null,
    predicate: (record: SentTrailRecord) => boolean,
) {
    if (!userId) return;
    await migrateRecords(userId);
    let nextRecords: SentTrailRecord[] | undefined;

    await updateRecords(userId, existing => {
        const records = existing ?? [];
        const filtered = records.filter(record => !predicate(record));
        if (filtered.length === records.length) {
            if (getCachedRecords(userId).some(predicate)) nextRecords = records;
            return;
        }
        nextRecords = filtered;
        return filtered;
    });

    if (nextRecords) {
        setCachedRecords(userId, nextRecords);
        emit();
    }
}

export function removeSentTrailRecord(userId: string | null, channelId: string, messageId: string) {
    return clearSentTrailRecordsWhere(userId, record => record.channelId === channelId && record.messageId === messageId);
}

export function useSentTrailRecords(userId: string | null) {
    const [signal, notify] = React.useReducer((value: number) => value + 1, 0);
    const [records, setRecords] = React.useState<SentTrailRecord[]>(() => getCachedRecords(userId));
    const [pending, setPending] = React.useState(() => !!userId && !recordCache.has(userId));

    React.useEffect(() => {
        signals.add(notify);
        return () => void signals.delete(notify);
    }, []);

    React.useEffect(() => {
        let alive = true;
        setRecords(getCachedRecords(userId));
        setPending(!!userId && !recordCache.has(userId));

        void getSentTrailRecords(userId).then(nextRecords => {
            if (!alive) return;
            setRecords(nextRecords);
            setPending(false);
        });

        return () => {
            alive = false;
        };
    }, [userId]);

    React.useEffect(() => {
        if (signal && userId && recordCache.has(userId)) setRecords(getCachedRecords(userId));
    }, [signal]);

    return [records, pending] as const;
}