/*
 * TrashCord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { findGroupChildrenByChildId, NavContextMenuPatchCallback } from "@api/ContextMenu";
import { DataStore } from "@api/index";
import { definePluginSettings } from "@api/Settings";
import ErrorBoundary from "@components/ErrorBoundary";
import { ImageIcon } from "@components/Icons";
import { Alerts } from "@webpack/common";
import { ModalCloseButton, ModalContent, ModalHeader, ModalRoot, ModalSize, openModal } from "@utils/modal";
import definePlugin, { OptionType } from "@utils/types";
import { findByPropsLazy, findComponentByCodeLazy } from "@webpack";
import { Text } from "@components/Text";
import { FluxDispatcher, Menu, React, UserStore, useState, useEffect, useRef } from "@webpack/common";

const PanelButton = findComponentByCodeLazy(".GREEN,positionKeyStemOverride:");
const ChannelStoreMod = findByPropsLazy("getChannel", "getDMFromUserId");
const SelectedChannelStoreMod = findByPropsLazy("getVoiceChannelId");
const TokenMod = findByPropsLazy("getToken");
const SuperPropsMod = findByPropsLazy("getSuperProperties");
const LocaleMod = findByPropsLazy("getLocale");

const DATASTORE_KEY_PROFILES = "CustomStreamTopQ_Profiles";
const DATASTORE_KEY_SLIDESHOW = "CustomStreamTopQ_Slideshow";
const DATASTORE_KEY_INDEX = "CustomStreamTopQ_SlideIndex";
const DATASTORE_KEY = "CustomStreamTopQ_ImageData";
const DATASTORE_KEY_STATE = "CustomStreamTopQ_State";
const DATASTORE_KEY_LIBRARY = "CustomStreamTopQ_Library";
const imageKey = (id: string) => `CustomStreamTopQ_Image_${id}`;
const MAX_IMAGES_PER_PROFILE = 100;
const MAX_PROFILES = 10;
const DEFAULT_PROFILE_ID = "default";

interface Profile {
    id: string;
    name: string;
    imageIds: string[];
    dataUris: string[];
    loaded: boolean;
    currentIndex: number;
    intervalSec: number;
}

interface StoredProfile {
    id: string;
    name: string;
    dataUris?: string[];
    images?: { type: string; data: number[]; }[];
    currentIndex: number;
    intervalSec?: number;
}

interface StoredProfilesData {
    version?: number;
    profiles: StoredProfile[];
    activeProfileId: string;
}

interface LegacySlideshowData {
    images: { type: string; data: number[]; }[];
}

interface LibraryMeta {
    version: 3;
    activeId: string;
    profiles: { id: string; name: string; imageIds: string[]; currentIndex: number; intervalSec?: number; }[];
}

let profiles: Map<string, Profile> = new Map();
let activeProfileId: string = DEFAULT_PROFILE_ID;

let cachedDataUris: string[] = [];
let currentSlideIndex = 0;
let lastSlideChangeTime = 0;
let isStreamActive = false;
let actualStreamImageUri: string | null = null;
let capturedStreamKey: string | null = null;
let instantTimer: ReturnType<typeof setTimeout> | null = null;
let randomQueue: number[] = [];
let forceBusy = false;
let forcePending = false;
let blockedUntil = 0;
let lastForcedAt = 0;
let lastForcedImage: string | null = null;
let forceRetries = 0;
let forceRetryTimer: ReturnType<typeof setTimeout> | null = null;
let metaTimer: ReturnType<typeof setTimeout> | null = null;
let storageReady = false;
let legacyPresent = false;
let loadedOrder: string[] = [];
let switchToken = 0;
let lastAdvanceAt = 0;
let nativeSeen = false;
let lastStatus = 0;
let lastError = "";

function buildRandomQueue(): number[] {
    const len = cachedDataUris.length;
    if (len <= 1) return [];
    const indices = Array.from({ length: len }, (_, i) => i);
    for (let i = indices.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [indices[i], indices[j]] = [indices[j], indices[i]];
    }
    return indices.filter(i => i !== currentSlideIndex);
}

function getRandomNext(): number {
    randomQueue = randomQueue.filter(i => i < cachedDataUris.length);
    if (randomQueue.length === 0) randomQueue = buildRandomQueue();
    return randomQueue.shift() ?? 0;
}

function isRandomActive(): boolean {
    return settings.store.slideshowRandom && cachedDataUris.length > 2;
}

function getActiveProfile(): Profile {
    let profile = profiles.get(activeProfileId);
    if (!profile) {
        profile = newProfile(DEFAULT_PROFILE_ID, "Default");
        profiles.set(DEFAULT_PROFILE_ID, profile);
    }
    return profile;
}

function syncCacheWithActiveProfile() {
    const profile = getActiveProfile();
    cachedDataUris = profile.dataUris;
    currentSlideIndex = profile.currentIndex;
    randomQueue = [];
}

const imageChangeListeners = new Set<() => void>();

function notifyImageChange() {
    imageChangeListeners.forEach(fn => fn());
}

function persistState() {
    if (metaTimer) clearTimeout(metaTimer);
    metaTimer = setTimeout(() => {
        metaTimer = null;
        void writeMeta();
    }, 400);
}

const settings = definePluginSettings({
    replaceEnabled: {
        type: OptionType.BOOLEAN,
        description: "Use custom preview instead of screen capture",
        default: true
    },
    bypassPreviewToggle: {
        type: OptionType.BOOLEAN,
        description: "Force-send custom preview even when 'Show Stream Previews' toggle is OFF",
        default: true
    },
    slideshowEnabled: {
        type: OptionType.BOOLEAN,
        description: "Slideshow: switch the image automatically every interval below",
        default: false
    },
    slideshowRandom: {
        type: OptionType.BOOLEAN,
        description: "Random slide order",
        default: false
    },
    showInfoBadges: {
        type: OptionType.BOOLEAN,
        description: "Show info badges in modal (count, selected, timer)",
        default: true
    },
    showPanelButton: {
        type: OptionType.BOOLEAN,
        description: "Show button in user area (account panel)",
        default: false
    },
    instantSlideshowInterval: {
        type: OptionType.NUMBER,
        description: "Default slideshow interval in seconds for profiles without their own (5 to 86400; under 300 is test mode)",
        default: 120
    }
});

function blobToDataUrl(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
}

function estimateSizeFromDataUri(uri: string): number {
    const comma = uri.indexOf(",");
    if (comma === -1) return 0;
    return Math.round((uri.length - comma - 1) * 0.75);
}

async function legacyBytesToDataUri(data: number[], type: string): Promise<string> {
    return blobToDataUrl(new Blob([new Uint8Array(data)], { type }));
}

const clampIndex = (i: number, n: number) => (n === 0 || !Number.isInteger(i) || i < 0 ? 0 : Math.min(i, n - 1));

function newProfile(id: string, name: string): Profile {
    return { id, name, imageIds: [], dataUris: [], loaded: true, currentIndex: 0, intervalSec: 0 };
}

function sanitizeInterval(v: unknown): number {
    const n = Number(v);
    return Number.isFinite(n) && n >= MIN_INTERVAL_SEC ? Math.min(Math.round(n), MAX_INTERVAL_SEC) : 0;
}

function ensureDefaultProfile() {
    if (!profiles.has(DEFAULT_PROFILE_ID)) profiles.set(DEFAULT_PROFILE_ID, newProfile(DEFAULT_PROFILE_ID, "Default"));
    if (!profiles.has(activeProfileId)) activeProfileId = DEFAULT_PROFILE_ID;
}

function buildMeta(): LibraryMeta {
    return {
        version: 3,
        activeId: activeProfileId,
        profiles: Array.from(profiles.values()).map(p => ({ id: p.id, name: p.name, imageIds: p.imageIds.slice(), currentIndex: p.currentIndex, intervalSec: p.intervalSec }))
    };
}

async function writeMeta(): Promise<void> {
    if (!storageReady) return;
    const meta = buildMeta();
    try {
        await DataStore.set(DATASTORE_KEY_LIBRARY, meta);
    } catch { }
}

async function saveProfilesToDataStore(): Promise<void> {
    syncCacheWithActiveProfile();
    notifyImageChange();
    await writeMeta();
}

const shrinking = new WeakSet<Profile>();

async function shrinkOversized(p: Profile): Promise<void> {
    if (shrinking.has(p)) return;
    shrinking.add(p);
    try {
        for (const id of p.imageIds.slice()) {
            if (!p.loaded || profiles.get(p.id) !== p) return;
            let idx = p.imageIds.indexOf(id);
            const cur = idx === -1 ? undefined : p.dataUris[idx];
            if (typeof cur !== "string" || estimateSizeFromDataUri(cur) <= MAX_THUMB_BYTES) continue;
            try {
                const small = await shrinkDataUri(cur);
                if (!p.loaded || profiles.get(p.id) !== p) return;
                idx = p.imageIds.indexOf(id);
                if (idx === -1) continue;
                p.dataUris[idx] = small;
                if (storageReady) await DataStore.set(imageKey(id), small).catch(() => { });
                if (p.id === activeProfileId && profiles.get(p.id) === p) {
                    notifyImageChange();
                    if (p.imageIds.indexOf(id) === p.currentIndex) forceNow();
                }
            } catch { }
        }
    } finally {
        shrinking.delete(p);
    }
}

async function loadProfileImages(p: Profile): Promise<boolean> {
    try {
        const values = await DataStore.getMany<string | undefined>(p.imageIds.map(imageKey));
        const ids: string[] = [];
        const uris: string[] = [];
        p.imageIds.forEach((id, i) => {
            const v = values[i];
            if (typeof v === "string" && v.length > 0) {
                ids.push(id);
                uris.push(v);
            }
        });
        const dropped = ids.length !== p.imageIds.length;
        p.imageIds = ids;
        p.dataUris = uris;
        p.loaded = true;
        p.currentIndex = clampIndex(p.currentIndex, uris.length);
        if (dropped) persistState();
        void shrinkOversized(p);
        return true;
    } catch {
        return false;
    }
}

function touchLoaded(id: string) {
    loadedOrder = [id, ...loadedOrder.filter(x => x !== id)];
    while (loadedOrder.length > 2) {
        const old = profiles.get(loadedOrder.pop()!);
        if (old && old.id !== activeProfileId) {
            old.dataUris = [];
            old.loaded = false;
        }
    }
}

async function activateProfile(id: string): Promise<boolean> {
    const p = profiles.get(id);
    if (!p) return false;
    const token = ++switchToken;
    if (!p.loaded && !(await loadProfileImages(p))) return false;
    if (token !== switchToken || !profiles.has(id)) return false;
    activeProfileId = id;
    touchLoaded(id);
    syncCacheWithActiveProfile();
    notifyImageChange();
    rescheduleKeepAlive();
    return true;
}

async function addImagesToProfile(target: Profile, uris: string[]): Promise<boolean> {
    if (uris.length === 0) return true;
    const ids = uris.map(() => crypto.randomUUID());
    if (storageReady) {
        try {
            for (let i = 0; i < ids.length; i += 10) {
                await DataStore.setMany(ids.slice(i, i + 10).map((id, j) => [imageKey(id), uris[i + j]] as [string, string]));
            }
        } catch {
            DataStore.delMany(ids.map(imageKey)).catch(() => { });
            return false;
        }
    }
    if (!profiles.has(target.id)) return false;
    target.imageIds.push(...ids);
    target.dataUris.push(...uris);
    if (target.id === activeProfileId) syncCacheWithActiveProfile();
    notifyImageChange();
    await writeMeta();
    return true;
}

function createProfile(name: string): Profile | null {
    if (profiles.size >= MAX_PROFILES) return null;
    const id = `profile_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
    const profile = newProfile(id, name);
    profiles.set(id, profile);
    return profile;
}

async function removeProfile(profileId: string): Promise<void> {
    const p = profiles.get(profileId);
    if (!p || p.imageIds.length > 0 || profileId === DEFAULT_PROFILE_ID) return;
    profiles.delete(profileId);
    loadedOrder = loadedOrder.filter(x => x !== profileId);
    if (activeProfileId === profileId) await activateProfile(DEFAULT_PROFILE_ID);
    notifyImageChange();
    persistState();
}

function renameProfile(profileId: string, newName: string): boolean {
    const profile = profiles.get(profileId);
    if (!profile) return false;
    profile.name = newName;
    return true;
}

function getProfileList(): Profile[] {
    return Array.from(profiles.values());
}

async function deleteAllImages(): Promise<void> {
    const profile = getActiveProfile();
    const ids = profile.imageIds;
    profile.imageIds = [];
    profile.dataUris = [];
    profile.currentIndex = 0;
    syncCacheWithActiveProfile();
    notifyImageChange();
    persistState();
    if (ids.length > 0 && storageReady) DataStore.delMany(ids.map(imageKey)).catch(() => { });
}

async function deleteImageAtIndex(index: number): Promise<void> {
    const profile = getActiveProfile();
    if (index < 0 || index >= profile.dataUris.length) return;
    const [id] = profile.imageIds.splice(index, 1);
    profile.dataUris.splice(index, 1);
    if (profile.dataUris.length === 0) {
        profile.currentIndex = 0;
    } else if (index < profile.currentIndex) {
        profile.currentIndex--;
    } else if (index === profile.currentIndex) {
        profile.currentIndex = Math.min(profile.currentIndex, profile.dataUris.length - 1);
    }
    syncCacheWithActiveProfile();
    notifyImageChange();
    persistState();
    if (id && storageReady) DataStore.del(imageKey(id)).catch(() => { });
}

async function moveImage(fromIndex: number, toIndex: number): Promise<void> {
    const profile = getActiveProfile();
    const n = profile.dataUris.length;
    if (fromIndex === toIndex || fromIndex < 0 || fromIndex >= n || toIndex < 0 || toIndex >= n) return;
    [profile.dataUris[fromIndex], profile.dataUris[toIndex]] = [profile.dataUris[toIndex], profile.dataUris[fromIndex]];
    [profile.imageIds[fromIndex], profile.imageIds[toIndex]] = [profile.imageIds[toIndex], profile.imageIds[fromIndex]];
    if (profile.currentIndex === fromIndex) profile.currentIndex = toIndex;
    else if (profile.currentIndex === toIndex) profile.currentIndex = fromIndex;
    syncCacheWithActiveProfile();
    notifyImageChange();
    persistState();
}

interface LegacyLibrary {
    list: { id: string; name: string; uris: string[]; currentIndex: number; }[];
    activeId: string;
}

async function readLegacy(): Promise<LegacyLibrary | null> {
    let result: LegacyLibrary | null = null;
    const data = await DataStore.get<StoredProfilesData>(DATASTORE_KEY_PROFILES);
    if (data?.profiles?.length) {
        const list: LegacyLibrary["list"] = [];
        for (const s of data.profiles) {
            let uris = s.dataUris;
            if (!uris) {
                uris = [];
                for (const img of s.images ?? []) uris.push(await legacyBytesToDataUri(img.data, img.type));
            }
            list.push({ id: s.id, name: s.name, uris: uris.filter(u => typeof u === "string" && u.length > 0), currentIndex: s.currentIndex ?? 0 });
        }
        result = { list, activeId: data.activeProfileId || DEFAULT_PROFILE_ID };
    } else {
        const old = await DataStore.get<LegacySlideshowData>(DATASTORE_KEY_SLIDESHOW);
        if (old?.images?.length) {
            const uris: string[] = [];
            for (const img of old.images) uris.push(await legacyBytesToDataUri(img.data, img.type));
            const idx = (await DataStore.get<number>(DATASTORE_KEY_INDEX)) ?? 0;
            result = { list: [{ id: DEFAULT_PROFILE_ID, name: "Default", uris, currentIndex: idx }], activeId: DEFAULT_PROFILE_ID };
        }
    }
    if (!result) return null;
    const st = await DataStore.get<{ activeProfileId?: string; indices?: Record<string, number>; }>(DATASTORE_KEY_STATE);
    if (st) {
        if (st.activeProfileId && result.list.some(p => p.id === st.activeProfileId)) result.activeId = st.activeProfileId;
        for (const p of result.list) {
            const i = st.indices?.[p.id];
            if (typeof i === "number") p.currentIndex = i;
        }
    }
    return result;
}

async function migrateLegacy(): Promise<boolean> {
    const legacy = await readLegacy();
    if (!legacy) return false;

    const next = new Map<string, Profile>();
    const keys: string[] = [];
    const values: string[] = [];
    for (const p of legacy.list) {
        const ids = p.uris.map((_, i) => `m_${p.id}_${i}`);
        ids.forEach((id, i) => {
            keys.push(imageKey(id));
            values.push(p.uris[i]);
        });
        next.set(p.id, { id: p.id, name: p.name, imageIds: ids, dataUris: [], loaded: false, currentIndex: clampIndex(p.currentIndex, ids.length), intervalSec: 0 });
    }

    let committed = false;
    try {
        let verified = true;
        for (let i = 0; i < keys.length && verified; i += 10) {
            const ks = keys.slice(i, i + 10);
            await DataStore.setMany(ks.map((k, j) => [k, values[i + j]] as [string, string]));
            const back = await DataStore.getMany<string | undefined>(ks);
            if (back.some((v, j) => typeof v !== "string" || v.length !== values[i + j].length)) verified = false;
        }
        if (verified) {
            profiles.clear();
            next.forEach((p, id) => profiles.set(id, p));
            activeProfileId = next.has(legacy.activeId) ? legacy.activeId : DEFAULT_PROFILE_ID;
            ensureDefaultProfile();
            await DataStore.set(DATASTORE_KEY_LIBRARY, buildMeta());
            committed = true;
        }
    } catch {
        committed = false;
    }

    if (committed) {
        storageReady = true;
        legacyPresent = true;
        return true;
    }

    profiles.clear();
    for (const p of legacy.list) {
        profiles.set(p.id, {
            id: p.id,
            name: p.name,
            imageIds: p.uris.map((_, i) => `m_${p.id}_${i}`),
            dataUris: p.uris,
            loaded: true,
            currentIndex: clampIndex(p.currentIndex, p.uris.length),
            intervalSec: 0
        });
    }
    activeProfileId = profiles.has(legacy.activeId) ? legacy.activeId : DEFAULT_PROFILE_ID;
    ensureDefaultProfile();
    storageReady = false;
    return true;
}

async function loadLibrary(): Promise<void> {
    profiles.clear();
    loadedOrder = [];
    storageReady = false;
    legacyPresent = false;
    try {
        const meta = await DataStore.get<LibraryMeta>(DATASTORE_KEY_LIBRARY);
        if (meta?.version === 3 && Array.isArray(meta.profiles)) {
            for (const m of meta.profiles) {
                profiles.set(m.id, { id: m.id, name: m.name, imageIds: Array.isArray(m.imageIds) ? m.imageIds : [], dataUris: [], loaded: false, currentIndex: m.currentIndex ?? 0, intervalSec: sanitizeInterval(m.intervalSec) });
            }
            activeProfileId = meta.activeId && profiles.has(meta.activeId) ? meta.activeId : DEFAULT_PROFILE_ID;
            ensureDefaultProfile();
            if (!(await loadProfileImages(getActiveProfile()))) throw new Error("read");
            storageReady = true;
            try {
                legacyPresent = (await DataStore.keys()).includes(DATASTORE_KEY_PROFILES);
            } catch {
                try {
                    legacyPresent = (await DataStore.get(DATASTORE_KEY_STATE)) !== undefined;
                } catch { }
            }
        } else if (await migrateLegacy()) {
            if (storageReady && !(await loadProfileImages(getActiveProfile()))) storageReady = false;
        } else {
            ensureDefaultProfile();
            storageReady = true;
        }
    } catch {
        ensureDefaultProfile();
    }
    ensureDefaultProfile();
    loadedOrder = [activeProfileId];
    syncCacheWithActiveProfile();
    notifyImageChange();
}

async function cleanupLegacy(): Promise<void> {
    if (!storageReady) return;
    try {
        await DataStore.delMany([DATASTORE_KEY_PROFILES, DATASTORE_KEY_SLIDESHOW, DATASTORE_KEY_INDEX, DATASTORE_KEY, DATASTORE_KEY_STATE]);
        legacyPresent = false;
    } catch { }
    notifyImageChange();
}

async function buildBackup(): Promise<StoredProfilesData> {
    const out: StoredProfile[] = [];
    for (const p of profiles.values()) {
        let uris = p.dataUris;
        if (!p.loaded) {
            const values = await DataStore.getMany<string | undefined>(p.imageIds.map(imageKey));
            uris = values.filter((v): v is string => typeof v === "string");
        }
        out.push({ id: p.id, name: p.name, dataUris: uris, currentIndex: p.currentIndex, intervalSec: p.intervalSec });
    }
    return { version: 2, profiles: out, activeProfileId };
}

async function applyBackup(data: StoredProfilesData): Promise<boolean> {
    if (!Array.isArray(data?.profiles)) return false;
    const oldIds = Array.from(profiles.values()).flatMap(p => p.imageIds);
    const next = new Map<string, Profile>();
    const loadedUris = new Map<string, string[]>();
    const entries: [string, string][] = [];

    for (const s of data.profiles.slice(0, MAX_PROFILES)) {
        if (typeof s?.id !== "string" || typeof s.name !== "string") continue;
        const uris = (s.dataUris ?? []).filter(u => typeof u === "string" && u.startsWith("data:")).slice(0, MAX_IMAGES_PER_PROFILE);
        const ids = uris.map(() => crypto.randomUUID());
        ids.forEach((id, i) => entries.push([imageKey(id), uris[i]]));
        loadedUris.set(s.id, uris);
        next.set(s.id, { id: s.id, name: s.name.slice(0, 40), imageIds: ids, dataUris: [], loaded: false, currentIndex: clampIndex(s.currentIndex ?? 0, ids.length), intervalSec: sanitizeInterval(s.intervalSec) });
    }

    try {
        if (storageReady) {
            for (let i = 0; i < entries.length; i += 10) await DataStore.setMany(entries.slice(i, i + 10));
        }
    } catch {
        DataStore.delMany(entries.map(e => e[0])).catch(() => { });
        return false;
    }

    profiles.clear();
    next.forEach((p, id) => profiles.set(id, p));
    activeProfileId = data.activeProfileId && profiles.has(data.activeProfileId) ? data.activeProfileId : DEFAULT_PROFILE_ID;
    ensureDefaultProfile();
    const active = getActiveProfile();
    active.dataUris = loadedUris.get(active.id) ?? [];
    active.loaded = true;
    loadedOrder = [active.id];
    lastForcedImage = null;
    syncCacheWithActiveProfile();
    void shrinkOversized(active);
    notifyImageChange();
    await writeMeta();
    if (storageReady && oldIds.length > 0) DataStore.delMany(oldIds.map(imageKey)).catch(() => { });
    return true;
}

async function resetLibrary(): Promise<void> {
    const oldIds = Array.from(profiles.values()).flatMap(p => p.imageIds);
    profiles.clear();
    activeProfileId = DEFAULT_PROFILE_ID;
    ensureDefaultProfile();
    loadedOrder = [DEFAULT_PROFILE_ID];
    cachedDataUris = [];
    currentSlideIndex = 0;
    randomQueue = [];
    lastForcedImage = null;
    syncCacheWithActiveProfile();
    notifyImageChange();
    await writeMeta();
    if (storageReady && oldIds.length > 0) DataStore.delMany(oldIds.map(imageKey)).catch(() => { });
}

function getImageCount(): number {
    return cachedDataUris.length;
}

const MAX_THUMB_BYTES = 190 * 1024;

function canvasToBlob(c: HTMLCanvasElement, q: number): Promise<Blob | null> {
    return new Promise(res => c.toBlob(res, "image/jpeg", q));
}

async function encodeUnderLimit(src: CanvasImageSource, w0: number, h0: number, qualities = [0.7, 0.6, 0.5, 0.4, 0.3]): Promise<string> {
    const sizes: [number, number][] = [[1280, 720], [960, 540], [640, 360]];
    let last: Blob | null = null;
    for (const [w, h] of sizes) {
        const c = document.createElement("canvas");
        c.width = w;
        c.height = h;
        const ctx = c.getContext("2d")!;
        ctx.fillStyle = "#000000";
        ctx.fillRect(0, 0, w, h);
        const scale = Math.max(w / w0, h / h0);
        ctx.drawImage(src, (w - w0 * scale) / 2, (h - h0 * scale) / 2, w0 * scale, h0 * scale);
        for (const q of qualities) {
            const b = await canvasToBlob(c, q);
            if (!b) continue;
            last = b;
            if (b.size <= MAX_THUMB_BYTES) return blobToDataUrl(b);
        }
    }
    if (!last) throw new Error("Failed to convert image");
    return blobToDataUrl(last);
}

function shrinkDataUri(uri: string): Promise<string> {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => encodeUnderLimit(img, img.naturalWidth, img.naturalHeight, [0.55, 0.45, 0.35, 0.3]).then(resolve, reject);
        img.onerror = () => reject(new Error("Failed to load image"));
        img.src = uri;
    });
}

async function processImage(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
        const img = new Image();
        const url = URL.createObjectURL(blob);
        img.onload = () => {
            URL.revokeObjectURL(url);
            encodeUnderLimit(img, img.width, img.height).then(resolve, reject);
        };
        img.onerror = () => {
            URL.revokeObjectURL(url);
            reject(new Error("Failed to load image"));
        };
        img.src = url;
    });
}

function useTick() {
    const [, set] = useState(0);
    useEffect(() => {
        const fn = () => set(n => n + 1);
        imageChangeListeners.add(fn);
        return () => { imageChangeListeners.delete(fn); };
    }, []);
}

const C = { blue: "#5865F2", green: "#3ba55c", red: "#ed4245", gray: "#2b2d31", mid: "#6d6f78", on: "#4e5058", redDk: "#8f2f33", amber: "#faa61a", dark: "#111214" };

function Chip({ label, on, color, onClick, disabled, title }: {
    label: string;
    on?: boolean;
    color?: string;
    onClick?: () => void;
    disabled?: boolean;
    title?: string;
}) {
    return (
        <div
            title={title}
            onClick={disabled ? undefined : onClick}
            style={{
                padding: "5px 10px",
                borderRadius: 4,
                fontSize: 12,
                fontWeight: 600,
                lineHeight: "16px",
                color: on ? "#fff" : "#b5bac1",
                whiteSpace: "nowrap",
                userSelect: "none",
                cursor: disabled ? "not-allowed" : "pointer",
                opacity: disabled ? 0.4 : 1,
                background: on ? (color ?? C.on) : C.gray
            }}
        >
            {label}
        </div>
    );
}

function LiveCard({ replaceOn }: { replaceOn: boolean; }) {
    const [now, setNow] = useState(Date.now());
    useEffect(() => {
        if (!isStreamActive) return;
        const id = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(id);
    }, [isStreamActive]);
    const live = isStreamActive;
    const wanted = cachedDataUris.length > 0 ? cachedDataUris[Math.min(currentSlideIndex, cachedDataUris.length - 1)] : null;
    const sent = live && replaceOn && wanted !== null ? actualStreamImageUri : null;
    const shown = replaceOn && wanted !== null ? (sent ?? wanted) : null;
    const pending = live && replaceOn && wanted !== null && wanted !== sent;
    const ago = live && lastSlideChangeTime > 0 ? formatTime(Math.max(0, Math.floor((now - lastSlideChangeTime) / 1000))) : null;
    const waitSec = blockedUntil > now ? Math.ceil((blockedUntil - now) / 1000) : 0;
    const slideIn = live && settings.store.slideshowEnabled && cachedDataUris.length > 1 && lastAdvanceAt > 0 ? Math.max(0, Math.ceil((lastAdvanceAt + getIntervalMs() - now) / 1000)) : 0;
    let text = !replaceOn ? "Replace OFF - Discord uses your screen" : wanted === null ? "Profile empty - Discord uses your screen" : "Sent as soon as you start streaming";
    if (live) {
        if (!replaceOn) text = "Replace OFF - Discord sends your screen";
        else if (wanted === null) text = "Profile empty - Discord sends your screen";
        else if (pending) {
            const state = waitSec > 0
                ? ` - Discord limit, retry in ${formatTime(waitSec)}`
                : forceRetryTimer
                    ? ` - retry ${forceRetries}/${RETRY_STEPS.length}`
                    : lastStatus > 0
                        ? " - stopped, click an image to retry"
                        : " - sending";
            const err = lastStatus > 0 ? ` - error ${lastStatus}${lastError ? ` (${lastError})` : ""}` : "";
            text = `Not sent yet${state}${err}${sent ? " - viewers see the old one" : ""}`;
        }
        else if (sent) text = `Sent${ago ? ` ${ago} ago` : ""} - viewers may need ~2 min${slideIn > 0 ? ` - next slide in ${formatTime(slideIn)}` : ""}`;
        else text = "Waiting for the first upload";
    }
    return (
        <div style={{ display: "flex", gap: 10, alignItems: "center", padding: 8, borderRadius: 6, background: "var(--background-secondary)" }}>
            <div style={{ width: 112, height: 63, flex: "none", boxSizing: "border-box", borderRadius: 4, overflow: "hidden", background: "#000", border: `2px solid ${pending ? C.amber : sent ? C.green : C.mid}`, display: "grid", placeItems: "center" }}>
                {shown
                    ? <img src={shown} alt="" decoding="async" style={{ display: "block", width: "100%", height: "100%", objectFit: "cover" }} />
                    : <span style={{ color: "#80848e", fontSize: 11 }}>{replaceOn ? "empty" : "screen"}</span>}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: live ? C.red : "var(--text-muted)" }}>{live ? "● LIVE" : "○ Not streaming"}</span>
                <span style={{ fontSize: 12, color: "var(--text-normal)", wordBreak: "break-word" }}>{text}</span>
            </div>
        </div>
    );
}

const UNIT_SEC = { s: 1, m: 60, h: 3600 };

function splitInterval(sec: number): { value: string; unit: "s" | "m" | "h"; } {
    if (sec % 3600 === 0) return { value: String(sec / 3600), unit: "h" };
    if (sec % 60 === 0) return { value: String(sec / 60), unit: "m" };
    return { value: String(sec), unit: "s" };
}

function IntervalEditor({ seconds, custom, profileName }: { seconds: number; custom: boolean; profileName: string; }) {
    const init = splitInterval(seconds);
    const [text, setText] = useState(init.value);
    const [unit, setUnit] = useState<"s" | "m" | "h">(init.unit);
    const [hint, setHint] = useState("");

    useEffect(() => {
        const next = splitInterval(seconds);
        setText(next.value);
        setUnit(next.unit);
    }, [seconds]);

    const apply = (sec: number) => {
        getActiveProfile().intervalSec = sec;
        persistState();
        notifyImageChange();
        restartKeepAlive();
    };

    const commit = (t: string, u: "s" | "m" | "h") => {
        const n = Number(t.trim().replace(",", "."));
        const sec = Math.round(n * UNIT_SEC[u]);
        if (!Number.isFinite(n) || sec < MIN_INTERVAL_SEC || sec > MAX_INTERVAL_SEC) {
            setHint("Enter a value between 5 seconds and 24 hours");
            const back = splitInterval(seconds);
            setText(back.value);
            setUnit(back.unit);
            return;
        }
        setHint("");
        if (sec !== seconds || !custom) apply(sec);
    };

    const tag = seconds < 300
        ? { label: "[TEST] - Forced Upload", color: C.amber }
        : seconds === 300
            ? { label: "DISCORD DEFAULT", color: C.green }
            : { label: "SLOWER THAN DISCORD", color: "#949ba4" };

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 6, padding: 8, borderRadius: 6, background: "var(--background-secondary)" }}>
            <div style={row}>
                <Text size="sm" weight="semibold" style={{ color: "var(--header-primary)" }}>Image every</Text>
                <input
                    type="text"
                    inputMode="decimal"
                    value={text}
                    onChange={e => setText(e.target.value)}
                    onBlur={() => commit(text, unit)}
                    onKeyDown={e => {
                        if (e.key === "Enter") commit(text, unit);
                    }}
                    style={{ width: 60, padding: "4px 8px", borderRadius: 4, border: `1px solid ${C.mid}`, background: "var(--background-tertiary)", color: "var(--text-normal)", fontSize: 13, fontWeight: 600, textAlign: "center", outline: "none" }}
                />
                {(["s", "m", "h"] as const).map(u => (
                    <Chip key={u} on={unit === u} label={u === "s" ? "sec" : u === "m" ? "min" : "hours"} onClick={() => { setUnit(u); commit(text, u); }} />
                ))}
                <Chip on={seconds === 120} label="Default 2 min" title="Faster updates (test mode: below Discord's 5 min minimum)" onClick={() => { setHint(""); apply(120); }} />
                <Chip on={seconds === 300} label="Recommended 5 min" title="Discord's default: 5 minutes" onClick={() => { setHint(""); apply(300); }} />
                <span style={{ fontSize: 11, fontWeight: 700, color: tag.color }}>{tag.label}</span>
            </div>
            {hint && <div style={{ fontSize: 12, fontWeight: 600, color: C.red }}>{hint}</div>}
            <div style={{ padding: "6px 10px", borderRadius: 4, background: "var(--background-tertiary)", borderLeft: `3px solid ${C.amber}`, fontSize: 11, lineHeight: 1.5, color: "var(--text-muted)" }}>
                <span style={{ color: "var(--header-primary)", fontWeight: 600 }}>"{profileName} Profile"</span>
                <span>{" | "}</span>
                <span style={{ color: C.amber, fontWeight: 700 }}>Discord min 5m</span>
                <span>{" - "}</span>
                <span style={{ color: C.amber, fontWeight: 700 }}>Below = Forced Upload</span>
                <span>{" (Rate-Limit Risk, ~2m stale)"}</span>
            </div>
        </div>
    );
}

const row: React.CSSProperties = { display: "flex", alignItems: "center", flexWrap: "wrap", gap: 6 };
const tileBtn: React.CSSProperties = { width: 24, height: 24, borderRadius: 4, background: C.dark, color: "#fff", fontSize: 12, display: "grid", placeItems: "center", cursor: "pointer" };
const closeBtn: React.CSSProperties = { padding: "8px 18px", borderRadius: 6, border: "1px solid var(--background-modifier-accent)", background: "transparent", color: "var(--text-normal)", fontSize: 14, fontWeight: 600, cursor: "pointer" };

function ImagePickerModal({ rootProps }: { rootProps: any; }) {
    useTick();
    const s = settings.use(["replaceEnabled", "bypassPreviewToggle", "slideshowEnabled", "slideshowRandom", "showInfoBadges", "instantSlideshowInterval"]);
    const [error, setError] = useState("");
    const [busy, setBusy] = useState(false);
    const [zoom, setZoom] = useState<string | null>(null);
    const [dragFrom, setDragFrom] = useState<number | null>(null);
    const [dropOn, setDropOn] = useState<number | null>(null);
    const [fileOver, setFileOver] = useState(false);
    const [naming, setNaming] = useState<"new" | "rename" | null>(null);
    const [nameValue, setNameValue] = useState("");
    const singleInput = useRef<HTMLInputElement>(null);
    const multiInput = useRef<HTMLInputElement>(null);
    const backupInput = useRef<HTMLInputElement>(null);

    const profile = getActiveProfile();
    const profileList = getProfileList();
    const images = profile.dataUris;
    const count = images.length;
    const selected = count === 0 ? 0 : Math.min(Math.max(profile.currentIndex, 0), count - 1);
    const randomOk = count > 2;
    const nextIndex = count > 1 && s.slideshowEnabled && !(s.slideshowRandom && randomOk) ? (selected + 1) % count : -1;
    const canDeleteProfile = profile.id !== DEFAULT_PROFILE_ID && count === 0;
    const frame = s.replaceEnabled ? C.green : C.mid;
    const profileSec = getIntervalSec(profile);
    const pendingSend = isStreamActive && s.replaceEnabled && count > 0 && images[selected] !== actualStreamImageUri;
    const totalBytes = images.reduce((n, u) => n + estimateSizeFromDataUri(u), 0);

    const confirm = (title: string, body: string, confirmText: string, onConfirm: () => void) =>
        Alerts.show({ title, body, confirmText, cancelText: "Cancel", confirmColor: "red", onConfirm });

    const switchTo = async (id: string) => {
        if (id === activeProfileId) return;
        if (!(await activateProfile(id))) return;
        const p = getActiveProfile();
        lastForcedImage = null;
        if (p.dataUris.length === 0) actualStreamImageUri = null;
        persistState();
        notifyImageChange();
        restartKeepAlive();
        forceNow();
    };

    const selectImage = (index: number) => {
        profile.currentIndex = index;
        currentSlideIndex = index;
        randomQueue = [];
        notifyImageChange();
        persistState();
        restartKeepAlive();
        forceNow();
    };

    const addFiles = async (files: File[]) => {
        const target = getActiveProfile();
        const room = MAX_IMAGES_PER_PROFILE - target.dataUris.length;
        if (room <= 0) {
            setError(`Limit of ${MAX_IMAGES_PER_PROFILE} images reached`);
            return;
        }
        setBusy(true);
        setError("");
        const fresh: string[] = [];
        let failed = false;
        try {
            for (const file of files) {
                if (fresh.length >= room) break;
                if (!file.type.startsWith("image/") || file.type === "image/gif" || file.size > 8 * 1024 * 1024) continue;
                fresh.push(await processImage(file));
            }
        } catch {
            failed = true;
            setError("File processing error");
        }
        const added = fresh.length;
        if (added > 0) {
            if (await addImagesToProfile(target, fresh)) forceNow();
            else {
                failed = true;
                setError("Could not save the images");
            }
        }
        if (!failed && added < files.length) setError(`Added ${added} of ${files.length} (images only, max 8 MB, ${MAX_IMAGES_PER_PROFILE} per profile)`);
        setBusy(false);
    };

    const pickFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(e.target.files ?? []);
        e.target.value = "";
        if (files.length > 0) void addFiles(files);
    };

    const submitName = async () => {
        const name = nameValue.trim();
        if (name.length > 40) {
            setError("Profile name too long (max 40 characters)");
            return;
        }
        if (name) {
            if (naming === "new") {
                const created = createProfile(name);
                if (!created) setError(`Maximum ${MAX_PROFILES} profiles allowed`);
                else {
                    await saveProfilesToDataStore();
                    await switchTo(created.id);
                }
            } else {
                renameProfile(profile.id, name);
                await saveProfilesToDataStore();
            }
        }
        setNaming(null);
        setNameValue("");
    };

    const removeImage = async (index: number) => {
        await deleteImageAtIndex(index);
        const p = getActiveProfile();
        persistState();
        if (p.dataUris.length > 0) forceNow();
    };

    const exportBackup = async () => {
        try {
            const data = await buildBackup();
            const url = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: "application/json" }));
            const a = document.createElement("a");
            a.href = url;
            a.download = `customstream-backup-${Date.now()}.json`;
            a.click();
            setTimeout(() => URL.revokeObjectURL(url), 10000);
        } catch {
            setError("Could not read every image for the backup");
        }
    };

    const importBackup = async (file: File) => {
        try {
            const data: StoredProfilesData = JSON.parse(await file.text());
            if (!data.profiles || !Array.isArray(data.profiles)) {
                setError("Invalid backup file");
                return;
            }
            confirm("Import backup?", `This replaces ALL current profiles with ${data.profiles.length} profile(s) from the file.`, "Import", async () => {
                if (await applyBackup(data)) forceNow();
                else setError("Import failed, nothing was changed");
            });
        } catch {
            setError("Failed to read backup file");
        }
    };

    const resetAll = () => {
        void resetLibrary();
    };

    return (
        <ModalRoot {...rootProps} size={ModalSize.LARGE}>
            <ModalHeader>
                <Text size="xl" weight="semibold" style={{ flexGrow: 1 }}>Stream Preview</Text>
                <ModalCloseButton onClick={rootProps.onClose} />
            </ModalHeader>
            <ModalContent>
                <div
                    style={{ display: "flex", flexDirection: "column", gap: 8, padding: "8px 4px 0", borderRadius: 8, outline: fileOver ? `2px dashed ${C.blue}` : "2px solid transparent" }}
                    onDragOver={e => {
                        if (dragFrom === null && e.dataTransfer.types.includes("Files")) {
                            e.preventDefault();
                            setFileOver(true);
                        }
                    }}
                    onDragLeave={e => {
                        if (!e.currentTarget.contains(e.relatedTarget as Node)) setFileOver(false);
                    }}
                    onDrop={e => {
                        if (e.dataTransfer.files.length > 0) {
                            e.preventDefault();
                            setFileOver(false);
                            void addFiles(Array.from(e.dataTransfer.files));
                        }
                    }}
                >
                    <LiveCard replaceOn={s.replaceEnabled} />

                    <div style={row}>
                        <Chip on={s.replaceEnabled} title="Sends your own image as the stream preview instead of your screen" label={s.replaceEnabled ? "Replace: ON" : "Replace: OFF"} onClick={() => { settings.store.replaceEnabled = !s.replaceEnabled; if (!s.replaceEnabled) forceNow(); }} />
                        <Chip on={s.bypassPreviewToggle} title="Also sends your image when 'Show stream previews' is OFF in Discord" label={s.bypassPreviewToggle ? "Bypass: ON" : "Bypass: OFF"} onClick={() => { settings.store.bypassPreviewToggle = !s.bypassPreviewToggle; }} />
                        <Chip on={s.slideshowEnabled} title="Changes the image automatically" label={s.slideshowEnabled ? "Slideshow: ON" : "Slideshow: OFF"} onClick={() => { settings.store.slideshowEnabled = !s.slideshowEnabled; randomQueue = []; restartKeepAlive(); }} />
                        <Chip on={s.slideshowEnabled && s.slideshowRandom && randomOk} disabled={!s.slideshowEnabled || !randomOk} title={randomOk ? "Random order" : "Random needs 3+ images"} label={s.slideshowRandom && randomOk ? "Random: ON" : "Random: OFF"} onClick={() => { settings.store.slideshowRandom = !s.slideshowRandom; randomQueue = []; }} />
                    </div>
                    {s.slideshowEnabled && (
                        <IntervalEditor seconds={profileSec} custom={profile.intervalSec > 0} profileName={profile.name} />
                    )}

                    <div style={{ padding: 8, borderRadius: 6, background: "var(--background-secondary)" }}>
                        <div style={{ ...row, marginBottom: naming ? 6 : 0 }}>
                            <Text size="sm" weight="semibold" style={{ color: "var(--header-primary)" }}>Profiles {profileList.length}/{MAX_PROFILES}</Text>
                            {profileList.map(x => (
                                <Chip key={x.id} on={x.id === activeProfileId} label={`${x.name} - ${x.imageIds.length}`} onClick={() => switchTo(x.id)} />
                            ))}
                            {profileList.length < MAX_PROFILES && <Chip label="+ New" onClick={() => { setNaming("new"); setNameValue(""); }} />}
                            <Chip label="Rename" onClick={() => { setNaming("rename"); setNameValue(profile.name); }} />
                            {canDeleteProfile && <Chip on color={C.redDk} label="Delete profile" onClick={() => confirm(`Delete profile "${profile.name}"?`, "This cannot be undone.", "Delete", () => { void removeProfile(profile.id); })} />}
                        </div>
                        {naming && (
                            <div style={row}>
                                <input
                                    type="text"
                                    autoFocus
                                    maxLength={40}
                                    placeholder="Profile name"
                                    value={nameValue}
                                    onChange={e => setNameValue(e.target.value)}
                                    onKeyDown={e => {
                                        if (e.key === "Enter") void submitName();
                                        if (e.key === "Escape") setNaming(null);
                                    }}
                                    style={{ width: 200, padding: "5px 8px", borderRadius: 4, border: `1px solid ${C.mid}`, background: "var(--background-tertiary)", color: "var(--text-normal)", fontSize: 13, outline: "none" }}
                                />
                                <Chip on label="OK" onClick={() => void submitName()} />
                                <Chip label="Cancel" onClick={() => setNaming(null)} />
                            </div>
                        )}
                    </div>

                    {s.showInfoBadges && (
                        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6, padding: "6px 8px", borderRadius: 4, background: "var(--background-tertiary)", border: "1px solid var(--background-modifier-accent)" }}>
                            <span style={{ padding: "2px 8px", borderRadius: 3, background: "var(--background-secondary)", color: "var(--header-primary)", fontSize: 11, fontWeight: 600 }}>
                                {count}/{MAX_IMAGES_PER_PROFILE} Images
                            </span>
                            {count > 0 && (
                                <span style={{ padding: "2px 8px", borderRadius: 3, background: "var(--background-secondary)", color: "var(--text-normal)", fontSize: 11, fontWeight: 700 }}>
                                    #{selected + 1} Selected
                                </span>
                            )}
                            {count > 1 && s.slideshowEnabled && s.replaceEnabled && (
                                <span style={{ padding: "2px 8px", borderRadius: 3, background: "var(--background-secondary)", color: "var(--text-normal)", fontSize: 11, fontWeight: 600 }}>
                                    Slideshow every {formatEvery(profileSec)}
                                </span>
                            )}
                            {count > 0 && (
                                <span style={{ padding: "2px 8px", borderRadius: 3, background: "var(--background-secondary)", color: "var(--text-normal)", fontSize: 11, fontWeight: 600 }}>
                                    Profile Size {formatFileSize(totalBytes)}
                                </span>
                            )}
                        </div>
                    )}

                    <div style={row}>
                        <Chip on label={busy ? "Working..." : "Add Image"} disabled={busy || count >= MAX_IMAGES_PER_PROFILE} onClick={() => singleInput.current?.click()} />
                        <Chip on label="Add Multiple" disabled={busy || count >= MAX_IMAGES_PER_PROFILE} onClick={() => multiInput.current?.click()} />
                        <Chip on color={C.redDk} label="Delete All" disabled={count === 0} onClick={() => confirm(`Delete all images from "${profile.name}"?`, `All ${count} images will be removed.`, "Delete all", () => { void deleteAllImages(); randomQueue = []; lastForcedImage = null; persistState(); })} />
                        <Chip label="Export" title="Save all profiles and timers to a file" onClick={exportBackup} />
                        <Chip label="Import" title="Replace everything with a backup file" onClick={() => backupInput.current?.click()} />
                        <Chip on color={C.redDk} label="Reset All" onClick={() => confirm("Reset all data?", "This permanently deletes ALL profiles and images.", "Reset", resetAll)} />
                        {legacyPresent && storageReady && <Chip label="🧹 Free Old Backup" title="Your images were copied to the new storage. This deletes the old copy" onClick={() => confirm("Delete the old backup?", "Your images are already in the new storage. This removes the old duplicate copy to free disk space.", "Delete old copy", () => { void cleanupLegacy(); })} />}
                    </div>

                    {!storageReady && (
                        <div style={{ padding: "5px 10px", borderRadius: 4, background: C.amber, color: "#000", fontSize: 12, fontWeight: 700 }}>Storage unavailable: changes will not be saved</div>
                    )}

                    {error && (
                        <div style={{ padding: "5px 10px", borderRadius: 4, background: C.redDk, color: "#fff", fontSize: 12, fontWeight: 600 }}>{error}</div>
                    )}

                    {count > 0 ? (
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 6, maxHeight: 340, overflowY: "auto", padding: 6, borderRadius: 6 }}>
                            {images.map((src, i) => {
                                const isCurrent = i === selected;
                                const isNext = i === nextIndex;
                                const isLive = isStreamActive && s.replaceEnabled && src === actualStreamImageUri;
                                return (
                                    <div
                                        key={i}
                                        draggable
                                        onClick={() => selectImage(i)}
                                        onDragStart={e => {
                                            setDragFrom(i);
                                            e.dataTransfer.effectAllowed = "move";
                                            e.dataTransfer.setData("text/plain", String(i));
                                        }}
                                        onDragOver={e => {
                                            if (dragFrom !== null) {
                                                e.preventDefault();
                                                if (dropOn !== i) setDropOn(i);
                                            }
                                        }}
                                        onDrop={e => {
                                            if (dragFrom !== null) {
                                                e.preventDefault();
                                                e.stopPropagation();
                                                if (dragFrom !== i) {
                                                    void moveImage(dragFrom, i);
                                                    persistState();
                                                }
                                            }
                                            setDragFrom(null);
                                            setDropOn(null);
                                        }}
                                        onDragEnd={() => { setDragFrom(null); setDropOn(null); }}
                                        style={{
                                            position: "relative",
                                            aspectRatio: "16 / 9",
                                            borderRadius: 6,
                                            overflow: "hidden",
                                            cursor: "pointer",
                                            background: "#000",
                                            opacity: dragFrom === i ? 0.4 : 1,
                                            contentVisibility: "auto",
                                            containIntrinsicSize: "auto 85px"
                                        }}
                                    >
                                        <img src={src} alt="" draggable={false} loading="lazy" decoding="async" style={{ display: "block", width: "100%", height: "100%", objectFit: "cover" }} />
                                        {(isCurrent || isNext || dropOn === i) && (
                                            <div style={{ position: "absolute", inset: 0, boxSizing: "border-box", borderRadius: 6, pointerEvents: "none", border: `3px ${dropOn === i ? "dashed" : "solid"} ${dropOn === i ? C.amber : isCurrent ? frame : "#949ba4"}` }} />
                                        )}
                                        {isCurrent && pendingSend && !isLive && (
                                            <div style={{ position: "absolute", bottom: 4, left: 4, padding: "2px 6px", borderRadius: 4, background: C.amber, color: "#000", fontSize: 11, fontWeight: 700 }}>⏳ pending</div>
                                        )}
                                        {isLive && (
                                            <div style={{ position: "absolute", bottom: 4, left: 4, padding: "2px 6px", borderRadius: 4, background: C.red, color: "#fff", fontSize: 11, fontWeight: 700 }}>● LIVE</div>
                                        )}
                                        <div style={{ position: "absolute", top: 4, left: 4, padding: "2px 6px", borderRadius: 4, background: isCurrent ? frame : isNext ? C.on : C.dark, color: "#fff", fontSize: 11, fontWeight: 700 }}>
                                            {isCurrent ? "▶ " : isNext ? "→ " : ""}#{i + 1}
                                        </div>
                                        <div style={{ position: "absolute", top: 4, right: 4, display: "flex", gap: 4 }}>
                                            <div title="View" onClick={e => { e.stopPropagation(); setZoom(src); }} style={tileBtn}>🔍</div>
                                            <div title="Download" onClick={e => { e.stopPropagation(); const a = document.createElement("a"); a.href = src; a.download = `stream-preview-${i + 1}.jpg`; a.click(); }} style={tileBtn}>⬇</div>
                                            <div title="Delete" onClick={e => { e.stopPropagation(); void removeImage(i); }} style={tileBtn}>✕</div>
                                        </div>
                                        <div style={{ position: "absolute", bottom: 4, right: 4, padding: "2px 6px", borderRadius: 4, background: C.dark, color: "#fff", fontSize: 11, fontWeight: 600 }}>
                                            📦 {formatFileSize(estimateSizeFromDataUri(src))}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    ) : (
                        <div
                            onClick={() => singleInput.current?.click()}
                            style={{ padding: "28px 16px", borderRadius: 8, border: "2px dashed var(--background-modifier-accent)", textAlign: "center", cursor: "pointer", color: "var(--text-muted)", fontSize: 14 }}
                        >
                            No images - drop them here or click to add
                        </div>
                    )}

                    <input ref={singleInput} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={pickFiles} />
                    <input ref={multiInput} type="file" accept="image/png,image/jpeg,image/webp" multiple hidden onChange={pickFiles} />
                    <input
                        ref={backupInput}
                        type="file"
                        accept=".json"
                        hidden
                        onChange={e => {
                            const file = e.target.files?.[0];
                            e.target.value = "";
                            if (file) void importBackup(file);
                        }}
                    />
                    <div style={{ position: "sticky", bottom: 0, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "8px 0 4px", background: "var(--modal-background, var(--background-primary))" }}>
                        <Text size="xs" weight="normal" style={{ color: "var(--text-muted)" }}>
                            Click = Send Now | Drag = Reorder | Saved Locally
                        </Text>
                        <button type="button" onClick={rootProps.onClose} style={closeBtn}>Close</button>
                    </div>
                </div>
            </ModalContent>

            {zoom && (
                <div onClick={() => setZoom(null)} style={{ position: "fixed", inset: 0, zIndex: 10000, display: "grid", placeItems: "center", background: "#000", cursor: "zoom-out", padding: 40 }}>
                    <img src={zoom} alt="" style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain", borderRadius: 8 }} />
                    <div style={{ position: "absolute", bottom: 20, left: "50%", transform: "translateX(-50%)", padding: "8px 16px", borderRadius: 8, background: C.dark, color: "#fff", fontSize: 13 }}>
                        1280×720 (16:9) - click to close
                    </div>
                </div>
            )}
        </ModalRoot>
    );
}

function openImagePicker() {
    openModal((props: any) => <ImagePickerModal rootProps={props} />);
}

function StreamPreviewIcon({ imageCount, isEnabled, isSlideshowEnabled, isRandom, currentImageUri, streamActive }: {
    imageCount: number;
    isEnabled: boolean;
    isSlideshowEnabled: boolean;
    isRandom: boolean;
    currentImageUri: string | null;
    streamActive: boolean;
}) {
    return (
        <div style={{ position: "relative" }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                <path fill="currentColor" d="M21 3H3C1.9 3 1 3.9 1 5V17C1 18.1 1.9 19 3 19H8V21H16V19H21C22.1 19 23 18.1 23 17V5C23 3.9 22.1 3 21 3ZM21 17H3V5H21V17Z" />
                <path fill={isEnabled ? "var(--status-positive)" : "currentColor"} d="M12 7C10.34 7 9 8.34 9 10C9 11.66 10.34 13 12 13C13.66 13 15 11.66 15 10C15 8.34 13.66 7 12 7Z" />
                <path fill={isEnabled ? "var(--status-positive)" : "currentColor"} d="M18 14L15 11L12 14L9 11L6 14V15H18V14Z" />
            </svg>
            {imageCount > 1 && isSlideshowEnabled && isEnabled && (
                <div style={{ position: "absolute", top: "-4px", right: "-6px", backgroundColor: "var(--status-positive)", color: "white", fontSize: "9px", fontWeight: "bold", borderRadius: "6px", minWidth: "12px", height: "12px", display: "flex", alignItems: "center", justifyContent: "center", padding: "0 3px" }}>
                    {imageCount}
                </div>
            )}
            {imageCount > 1 && isSlideshowEnabled && isRandom && isEnabled && (
                <div style={{ position: "absolute", bottom: "-4px", right: "-6px", fontSize: "10px", lineHeight: "1" }}>🎲</div>
            )}
        </div>
    );
}

function formatTime(seconds: number): string {
    if (seconds < 60) return `${seconds} sec`;
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    if (secs === 0) return `${mins} min`;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
}

function formatFileSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function StreamPreviewPanelButton(props: { nameplate?: any; }) {
    const showPanel = settings.use(["showPanelButton"]).showPanelButton;
    const [imageCount, setImageCount] = useState(0);
    const [isEnabled, setIsEnabled] = useState(settings.store.replaceEnabled);
    const [isSlideshowEnabled, setIsSlideshowEnabled] = useState(settings.store.slideshowEnabled);
    const [isRandom, setIsRandom] = useState(settings.store.slideshowRandom);
    const [currentIndex, setCurrentIndex] = useState(currentSlideIndex);
    const [secondsAgo, setSecondsAgo] = useState(() => lastSlideChangeTime > 0 ? Math.floor((Date.now() - lastSlideChangeTime) / 1000) : 0);
    const [streamActive, setStreamActive] = useState(isStreamActive);
    const [currentImageUri, setCurrentImageUri] = useState<string | null>(null);

    useEffect(() => {
        if (!showPanel) return;
        const updateState = () => {
            setImageCount(getImageCount());
            setIsEnabled(settings.store.replaceEnabled);
            setIsSlideshowEnabled(settings.store.slideshowEnabled);
            setIsRandom(settings.store.slideshowRandom && getImageCount() > 2);
            setCurrentIndex(currentSlideIndex);
            setStreamActive(isStreamActive);
            setCurrentImageUri(actualStreamImageUri);
            setSecondsAgo(lastSlideChangeTime > 0 ? Math.floor((Date.now() - lastSlideChangeTime) / 1000) : 0);
        };

        updateState();
        imageChangeListeners.add(updateState);

        return () => {
            imageChangeListeners.delete(updateState);
        };
    }, [showPanel]);

    if (!showPanel) return null;

    const getTooltip = () => {
        if (imageCount === 0) return "Select Stream Preview";
        if (!isEnabled) return `Stream preview (disabled, ${imageCount} images)`;
        const timeInfo = lastSlideChangeTime > 0 && streamActive ? `\n⏱️ sent ${formatTime(secondsAgo)} ago` : streamActive ? "" : "\n⚫ Stream not active";
        if (imageCount === 1) return `Stream preview (1 image)${timeInfo}`;
        if (isSlideshowEnabled) {
            const slideInfo = `\n📍 Current: #${currentIndex + 1}`;
            if (isRandom) return `Stream preview (${imageCount} images, random)${slideInfo}${timeInfo}`;
            return `Stream preview (${imageCount} images, slideshow)${slideInfo}${timeInfo}`;
        }
        return `Stream preview (${imageCount} images)${timeInfo}`;
    };

    const renderTooltip = () => {
        const tooltipText = getTooltip();
        if (currentImageUri && isEnabled && imageCount > 0 && streamActive) {
            return (
                <div style={{ display: "flex", flexDirection: "column", gap: "8px", alignItems: "center" }}>
                    <div style={{ width: "160px", height: "90px", borderRadius: "4px", overflow: "hidden", border: "2px solid var(--status-positive)", boxShadow: "0 0 8px rgba(59, 165, 92, 0.5)" }}>
                        <img src={currentImageUri} alt="Preview" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                    </div>
                    <div style={{ whiteSpace: "pre-line", textAlign: "center", fontSize: "12px", lineHeight: "1.4" }}>{tooltipText}</div>
                </div>
            );
        }
        return tooltipText;
    };

    return (
        <PanelButton
            tooltipText={renderTooltip()}
            icon={() => <StreamPreviewIcon
                imageCount={imageCount}
                isEnabled={isEnabled}
                isSlideshowEnabled={isSlideshowEnabled}
                isRandom={isRandom}
                currentImageUri={currentImageUri}
                streamActive={streamActive}
            />}
            onClick={openImagePicker}
            plated={props?.nameplate != null}
        />
    );
}

interface StreamContextProps {
    stream: {
        ownerId: string;
        guildId: string | null;
        channelId: string;
    };
}

const streamContextMenuPatch: NavContextMenuPatchCallback = (children: any[], { stream }: StreamContextProps) => {
    const currentUser = UserStore.getCurrentUser();
    if (!currentUser || stream.ownerId !== currentUser.id) return;
    const group = findGroupChildrenByChildId(["fullscreen", "popout"], children);
    if (group) {
        group.push(<Menu.MenuItem id="custom-stream-preview" label="Custom Stream Preview" icon={ImageIcon} action={openImagePicker} />);
    } else {
        children.push(<Menu.MenuSeparator />, <Menu.MenuItem id="custom-stream-preview" label="Custom Stream Preview" icon={ImageIcon} action={openImagePicker} />);
    }
};

function advanceSlide() {
    if (cachedDataUris.length <= 1) return;
    currentSlideIndex = isRandomActive()
        ? getRandomNext()
        : (currentSlideIndex + 1) % cachedDataUris.length;
    getActiveProfile().currentIndex = currentSlideIndex;
    notifyImageChange();
    persistState();
}

async function getRetryAfterMs(res: Response): Promise<number> {
    let sec = Number(res.headers.get("retry-after"));
    if (!(sec > 0)) {
        try {
            sec = Number((await res.json())?.retry_after);
        } catch {
            sec = 0;
        }
    }
    return Math.min(Math.max(sec > 0 ? sec : 5, 1), 330) * 1000 + 250;
}

async function readError(res: Response): Promise<string> {
    try {
        const j = await res.json();
        const detail = j?.errors ? JSON.stringify(j.errors) : "";
        return `${j?.message ?? ""}${j?.code ? ` [${j.code}]` : ""} ${detail}`.trim().slice(0, 160);
    } catch {
        return "";
    }
}

const RETRY_STEPS = [2000, 8000, 30000];
const KEEPALIVE_MAX_MS = 300000;
const MIN_INTERVAL_SEC = 5;
const MAX_INTERVAL_SEC = 86400;

function scheduleForceRetry(ms: number) {
    if (forceRetryTimer) return;
    forceRetryTimer = setTimeout(() => {
        forceRetryTimer = null;
        forceUploadPreview();
    }, Math.max(500, ms));
}

function nextRetryDelay(): number {
    return RETRY_STEPS[Math.min(forceRetries++, RETRY_STEPS.length - 1)];
}

function spammerActive(): boolean {
    try {
        const g = window as any;
        return (g.Vencord ?? g.Equicord)?.Plugins?.plugins?.ScreenshareSpammer?.isSpamming === true;
    } catch {
        return false;
    }
}

function isStreamingHere(): boolean {
    if (!isStreamActive || spammerActive()) return false;
    if (nativeSeen) return true;
    const voiceChannelId = SelectedChannelStoreMod?.getVoiceChannelId?.();
    if (!voiceChannelId) return false;
    const parts = capturedStreamKey?.split(":");
    const keyChannel = parts && parts.length >= 3 ? parts[parts.length - 2] : null;
    return !keyChannel || keyChannel === voiceChannelId;
}

function restartKeepAlive() {
    if (instantTimer) {
        clearTimeout(instantTimer);
        instantTimer = null;
    }
    lastAdvanceAt = Date.now();
    if (isStreamingHere()) scheduleKeepAlive();
}

function formatEvery(sec: number): string {
    if (sec % 3600 === 0) return `${sec / 3600}h`;
    if (sec % 60 === 0) return `${sec / 60}m`;
    return `${sec}s`;
}

function forceNow() {
    forceRetries = 0;
    if (forceRetryTimer) {
        clearTimeout(forceRetryTimer);
        forceRetryTimer = null;
    }
    forceUploadPreview();
}

async function forceUploadPreview() {
    if (cachedDataUris.length === 0 || !settings.store.replaceEnabled) return;
    if (!isStreamingHere()) return;
    if (forceRetryTimer) return;
    if (forceBusy) {
        forcePending = true;
        return;
    }
    const image = cachedDataUris[currentSlideIndex] ?? cachedDataUris[0];
    const now = Date.now();
    if (now < blockedUntil) {
        scheduleForceRetry(blockedUntil - now);
        return;
    }
    const sameWindow = Math.max(20000, Math.min(240000, getIntervalSec() * 800));
    if (image === lastForcedImage && now - lastForcedAt < sameWindow) return;

    forceBusy = true;
    let ok = false;
    try {
        const token = TokenMod?.getToken?.();
        const superProps = SuperPropsMod?.getSuperPropertiesBase64?.();
        if (!token || !superProps) return;

        const locale = LocaleMod?.getLocale?.() ?? "en-US";
        const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
        let streamKeyEncoded: string;

        if (capturedStreamKey) {
            streamKeyEncoded = capturedStreamKey.split(":").join("%3A");
        } else {
            const channelId = SelectedChannelStoreMod?.getVoiceChannelId?.();
            if (!channelId) return;
            const channel = ChannelStoreMod?.getChannel?.(channelId);
            if (!channel) return;
            const channelTypeMap: Record<number, string> = { 1: "call", 2: "guild", 3: "call" };
            const channelType = channelTypeMap[channel.type];
            if (!channelType) return;
            const userId = UserStore.getCurrentUser()?.id;
            if (!userId) return;
            const guildId = channel.guild_id ?? channel.getGuildId?.() ?? "";
            streamKeyEncoded = channelType === "guild"
                ? `guild%3A${guildId}%3A${channelId}%3A${userId}`
                : `call%3A${channelId}%3A${userId}`;
        }

        const res = await fetch(`https://discord.com/api/v10/streams/${streamKeyEncoded}/preview`, {
            method: "POST",
            headers: {
                "Authorization": token,
                "Content-Type": "application/json",
                "X-Debug-Options": "bugReporterEnabled",
                "X-Discord-Locale": locale,
                "X-Discord-Timezone": timezone,
                "X-Super-Properties": superProps,
            },
            body: JSON.stringify({ thumbnail: image }),
        });

        lastStatus = res.status;
        if (res.ok) {
            ok = true;
            lastStatus = 0;
            lastError = "";
            forceRetries = 0;
            if (forceRetryTimer) {
                clearTimeout(forceRetryTimer);
                forceRetryTimer = null;
            }
            lastForcedAt = Date.now();
            lastForcedImage = image;
            lastSlideChangeTime = Date.now();
            isStreamActive = true;
            actualStreamImageUri = image;
            notifyImageChange();
        } else if (res.status === 429) {
            const delay = await getRetryAfterMs(res);
            blockedUntil = Date.now() + delay;
            scheduleForceRetry(delay);
            notifyImageChange();
        } else if (res.status === 400) {
            lastError = await readError(res);
            forceRetries = RETRY_STEPS.length;
            notifyImageChange();
        } else {
            lastError = await readError(res);
            if (forceRetries < RETRY_STEPS.length) scheduleForceRetry(nextRetryDelay());
            notifyImageChange();
        }
    } catch {
        if (forceRetries < RETRY_STEPS.length) scheduleForceRetry(nextRetryDelay());
        notifyImageChange();
    } finally {
        forceBusy = false;
        if (forcePending) {
            forcePending = false;
            if (ok) forceUploadPreview();
        }
    }
}

function getIntervalSec(p: Profile = getActiveProfile()): number {
    return p.intervalSec > 0 ? p.intervalSec : (settings.store.instantSlideshowInterval || 300);
}

function getIntervalMs(): number {
    return Math.max(1000, getIntervalSec() * 1000);
}

function rescheduleKeepAlive() {
    if (!instantTimer) return;
    clearTimeout(instantTimer);
    instantTimer = null;
    if (isStreamingHere()) scheduleKeepAlive();
}

function scheduleKeepAlive() {
    if (instantTimer) return;
    const intervalMs = getIntervalMs();
    if (lastAdvanceAt === 0) lastAdvanceAt = Date.now();
    const untilSlide = settings.store.slideshowEnabled ? Math.max(500, lastAdvanceAt + intervalMs - Date.now()) : intervalMs;
    instantTimer = setTimeout(() => {
        instantTimer = null;
        if (!isStreamActive || spammerActive()) return;
        if (isStreamingHere() && cachedDataUris.length > 0) {
            let changed = false;
            if (settings.store.slideshowEnabled && cachedDataUris.length > 1 && Date.now() >= lastAdvanceAt + getIntervalMs() - 250) {
                advanceSlide();
                lastAdvanceAt = Date.now();
                changed = true;
            }
            if (changed) forceNow();
            else if (settings.store.bypassPreviewToggle) forceUploadPreview();
        }
        scheduleKeepAlive();
    }, Math.min(untilSlide, KEEPALIVE_MAX_MS));
}

function resetForceState() {
    lastAdvanceAt = 0;
    nativeSeen = false;
    lastStatus = 0;
    lastError = "";
    if (instantTimer) { clearTimeout(instantTimer); instantTimer = null; }
    if (forceRetryTimer) { clearTimeout(forceRetryTimer); forceRetryTimer = null; }
    forceRetries = 0;
    forcePending = false;
    blockedUntil = 0;
    lastForcedImage = null;
}

function isBypassEnabled(): boolean {
    return settings.store.bypassPreviewToggle && isStreamingHere();
}

function getCustomThumbnail(originalThumbnail: string): string {
    if (spammerActive()) return originalThumbnail;
    isStreamActive = true;
    nativeSeen = true;
    scheduleKeepAlive();
    if (!settings.store.replaceEnabled || cachedDataUris.length === 0) {
        actualStreamImageUri = null;
        notifyImageChange();
        return originalThumbnail;
    }
    const image = cachedDataUris[Math.min(currentSlideIndex, cachedDataUris.length - 1)];
    actualStreamImageUri = image;
    lastForcedImage = image;
    lastForcedAt = Date.now();
    lastSlideChangeTime = lastForcedAt;
    lastStatus = 0;
    lastError = "";
    forceRetries = 0;
    if (forceRetryTimer) {
        clearTimeout(forceRetryTimer);
        forceRetryTimer = null;
    }
    notifyImageChange();
    return image;
}

const manageStreamsContextPatch: NavContextMenuPatchCallback = (children: any[]) => {
    const group = findGroupChildrenByChildId(["manage-streams-stop-streaming", "manage-streams-change-windows"], children);
    const item = <Menu.MenuItem id="custom-stream-preview-manage" label="Custom Stream Preview" icon={ImageIcon} action={openImagePicker} />;
    if (group) group.push(item);
    else children.push(<Menu.MenuSeparator />, item);
};

const streamOptionsContextPatch: NavContextMenuPatchCallback = (children: any[]) => {
    children.push(<Menu.MenuSeparator />, <Menu.MenuItem id="custom-stream-preview-options" label="Custom Stream Preview" icon={ImageIcon} action={openImagePicker} />);
};

export default definePlugin({
    name: "CustomStreamTopQ",
    description: "Custom stream preview images with profiles & slideshow. Reworked from this GitHub: https://github.com/MrTopQ/customStream-Vencord",
    authors: [{ name: "TopQ", id: 523800559791374356n }, { name: "zfrancesck1", id: 456195985404592149n }],
    tags: ["Voice", "Media"],
    enabledByDefault: false,

    settings,

    patches: [
        {
            find: "#{intl::USER_PROFILE_ACCOUNT_POPOUT_BUTTON_A11Y_LABEL}",
            replacement: {
                match: /(children:\[)(.{0,150}?)(accountContainerRef)/,
                replace: "$1$self.StreamPreviewPanelButton(arguments[0]),$2$3"
            }
        },
        {
            find: "\"ApplicationStreamPreviewUploadManager\"",
            all: true,
            replacement: [
                {
                    match: /body:\{thumbnail:(\i)\}/,
                    replace: "body:{thumbnail:$self.getCustomThumbnail($1)}"
                },
                {
                    match: /\{thumbnail:(\i)\}/,
                    replace: "{thumbnail:$self.getCustomThumbnail($1)}"
                }
            ]
        },
        {
            find: "showStreamPreview",
            replacement: {
                match: /showStreamPreview:(\i\.\i===\i)/,
                replace: "showStreamPreview:$1||$self.isBypassEnabled()"
            }
        }
    ],

    toolboxActions: {
        "Select Stream Preview": openImagePicker
    },

    StreamPreviewPanelButton: ErrorBoundary.wrap(StreamPreviewPanelButton, { noop: true }),
    getCustomThumbnail,
    isBypassEnabled,

    contextMenus: {
        "stream-context": streamContextMenuPatch,
        "manage-streams": manageStreamsContextPatch,
        "stream-options": streamOptionsContextPatch
    },

    async start() {
        await loadLibrary();
        syncCacheWithActiveProfile();
        notifyImageChange();

        const myId = () => UserStore.getCurrentUser()?.id;

        const onStreamCreate = (e: any) => {
            if (spammerActive()) return;
            const key: string = e?.streamKey ?? "";
            if (key.split(":").pop() !== myId()) return;
            capturedStreamKey = key;
            isStreamActive = true;
            lastForcedImage = null;
            blockedUntil = 0;
            notifyImageChange();
            if (isStreamingHere()) scheduleKeepAlive();
            forceNow();
        };

        const onStreamUpdate = (e: any) => {
            if (spammerActive()) return;
            const key: string = e?.streamKey ?? "";
            if (key.split(":").pop() !== myId()) return;
            capturedStreamKey = key;
            isStreamActive = true;
            notifyImageChange();
            if (isStreamingHere()) scheduleKeepAlive();
            forceUploadPreview();
        };

        const onStreamDelete = (e: any) => {
            const key: string = e?.streamKey ?? "";
            if (key.split(":").pop() !== myId()) return;
            isStreamActive = false;
            capturedStreamKey = null;
            actualStreamImageUri = null;
            resetForceState();
            notifyImageChange();
        };

        const onStreamVideo = (e: any) => {
            if (spammerActive()) return;
            if (e?.context !== "stream" || e?.streamId == null || e?.userId !== myId()) return;
            if (!capturedStreamKey) {
                capturedStreamKey = e.guildId ? `guild:${e.guildId}:${e.channelId}:${e.userId}` : `call:${e.channelId}:${e.userId}`;
            }
            isStreamActive = true;
            notifyImageChange();
            if (isStreamingHere()) scheduleKeepAlive();
            forceUploadPreview();
        };

        FluxDispatcher.subscribe("RTC_CONNECTION_VIDEO", onStreamVideo);
        FluxDispatcher.subscribe("STREAM_CREATE", onStreamCreate);
        FluxDispatcher.subscribe("STREAM_START_NOTIFY_SHOULD_SHOW", onStreamCreate);
        FluxDispatcher.subscribe("STREAM_UPDATE", onStreamUpdate);
        FluxDispatcher.subscribe("STREAM_DELETE", onStreamDelete);
        FluxDispatcher.subscribe("STREAM_STOP", onStreamDelete);
        (this as any)._fluxHandlers = { onStreamCreate, onStreamUpdate, onStreamDelete, onStreamVideo };
    },

    stop() {
        resetForceState();
        if (metaTimer) { clearTimeout(metaTimer); metaTimer = null; void writeMeta(); }
        const h = (this as any)._fluxHandlers;
        if (h) {
            FluxDispatcher.unsubscribe("RTC_CONNECTION_VIDEO", h.onStreamVideo);
            FluxDispatcher.unsubscribe("STREAM_CREATE", h.onStreamCreate);
            FluxDispatcher.unsubscribe("STREAM_START_NOTIFY_SHOULD_SHOW", h.onStreamCreate);
            FluxDispatcher.unsubscribe("STREAM_UPDATE", h.onStreamUpdate);
            FluxDispatcher.unsubscribe("STREAM_DELETE", h.onStreamDelete);
            FluxDispatcher.unsubscribe("STREAM_STOP", h.onStreamDelete);
        }
        cachedDataUris = [];
        currentSlideIndex = 0;
        isStreamActive = false;
        lastSlideChangeTime = 0;
        capturedStreamKey = null;
        randomQueue = [];
        profiles.clear();
        activeProfileId = DEFAULT_PROFILE_ID;
        storageReady = false;
        loadedOrder = [];
    }
});