/*
 * TrashCord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// UserRadar  k1ng_op
// tracks msgs, edits, deletes, typing, profile/pfp, voice, status, activity, joins

import { addContextMenuPatch, NavContextMenuPatchCallback, removeContextMenuPatch } from "@api/ContextMenu"
import { DataStore, Notifications } from "@api/index"
import { definePluginSettings } from "@api/Settings"
import { getCurrentChannel, openUserProfile } from "@utils/discord"
import definePlugin, { OptionType } from "@utils/types"
import { findByProps } from "@webpack"
import { ChannelStore, Menu, MessageStore, Modal, openModal, React, RestAPI, showToast, UserStore } from "@webpack/common"
import type { JSX } from "react"

import {
    addUser, camelize, displayName, featureOn,
    getWatchedUser, getWatchlist, inQuietHours,
    isWatched, log, patchUser, removeUser
} from "./store"

import {
    GuildMemberEvent, MsgCreateEvent, MsgDeleteEvent, MsgUpdateEvent,
    PresenceEvent,
    TypingEvent, VoiceStateEvent, WatchedUser
} from "./types"

const STATUS_EMOJI_LOCAL: Record<string, string> = {
    online: "🟢",
    idle: "🌙",
    dnd: "🔴",
    offline: "⚫",
    invisible: "⚫",
}
const ACTIVITY_LOG_KEY = "UserRadar_ActivityLog_v2"
export type ActivityType =
    | "msg" | "edit" | "delete" | "typing"
    | "status" | "activity" | "voice"
    | "join" | "leave" | "boost"
    | "profile" | "avatar" | "banner" | "bio" | "username" | "displayname"
    | "pronouns" | "custom_status"
    | "online" | "offline" | "idle" | "dnd"
    | "game_start" | "game_stop" | "spotify" | "streaming"
    | "vc_join" | "vc_leave" | "vc_move"
    | "session"

export interface ActivityEntry {
    id: string
    uid: string
    ts: number
    type: ActivityType
    icon: string
    title: string
    body: string
    guildId?: string
    channelId?: string
    msgId?: string
    metadata?: Record<string, any>
}

function sessionKey(uid: string, type: string, channelId?: string): string {
    return channelId ? `${uid}_${type}_${channelId}` : `${uid}_${type}`
}

class ActivityStore {
    private cache: Record<string, ActivityEntry[]> = {}
    private loaded = false
    private loadPromise: Promise<void> | null = null

    async load() {
        if (this.loaded) return
        if (this.loadPromise) return this.loadPromise
        this.loadPromise = (async () => {
            try {
                const data = await DataStore.get(ACTIVITY_LOG_KEY)
                if (data) this.cache = JSON.parse(data)
            } catch (e) { console.error("[UserRadar] Failed to load activity log", e) }
            this.loaded = true
        })()
        return this.loadPromise
    }

    async save() {
        try {
            await DataStore.set(ACTIVITY_LOG_KEY, JSON.stringify(this.cache))
        } catch (e) { console.error("[UserRadar] Failed to save activity log", e) }
    }

    // batches rapid writes into one save
    private saveTimer: ReturnType<typeof setTimeout> | null = null
    private pendingSave: { resolve: () => void }[] = []
    private scheduleSave(): Promise<void> {
        return new Promise(resolve => {
            this.pendingSave.push({ resolve })
            if (this.saveTimer) return
            this.saveTimer = setTimeout(async () => {
                this.saveTimer = null
                const waiters = this.pendingSave
                this.pendingSave = []
                await this.save()
                waiters.forEach(w => w.resolve())
            }, 1500)
        })
    }
    // forces the pending debounced save through immediately
    async flushSave() {
        if (this.saveTimer) { clearTimeout(this.saveTimer); this.saveTimer = null }
        const waiters = this.pendingSave
        this.pendingSave = []
        await this.save()
        waiters.forEach(w => w.resolve())
    }

    getLogs(uid: string): ActivityEntry[] {
        return this.cache[uid] || []
    }

    // serializes writes so addLog/removeLog/updateLog never interleave
    private writeQueue: Promise<any> = Promise.resolve()
    private enqueue<T>(fn: () => Promise<T>): Promise<T> {
        const next = this.writeQueue.then(fn, fn)
        this.writeQueue = next.catch(() => {})
        return next
    }

    async addLog(entry: Omit<ActivityEntry, "id">) {
        return this.enqueue(async () => {
            await this.load()
            if (!this.cache[entry.uid]) this.cache[entry.uid] = []
            const fullEntry: ActivityEntry = {
                ...entry,
                id: `${entry.uid}_${entry.ts}_${Math.random().toString(36).slice(2, 8)}`,
            }
            this.cache[entry.uid].unshift(fullEntry)
            const rawMax = settings.store.maxLogsPerUser
            const max = rawMax < 0 ? 0 : Math.min(rawMax, 50000)
            if (max > 0 && this.cache[entry.uid].length > max)
                this.cache[entry.uid].length = max
            await this.scheduleSave()
            return fullEntry
        })
    }

    async clearLogs(uid: string) {
        return this.enqueue(async () => {
            await this.load()
            delete this.cache[uid]
            await this.save()
        })
    }

    async clearAll() {
        return this.enqueue(async () => {
            this.cache = {}
            await DataStore.del(ACTIVITY_LOG_KEY)
        })
    }

    exportAll(): string {
        return JSON.stringify(this.cache, null, 2)
    }

    async importAll(json: string) {
        return this.enqueue(async () => {
            try {
                const parsed = JSON.parse(json)
                // Validate it's a plain object whose values are arrays of entries
                if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return false
                for (const [uid, entries] of Object.entries(parsed)) {
                    if (typeof uid !== "string") return false
                    if (!Array.isArray(entries)) return false
                    for (const e of entries as any[]) {
                        if (typeof e !== "object" || e === null) return false
                        if (typeof e.id !== "string" || typeof e.uid !== "string" || typeof e.ts !== "number") return false
                    }
                }
                await this.load()
                // merge by id, don't replace whole cache  category export would wipe everything
                for (const [uid, entries] of Object.entries(parsed as Record<string, ActivityEntry[]>)) {
                    if (!this.cache[uid]) this.cache[uid] = []
                    const existingIds = new Set(this.cache[uid].map(e => e.id))
                    for (const e of entries) {
                        if (!existingIds.has(e.id)) this.cache[uid].push(e)
                    }
                    this.cache[uid].sort((a, b) => b.ts - a.ts)
                }
                await this.save()
                return true
            } catch { return false }
        })
    }

    async updateLog(uid: string, logId: string, updates: Partial<ActivityEntry>) {
        return this.enqueue(async () => {
            await this.load()
            const logs = this.cache[uid]
            if (!logs) return false
            const idx = logs.findIndex(l => l.id === logId)
            if (idx === -1) return false
            const updated = { ...logs[idx], ...updates, ts: Date.now() }
            logs.splice(idx, 1)
            logs.unshift(updated)
            await this.save()
            emitActivityUpdate(uid, updated)
            return true
        })
    }

    async removeLog(uid: string, logId: string) {
        return this.enqueue(async () => {
            await this.load()
            const logs = this.cache[uid]
            if (!logs) return false
            this.cache[uid] = logs.filter(l => l.id !== logId)
            await this.save()
            emitActivityRemove(uid, logId)
            return true
        })
    }

    // bulk delete  e.g. "remove all typing cards" / "remove all status cards" for a user
    async removeLogsWhere(uid: string, predicate: (log: ActivityEntry) => boolean): Promise<number> {
        return this.enqueue(async () => {
            await this.load()
            const logs = this.cache[uid]
            if (!logs) return 0
            const toRemove = logs.filter(predicate)
            if (toRemove.length === 0) return 0
            this.cache[uid] = logs.filter(l => !predicate(l))
            await this.save()
            toRemove.forEach(l => emitActivityRemove(uid, l.id))
            return toRemove.length
        })
    }
}

export const activityStore = new ActivityStore()

const activityListeners = new Set<(uid: string, entry: ActivityEntry) => void>()

export function onActivityUpdate(cb: (uid: string, entry: ActivityEntry) => void) {
    activityListeners.add(cb)
    return () => activityListeners.delete(cb)
}

function emitActivityUpdate(uid: string, entry: ActivityEntry) {
    activityListeners.forEach(cb => cb(uid, entry))
}

const activityRemoveListeners = new Set<(uid: string, logId: string) => void>()

export function onActivityRemove(cb: (uid: string, logId: string) => void) {
    activityRemoveListeners.add(cb)
    return () => activityRemoveListeners.delete(cb)
}

function emitActivityRemove(uid: string, logId: string) {
    activityRemoveListeners.forEach(cb => cb(uid, logId))
}

export async function logUserActivity(
    uid: string,
    type: ActivityType,
    icon: string,
    title: string,
    body: string,
    options?: {
        guildId?: string
        channelId?: string
        msgId?: string
        metadata?: Record<string, any>
    }
) {
    const entry = await activityStore.addLog({
        uid, ts: Date.now(), type, icon, title, body, ...options,
    })
    emitActivityUpdate(uid, entry)
    return entry
}

function logActivity(uid: string, type: string, icon: string, title: string, body?: string, guildId?: string, channelId?: string, msgId?: string) {
    logUserActivity(uid, type as ActivityType, icon, title, body ?? title, { guildId, channelId, msgId }).catch(() => {})
}

const profileCache:  Record<string, any>                          = {}
const vcCache:       Record<string, string | null>                = {}
const statusCache:   Record<string, string>                       = {}
const activityCache: Record<string, string[]>                     = {}
const guildCache:    Record<string, Set<string>>                  = {}
const vcJoinTime:    Record<string, number>                       = {}
const clientCache:   Record<string, string | null>                = {}
const cameraCache:   Record<string, boolean>                      = {}
const streamCache:   Record<string, boolean>                      = {}
const customStatusCache: Record<string, string | null>            = {}  // text status (activity type 4)
const statusSessionCache: Record<string, { startTime: number; startStatus: string; changes: { status: string; ts: number }[]; platforms: { platform: string; ts: number }[] } | null> = {}  // status session tracking

const activeSessions: Record<string, { logId: string; startTime: number; channelId?: string; guildId?: string; metadata?: any }> = {}

// pending "is typing" log per user+channel  MESSAGE_CREATE deletes it if they actually send.
// stays if they don't.
const pendingTypingLog: Record<string, { logId: string; ts: number }> = {}
const TYPING_LOG_TTL_MS = 3 * 60 * 1000

// persisted so a discord restart doesn't orphan whatever was mid-session
const ACTIVE_SESSIONS_KEY = "UserRadar_ActiveSessions_v1"

async function saveActiveSessions() {
    try { await DataStore.set(ACTIVE_SESSIONS_KEY, JSON.stringify(activeSessions)) }
    catch (e) { log.warn("[UserRadar] failed to save active sessions", e) }
}

async function loadActiveSessions(): Promise<Record<string, { logId: string; startTime: number; channelId?: string; guildId?: string; metadata?: any }>> {
    try {
        const data = await DataStore.get(ACTIVE_SESSIONS_KEY)
        return data ? JSON.parse(data) : {}
    } catch { return {} }
}

let _sessSaveTimer: ReturnType<typeof setTimeout> | null = null
function scheduleSessionSave() {
    if (_sessSaveTimer) return
    _sessSaveTimer = setTimeout(() => { _sessSaveTimer = null; saveActiveSessions() }, 1000)
}
let _sessSaveInterval: ReturnType<typeof setInterval> | null = null

const MAX_SESSION_AGE_MS = 24 * 60 * 60 * 1000  // 24h  a session stuck this long means the close event never arrived (client crash, force quit, etc)

async function sweepStaleSessions() {
    const now = Date.now()
    let touched = false
    for (const [sk, sess] of Object.entries(activeSessions)) {
        if (now - sess.startTime < MAX_SESSION_AGE_MS) continue
        delete activeSessions[sk]
        touched = true
        try {
            await activityStore.updateLog(sk.split("_")[0], sess.logId, {
                title: sess.metadata?.channel ? `Was in #${sess.metadata.channel}` : "Session ended",
                body: "session ended unexpectedly (no close event received)",
                metadata: { ...sess.metadata, duration: formatDuration(now - sess.startTime), startTime: sess.startTime, endTime: now },
            })
        } catch { }
    }
    if (touched) scheduleSessionSave()
}

let pluginStartedAt = 0

let pollTimer:  ReturnType<typeof setInterval> | null = null
let pluginActive = false

function tryLoadLoggedMsgs() {
    try {
        const plugin = (Vencord as any)?.Plugins?.plugins?.["vc-message-logger-enhanced"]
            ?? (Vencord as any)?.Plugins?.plugins?.["MessageLoggerEnhanced"]
            ?? (Vencord as any)?.Plugins?.plugins?.["messageLoggerEnhanced"]
        if (plugin?.loggedMessages) return plugin.loggedMessages
        if (plugin?.store?.loggedMessages) return plugin.store.loggedMessages
    } catch { }

    try {
        const { wreq } = (window as any).webpackChunkdiscord_app?.find?.(
            (x: any) => x?.[1]?.["loggedMessages"]
        )?.[1] ?? {}
        if (wreq?.["loggedMessages"]) return wreq["loggedMessages"]
    } catch { }

    return null
}

const settings = definePluginSettings({
    watchlist:          { type: OptionType.STRING,  hidden: true,  default: "[]",    description: "watchlist json  managed by the ui, don't touch" },
    globalPresetMode:   { type: OptionType.STRING,  hidden: true,  default: "custom",               description: "global preset mode" },
    installedSha:       { type: OptionType.STRING,  hidden: true,  default: "none",  description: "installed commit sha" },
    globalMsgs:         { type: OptionType.BOOLEAN, default: true,                   description: "messages" },
    globalEdits:        { type: OptionType.BOOLEAN, default: true,                   description: "edits" },
    globalDeletes:      { type: OptionType.BOOLEAN, default: true,                   description: "deletes (needs msg-logger-enhanced)" },
    globalTyping:       { type: OptionType.BOOLEAN, default: true,                   description: "typing" },
    globalProfile:      { type: OptionType.BOOLEAN, default: true,                   description: "profile changes" },
    globalAvatar:       { type: OptionType.BOOLEAN, default: true,                   description: "avatar changes" },
    globalVoice:        { type: OptionType.BOOLEAN, default: true,                   description: "voice" },
    globalStatus:       { type: OptionType.BOOLEAN, default: false,                  description: "status (spammy)" },
    globalActivity:     { type: OptionType.BOOLEAN, default: false,                  description: "activity changes (spammy)" },
    globalJoins:        { type: OptionType.BOOLEAN, default: true,                   description: "server joins/leaves" },
    showPreview:        { type: OptionType.BOOLEAN, default: true,                   description: "show message preview" },
    previewLen:         { type: OptionType.NUMBER,  default: 120,                  description: "preview length (0 = unlimited)" },
    quietHours:         { type: OptionType.BOOLEAN, default: false,                  description: "quiet hours" },
    quietStart:         { type: OptionType.STRING,  default: "23:00",                description: "quiet hours start (24h, e.g. 23:00)" },
    quietEnd:           { type: OptionType.STRING,  default: "07:00",                description: "quiet hours end (24h, e.g. 07:00)" },
    skipCurrentChannel: { type: OptionType.BOOLEAN, default: true,                   description: "skip if already in that channel" },
    maxLogsPerUser:     { type: OptionType.NUMBER,  default: 500,                    description: "max logs per user (0 = unlimited)" },
    pinnedUsers:        { type: OptionType.STRING,  hidden: true,  default: "[]",    description: "pinned watchlist user ids" },
    compactLogView:     { type: OptionType.BOOLEAN, default: false,                  description: "compact activity log cards" },
    autoCleanupLogs:    { type: OptionType.BOOLEAN, default: true,                   description: "delete logs when removing a user from watchlist" },
    debugLog:           { type: OptionType.BOOLEAN, default: false,                  description: "debug logging" },
    showToolbarIcon:    { type: OptionType.BOOLEAN, default: true,                   description: "toolbar icon" },
    logVcMembers:       { type: OptionType.BOOLEAN, default: false,                  description: "also log names of other people in the voice channel (privacy: logs non-watched users too)" },
})

function trunc(s: string, max: number) {
    return max > 0 && s.length > max ? s.slice(0, max) + "…" : s
}

function msgPreview(content: string, filename?: string) {
    if (!settings.store.showPreview) return "click to jump"
    return trunc(content || filename || "click to jump", settings.store.previewLen)
}

function jumpTo(guildId?: string, channelId?: string, msgId?: string) {
    if (guildId)   findByProps("transitionToGuildSync")?.transitionToGuildSync(guildId)
    if (channelId) findByProps("selectChannel")?.selectChannel({ guildId: guildId ?? "@me", channelId, messageId: msgId })
}

// wipes all per-user caches when someone is removed from the watchlist 
// otherwise re-adding compares against a stale baseline
function purgeUserCaches(uid: string) {
    delete profileCache[uid]
    delete vcCache[uid]
    delete statusCache[uid]
    delete activityCache[uid]
    delete guildCache[uid]
    delete vcJoinTime[uid]
    delete clientCache[uid]
    delete cameraCache[uid]
    delete streamCache[uid]
    delete customStatusCache[uid]
    delete statusSessionCache[uid]
    // sessionKey always prefixes with "uid_", safe to match on that
    for (const k of Object.keys(activeSessions)) {
        if (k === uid || k.startsWith(`${uid}_`)) delete activeSessions[k]
    }
    scheduleSessionSave()
    for (const k of Object.keys(_logDebounce)) {
        if (k.includes(uid)) delete _logDebounce[k]
    }
}

function getPinned(): string[] {
    try { return JSON.parse(settings.store.pinnedUsers || "[]") } catch { return [] }
}
function togglePin(uid: string) {
    const cur = getPinned()
    const next = cur.includes(uid) ? cur.filter(id => id !== uid) : [...cur, uid]
    settings.store.pinnedUsers = JSON.stringify(next)
}

function isFeatureOn(uid: string, userKey: keyof WatchedUser["overrides"], globalKey: string): boolean {
    if (!isWatched(settings, uid)) return false
    const mode = settings.store.globalPresetMode ?? "custom"
    if (mode !== "custom") {
        if (mode === "silent") return false
        if (mode === "stalker") return true
        if (mode === "lite") {
            const liteFeatures = ["msgs", "deletes", "typing", "avatar", "voice", "status"]
            return liteFeatures.includes(userKey as string)
        }
    }
    return featureOn(settings, uid, userKey, globalKey)
}

const _notifDebounce: Record<string, number> = {}
const _logDebounce: Record<string, number> = {}
const presenceDebounce = new Map<string, ReturnType<typeof setTimeout>>()

const STATUS_LABEL: Record<string, string> = { online: "Online", idle: "Away", dnd: "Do Not Disturb", offline: "Offline", invisible: "Invisible" }
const ACT_VERB: Record<number, string> = { 0: "playing", 2: "listening to", 3: "watching", 5: "competing in" }
const isOfflineStatus = (s: string) => s === "offline" || s === "invisible"

function notify(opts: { title: string; body: string; icon?: string; onClick?: () => void; _uid?: string }) {
    if (inQuietHours(settings)) return
    if (settings.store.globalPresetMode === "silent") return

    // title already has the name baked in, unique per user
    const key = `${opts._uid ?? opts.title}\x00${opts.title}\x00${opts.body}`
    const now = Date.now()
    if (_notifDebounce[key] && now - _notifDebounce[key] < 1500) return
    _notifDebounce[key] = now

    // sweep stale entries so this doesn't grow forever over a long session
    if (Object.keys(_notifDebounce).length > 500) {
        for (const k of Object.keys(_notifDebounce)) {
            if (now - _notifDebounce[k] > 60000) delete _notifDebounce[k]
        }
    }

    if (settings.store.debugLog) log.info(`[notif] ${opts.title}  ${opts.body}`)
    Notifications.showNotification({ title: opts.title, body: opts.body, icon: opts.icon, onClick: opts.onClick })
}

function avatarUrl(id: string, hash?: string | null, size = 80): string {
    try {
        if (hash) return `https://cdn.discordapp.com/avatars/${id}/${hash}.${hash.startsWith("a_") ? "gif" : "webp"}?size=${size}`
        let i = 0
        try { i = Number((BigInt(id) >> 22n) % 6n) } catch { i = parseInt(id.slice(-4), 10) % 6 || 0 }
        return `https://cdn.discordapp.com/embed/avatars/${i}.png`
    } catch { return "https://cdn.discordapp.com/embed/avatars/0.png" }
}

function guildName(guildId?: string | null): string | null {
    if (!guildId) return null
    return findByProps("getGuild")?.getGuild(guildId)?.name ?? null
}

const FALLBACK_AV = "https://cdn.discordapp.com/embed/avatars/0.png"

const PROFILE_TEXT = ["username", "globalName", "bio", "banner", "pronouns"] as const
const FIELD_NAME: Record<string, string> = {
    username: "username", globalName: "display name",
    bio: "about me", banner: "banner", pronouns: "pronouns",
}
const PROFILE_TYPE_MAP: Record<string, ActivityType> = {
    username: "username",
    globalName: "displayname",
    bio: "bio",
    banner: "banner",
    pronouns: "pronouns",
}
const PROFILE_ICON_MAP: Record<string, string> = {
    username: "🏷️",
    globalName: "📛",
    bio: "📝",
    banner: "🏳️",
    pronouns: "🪪",
}

function checkProfileChanged(uid: string, fresh: any) {
    if (!isWatched(settings, uid)) return
    const old = profileCache[uid]
    if (!old) {
        profileCache[uid] = fresh
        return
    }

    // avatar  separate feature flag
    const oldAvatar = old.user?.avatar ?? old.user?.avatarUrl ?? null
    const newAvatar = fresh.user?.avatar ?? fresh.user?.avatarUrl ?? null
    if (newAvatar !== oldAvatar) {
        if (isFeatureOn(uid, "avatar", "globalAvatar")) {
            const name  = displayName(fresh.user)
            const label = getWatchedUser(settings, uid)?.nick
            const dn    = label ? `${label} (${name})` : name
            const oldAvatarUrl = oldAvatar ? avatarUrl(uid, oldAvatar, 256) : null
            const newAvatarUrl = newAvatar ? avatarUrl(uid, newAvatar, 256) : null
            notify({
                _uid: uid,
                title: newAvatar ? `${dn} changed their avatar` : `${dn} removed their avatar`,
                body: newAvatar ? "click to see new pfp" : "reset to default",
                icon: newAvatarUrl ?? undefined,
                onClick: () => openUserProfile(uid),
            })
            logUserActivity(uid, "avatar", "🖼️",
                newAvatar ? `changed their avatar` : `removed their avatar`,
                "",
                { metadata: { oldAvatar: oldAvatarUrl, newAvatar: newAvatarUrl } }
            ).catch(() => {})
        }
    }

    // text profile fields  one log per changed field
    if (isFeatureOn(uid, "profile", "globalProfile")) {
        const u     = UserStore.getUser(uid)
        const name  = displayName(fresh.user)
        const label = getWatchedUser(settings, uid)?.nick
        const dn    = label ? `${label} (${name})` : name
        const icon  = u ? avatarUrl(u.id, (u as any).avatar) : undefined

        for (const f of PROFILE_TEXT) {
            // pronouns sits at root, not under user
            const rawOld = f === "pronouns"
                ? (old.pronouns ?? old.user?.pronouns ?? null)
                : (old.user?.[f] ?? null)
            const rawNew = f === "pronouns"
                ? (fresh.pronouns ?? fresh.user?.pronouns ?? null)
                : (fresh.user?.[f] ?? null)
            const oldVal = rawOld === "" ? null : rawOld
            const newVal = rawNew === "" ? null : rawNew
            if (oldVal === newVal) continue

            const fieldLabel = FIELD_NAME[f] ?? f
            const actType    = PROFILE_TYPE_MAP[f] ?? "profile"
            const actIcon    = PROFILE_ICON_MAP[f] ?? "👤"

            const notifyBody = newVal
                ? (oldVal ? `${oldVal} → ${newVal}` : newVal)
                : `removed ${fieldLabel}`

            notify({
                _uid: uid,
                title: `${dn} changed their ${fieldLabel}`,
                body: notifyBody,
                icon,
                onClick: () => openUserProfile(uid),
            })
            logUserActivity(uid, actType, actIcon,
                `changed their ${fieldLabel}`,
                "",  // shown via diff card instead
                { metadata: { field: f, before: oldVal, after: newVal } }
            ).catch(() => {})
        }
    }

    profileCache[uid] = fresh
}

let _pollRunning = false
// fetches profile/status/activity right away for one freshly-added user instead
// of waiting for the next 5-minute poll cycle to reach them
async function fetchNewUserBaseline(uid: string) {
    if (!pluginActive) return
    try {
        const presMod = findByProps("getStatus", "getActivities")
        const status = presMod?.getStatus?.(uid)
        if (status) statusCache[uid] = status
        const acts: any[] = presMod?.getActivities?.(uid) ?? []
        // must match actKeyOf()'s shape exactly (array of keys)  PRESENCE_UPDATES does
        // `oldActKeys.includes(k)` and `for (const k of oldActKeys)` on this cache. a bare
        // string here gets iterated char-by-char and substring-matched instead of key-matched,
        // which fires garbage "stopped playing" notifs on the very next real presence tick.
        const realActs = acts.filter((a: any) => a.type !== 4)
        activityCache[uid] = realActs.map((a: any) => a.type === 2
            ? `2\x00${a.name}\x00${a.details || ""}\x00${a.state || ""}`
            : `${a.type}\x00${a.name}`)
        const customAct = acts.find((a: any) => a.type === 4) ?? null
        customStatusCache[uid] = customAct
            ? [customAct.emoji?.name, customAct.state].filter(Boolean).join(" ") || null
            : null
        guildCache[uid] = new Set()

        const { body } = await RestAPI.get({
            url: `/users/${uid}/profile`,
            query: { with_mutual_guilds: true, with_mutual_friends_count: false },
        })
        const data = camelize(body)
        profileCache[uid] = data
        if (Array.isArray(data.mutualGuilds)) {
            guildCache[uid] = new Set(data.mutualGuilds.map((g: any) => g.id))
        }
    } catch { }
}

async function pollProfiles() {
    if (_pollRunning || !pluginActive) return
    _pollRunning = true
    const list = getWatchlist(settings)
    try {
        await sweepStaleSessions()
        for (const wu of list) {
            if (!pluginActive) break
            try {
                const { body } = await RestAPI.get({
                    url: `/users/${wu.id}/profile`,
                    query: { with_mutual_guilds: false, with_mutual_friends_count: false },
                })
                checkProfileChanged(wu.id, camelize(body))
            } catch { }
            await new Promise(r => setTimeout(r, 1500))
        }
    } finally {
        _pollRunning = false
    }
}

const STYLE_ID = "ur-s9"
function injectStyles() {
    if (document.getElementById(STYLE_ID)) return
    const s = document.createElement("style")
    s.id = STYLE_ID
    s.textContent = `
        @keyframes ur-spin { to { transform:rotate(360deg) } }
        .ur-spin { display:inline-block;width:14px;height:14px;border-radius:50%;
            border:2.5px solid #3f4147;border-top-color:#dbdee1;
            animation:ur-spin .55s linear infinite;vertical-align:middle; }
        @keyframes ur-fade-in { from { opacity:0;transform:translateY(-4px) } to { opacity:1;transform:translateY(0) } }
        .ur-fade-in { animation:ur-fade-in .2s cubic-bezier(.4,0,.2,1) forwards; }
        .ur-expand { display:grid;grid-template-rows:0fr;transition:grid-template-rows .3s cubic-bezier(.4,0,.2,1); }
        .ur-expand.open { grid-template-rows:1fr; }
        .ur-expand > div { overflow:hidden; }
        .ur-row-hover:hover { background:rgba(255,255,255,0.06); }

        @keyframes ur-row-in { from { opacity:0; transform:translateY(6px) scale(.98); } to { opacity:1; transform:translateY(0) scale(1); } }
        .ur-row { animation: ur-row-in .28s cubic-bezier(.2,.9,.3,1.2) both; transition: transform .2s cubic-bezier(.2,.8,.2,1.1), box-shadow .2s ease, background .2s ease, border-color .18s ease; }
        .ur-row:hover { transform: translateY(-3px) scale(1.008); box-shadow: 0 14px 30px rgba(0,0,0,0.38); border-color: #3f4147; background: linear-gradient(135deg, rgba(0,0,0,0.22) 0%, rgba(0,0,0,0.1) 100%) !important; }
        .ur-row:active { transform: translateY(-1px) scale(.995); }
        .ur-row.open { box-shadow: 0 8px 22px rgba(0,0,0,0.3); }

        .ur-row-avatar { transition: transform .2s cubic-bezier(.2,.8,.2,1.4); }
        .ur-row:hover .ur-row-avatar { transform: scale(1.08); }

        .ur-row-pin { transition: opacity .12s ease, color .12s ease, transform .22s cubic-bezier(.34,1.56,.64,1); }
        .ur-row:hover .ur-row-pin { transform: scale(1.12); }

        .ur-row-chevron { display:flex; align-items:center; justify-content:center; color:#949ba4; flex-shrink:0; opacity:.55; transition: transform .28s cubic-bezier(.4,0,.2,1), opacity .18s ease, color .18s ease; }
        .ur-row:hover .ur-row-chevron { opacity:1; transform: scale(1.15); }
        .ur-row-chevron.open { transform: rotate(180deg); opacity:1; color:#949cf4; }
        .ur-row:hover .ur-row-chevron.open { transform: rotate(180deg) scale(1.15); }

        .ur-badge-in { animation: ur-badge-in .25s cubic-bezier(.34,1.56,.64,1) both; transition: transform .18s cubic-bezier(.2,.8,.2,1.3); }
        .ur-row:hover .ur-badge-in { transform: scale(1.07); }

        .ur-activity-btn { transition: transform .22s cubic-bezier(.34,1.56,.64,1), background .18s ease, border-color .18s ease, box-shadow .22s ease; backdrop-filter: blur(8px) saturate(160%); -webkit-backdrop-filter: blur(8px) saturate(160%); }
        .ur-activity-btn:hover { transform: translateY(-2px) scale(1.06); background: rgba(88,101,242,0.18) !important; border-color: rgba(88,101,242,0.5) !important; box-shadow: 0 6px 16px rgba(88,101,242,0.28); }
        .ur-activity-btn:active { transform: translateY(0) scale(.95); }

        @keyframes ur-pin-pop { 0% { transform:scale(.6) rotate(-20deg); } 60% { transform:scale(1.25) rotate(6deg); } 100% { transform:scale(1) rotate(0); } }
        .ur-pin-pop { animation: ur-pin-pop .38s cubic-bezier(.34,1.56,.64,1) both; }

        .ur-chip { transition: transform .12s cubic-bezier(.2,.8,.2,1), background .18s ease, color .18s ease; }
        .ur-chip:active { transform: scale(.94); }

        @keyframes ur-badge-in { from { opacity:0; transform:scale(.5); } to { opacity:1; transform:scale(1); } }
        .ur-badge-in { animation: ur-badge-in .25s cubic-bezier(.34,1.56,.64,1) both; }

        .ur-icon-btn { transition: transform .14s cubic-bezier(.2,.8,.2,1.3), background .14s ease, color .14s ease; }
        .ur-icon-btn:hover { transform: translateY(-1px) scale(1.08); }
        .ur-icon-btn:active { transform: scale(.9); }

        @keyframes ur-float { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-6px); } }
        .ur-float { animation: ur-float 3s ease-in-out infinite; }

        /* Discord-style thin scrollbar - only visible on hover */
        .ur-scrollbar::-webkit-scrollbar { width:4px; height:4px; }
        .ur-scrollbar::-webkit-scrollbar-track { background:transparent; }
        .ur-scrollbar::-webkit-scrollbar-thumb { background:transparent; border-radius:4px; }
        .ur-scrollbar:hover::-webkit-scrollbar-thumb { background:#3f4147; }
        .ur-scrollbar::-webkit-scrollbar-thumb:hover { background:#4a4a6e; }

        /* Firefox scrollbar */
        .ur-scrollbar { scrollbar-width: thin; scrollbar-color: transparent transparent; }
        .ur-scrollbar:hover { scrollbar-color: #3f4147 transparent; }

        .ur-typing-dot { animation: ur-typing 1.4s infinite ease-in-out both; }
        .ur-typing-dot:nth-child(1) { animation-delay: -0.32s; }
        .ur-typing-dot:nth-child(2) { animation-delay: -0.16s; }
        @keyframes ur-typing { 0%, 80%, 100% { transform: scale(0); } 40% { transform: scale(1); } }
        @keyframes ur-shake { 0%, 100% { transform: translateX(0); } 10%, 30%, 50%, 70%, 90% { transform: translateX(-4px); } 20%, 40%, 60%, 80% { transform: translateX(4px); } }
        .ur-shake { animation: ur-shake 0.5s cubic-bezier(.36,.07,.19,.97) both; }
        @keyframes ur-pulse { 0% { box-shadow: 0 0 0 0 #5865f2; } 70% { box-shadow: 0 0 0 6px transparent; } 100% { box-shadow: 0 0 0 0 transparent; } }
        .ur-pulse { animation: ur-pulse 2s infinite; }
        @keyframes ur-flash-green { 0% { background: #248046; } 100% { background: #5865f2; } }
        .ur-flash-green { animation: ur-flash-green 0.5s ease; }
        @keyframes ur-blink-dot { 0%, 100% { opacity: 1; transform: scale(1); } 50% { opacity: 0.25; transform: scale(0.7); } }
        .ur-blink-dot { animation: ur-blink-dot 1.4s ease-in-out infinite; }

        .ur-compact [data-ur-card-body] { padding: 6px 10px !important; gap: 8px !important; margin-bottom: 3px !important; min-height: 0 !important; border-radius: 10px !important; }
        .ur-compact [data-ur-card-icon] { width: 22px !important; height: 22px !important; border-radius: 6px !important; font-size: 12px !important; margin-top: 0 !important; }
        .ur-compact [data-ur-card-icon] img { width: 14px !important; height: 14px !important; }
        .ur-compact [data-ur-card-title] { font-size: 12px !important; margin-bottom: 0 !important; gap: 5px !important; }
        .ur-compact [data-ur-card-body-text="meta"] { display: none !important; }
        .ur-compact [data-ur-card-body-text="content"] { font-size: 11px !important; margin-top: 0 !important; -webkit-line-clamp: 1; display: -webkit-box !important; -webkit-box-orient: vertical; overflow: hidden; }
        .ur-compact [data-ur-card-location] { display: none !important; }
        .ur-compact [data-ur-card-live] { padding: 1px 5px !important; font-size: 8px !important; margin-bottom: 0 !important; }
        .ur-compact { gap: 4px !important; }
        .ur-compact [data-ur-day-header] { margin-bottom: 3px !important; }

        /* Activity log modal specific - prevent horizontal scroll */
        .ur-activity-modal { overflow-x: hidden !important; }
        .ur-activity-modal * { max-width: 100%; box-sizing: border-box; }

        /* glassmorphism helpers */
        .ur-glass { backdrop-filter: blur(14px) saturate(160%); -webkit-backdrop-filter: blur(14px) saturate(160%); }
        .ur-badge-glass { backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px); }

        .ur-tab-btn { transition: transform 160ms cubic-bezier(.34,1.56,.64,1), background 200ms ease, color 200ms ease, box-shadow 200ms ease; }
        .ur-tab-btn:hover { transform: translateY(-1px) scale(1.03); }
        .ur-tab-btn:active { transform: scale(.95); }

        .ur-preset-card { transition: transform 200ms cubic-bezier(.34,1.56,.64,1), background 220ms ease, border-color 220ms ease, box-shadow 220ms ease; }
        .ur-preset-card:hover { transform: translateY(-2px) scale(1.015); }
        .ur-preset-card:active { transform: translateY(0) scale(.985); }

        @keyframes ur-modal-in { from { opacity:0; transform:scale(.97) translateY(8px); } to { opacity:1; transform:scale(1) translateY(0); } }
        .ur-modal-in { animation: ur-modal-in .28s cubic-bezier(.2,.9,.3,1.1) both; }

        @keyframes ur-status-pop { from { opacity:0; transform:scale(.4); } to { opacity:1; transform:scale(1); } }
        .ur-status-dot { animation: ur-status-pop .3s cubic-bezier(.34,1.56,.64,1) both; transition: background 200ms ease, box-shadow 200ms ease; }

        .ur-card-hover { transition: transform 180ms cubic-bezier(.2,.8,.2,1), box-shadow 180ms ease, border-color 180ms ease, background 180ms ease; }
        .ur-card-hover:hover { transform: translateY(-2px); box-shadow: 0 6px 18px rgba(0,0,0,0.3); }

        @keyframes ur-log-in { from { opacity:0; transform:translateY(6px) scale(.98); } to { opacity:1; transform:translateY(0) scale(1); } }
        .ur-log-card { animation: ur-log-in .26s cubic-bezier(.2,.9,.3,1.15) both; transition: transform .2s cubic-bezier(.2,.8,.2,1.1), box-shadow .2s ease, background .2s ease, border-color .18s ease; }
        .ur-log-card:hover { transform: translateY(-3px) scale(1.008); box-shadow: 0 14px 30px rgba(0,0,0,0.38); border-color: #3f4147; background: linear-gradient(135deg, rgba(0,0,0,0.22) 0%, rgba(0,0,0,0.1) 100%) !important; }
        .ur-log-card:active { transform: translateY(-1px) scale(.995); }
        .ur-log-card.open { box-shadow: 0 8px 22px rgba(0,0,0,0.3); }

        .ur-log-icon { transition: transform .22s cubic-bezier(.2,.8,.2,1.4), box-shadow .22s ease; }
        .ur-log-card:hover .ur-log-icon { transform: scale(1.08) rotate(-4deg); }

        .ur-log-chevron { display:flex; align-items:center; justify-content:center; color:#949ba4; flex-shrink:0; opacity:.55; transition: transform .28s cubic-bezier(.4,0,.2,1), opacity .18s ease, color .18s ease; }
        .ur-log-card:hover .ur-log-chevron { opacity:1; }
        .ur-log-chevron.open { transform: rotate(180deg); opacity:1; color:#949cf4; }

        .ur-log-expand-in { animation: ur-fade-in .22s cubic-bezier(.4,0,.2,1) both; }

        .ur-footer-btn { transition: transform .2s cubic-bezier(.34,1.56,.64,1), background .18s ease, border-color .18s ease, box-shadow .2s ease, color .18s ease; backdrop-filter: blur(10px) saturate(160%); -webkit-backdrop-filter: blur(10px) saturate(160%); }
        .ur-footer-btn:hover { transform: translateY(-2px) scale(1.04); background: rgba(255,255,255,0.09) !important; border-color: #3f4147 !important; box-shadow: 0 6px 16px rgba(0,0,0,0.3); }
        .ur-footer-btn:active { transform: translateY(0) scale(.94); }
        .ur-footer-btn-danger:hover { background: rgba(218,55,60,0.2) !important; border-color: #da373c !important; box-shadow: 0 6px 16px rgba(218,55,60,0.3); }
        .ur-footer-btn-primary:hover { background: #5865f2 !important; border-color: #5865f2 !important; color: #fff !important; box-shadow: 0 6px 18px rgba(88,101,242,0.4); }
    `
    document.head.appendChild(s)
}

const CLIENT_EMOJI: Record<string, string> = {
    desktop:  "💻",
    mobile:   "📱",
    web:      "🌐",
    embedded: "🎮",
    vr:       "🥽",
}

function resolveClient(cs?: Record<string, string> | null): string | null {
    if (!cs) return null
    // priority order for the "primary" platform
    if (cs.mobile)   return "mobile"
    if (cs.desktop)  return "desktop"
    if (cs.web)      return "web"
    if (cs.embedded) return "embedded"
    if (cs.vr)       return "vr"
    const first = Object.keys(cs).find(k => cs[k])
    return first ?? null
}

// returns every active platform, not just one  display only
function resolveAllClients(cs?: Record<string, string> | null): string[] {
    if (!cs) return []
    return Object.keys(cs).filter(k => cs[k])
}

const CLIENT_LABEL_MAP: Record<string, string> = { desktop: "Desktop", mobile: "Mobile", web: "Web", embedded: "Console", vr: "VR" }
function platformSuffixLog(uid: string): string {
    const c = clientCache[uid]
    if (!c) return ""
    return ` · on ${CLIENT_EMOJI[c] || "📡"} ${CLIENT_LABEL_MAP[c] || c}`
}

const C = {
    bg1:         "#1e1f22",
    bg2:         "#2b2d31",
    bg3:         "#313338",
    bgEl:        "#3f4147",
    border:      "#3f4147",
    hov:         "rgba(255,255,255,0.06)",
    header:      "#f2f3f5",
    subheader:   "#b5bac1",
    text:        "#dbdee1",
    muted:       "#949ba4",
    danger:      "#fa777c",
    brand:       "#5865f2",
    brandLight:  "#949cf4",
    brandGrad:   "linear-gradient(135deg, #5865f2 0%, #949cf4 100%)",
    green:       "#248046",
    red:         "#da373c",
    white:       "#ffffff",
    expanded:    "#232428",
} as const

const ico = {
    search:   () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>,
    check:    () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M20 6 9 17l-5-5" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/></svg>,
    x:        () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M18 6 6 18M6 6l12 12" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/></svg>,
    chevron:  () => <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M7.41 8.59 12 13.17l4.59-4.58L18 10l-6 6-6-6z"/></svg>,
    trash:    () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6h14zM10 11v6M14 11v6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>,
    copy:     () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><rect x="9" y="9" width="13" height="13" rx="2" stroke="currentColor" strokeWidth="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" stroke="currentColor" strokeWidth="2"/></svg>,
    external: () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>,
    sortAz:   () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M3 6h12M3 12h8M3 18h4M16 8l4-4 4 4M20 4v16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>,
    sortDate: () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2"/><path d="M12 6v6l4 2" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>,
    eye:      () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={C.white} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3" fill={C.white} stroke="none"/><path d="M12 2v2M12 20v2" strokeWidth="1.5" opacity="0.5"/></svg>,
    ghost:    () => <svg width="48" height="48" viewBox="0 0 24 24" fill="currentColor" opacity=".25"><path d="M12 2a9 9 0 0 0-9 9v7c0 1.66 1.34 3 3 3h3v-4h6v4h3c1.66 0 3-1.34 3-3v-7a9 9 0 0 0-9-9zm-3 8a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm6 0a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3z"/></svg>,
    msg:      () => <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M2 22V4a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6l-4 4z"/></svg>,
    edit:     () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M12 20h9" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>,
    del:      () => <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M15 3v-1a2 2 0 0 0-2-2h-2a2 2 0 0 0-2 2v1H3v2h2v13a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V5h2V3h-6zm-4-1h2v1h-2V2zm-2 5h2v9h-2V7zm4 0h2v9h-2V7z"/></svg>,
    typing:   () => <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><circle cx="4" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="20" cy="12" r="2"/></svg>,
    profile:  () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/><circle cx="12" cy="7" r="4" stroke="currentColor" strokeWidth="2"/></svg>,
    avatar:   () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><rect x="3" y="3" width="18" height="18" rx="4" stroke="currentColor" strokeWidth="2"/><circle cx="12" cy="10" r="3" stroke="currentColor" strokeWidth="2"/><path d="M7 21c0-2.76 2.24-5 5-5s5 2.24 5 5" stroke="currentColor" strokeWidth="2"/></svg>,
    voice:    () => <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z"/><path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/></svg>,
    status:   () => <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="10" opacity=".3"/><circle cx="12" cy="12" r="5"/></svg>,
    activity: () => <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M21 6H3c-1.1 0-2 .9-2 2v8c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2zm-10 7H8v3H6v-3H3v-2h3V8h2v3h3v2zm4.5 2c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zm4-3c-.83 0-1.5-.67-1.5-1.5S18.67 9 19.5 9s1.5.67 1.5 1.5-.67 1.5-1.5 1.5z"/></svg>,
    joins:    () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" stroke="currentColor" strokeWidth="2"/><circle cx="8.5" cy="7" r="4" stroke="currentColor" strokeWidth="2"/><path d="M20 8v6M23 11h-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>,
    history:  () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>,
    preview:  () => <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>,
    catMsg:       () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>,
    catEdit:      () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4L18.5 2.5z"/></svg>,
    catDelete:    () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>,
    catTyping:    () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="6" x2="20" y2="6"/><line x1="4" y1="18" x2="20" y2="18"/></svg>,
    catStatus:    () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" opacity="0.35"/><circle cx="12" cy="12" r="4" fill="currentColor"/></svg>,
    catVoice:     () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/></svg>,
    catProfile:   () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>,
    catActivity:  () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>,

    location: () => <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>,
    clock:    () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>,
    download: () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>,
    pin:      () => <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="1"><path d="M16 3l5 5-5.5 5.5L17 17l-2 2-4.5-4.5L5 20l-1-1 5.5-5.5L5 9l2-2 3.5 3.5L16 3z"/></svg>,
    pinOutline: () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 3l5 5-5.5 5.5L17 17l-2 2-4.5-4.5L5 20l-1-1 5.5-5.5L5 9l2-2 3.5 3.5L16 3z"/></svg>,
    compact:  () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="4" y1="7" x2="20" y2="7"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="17" x2="20" y2="17"/></svg>,
    upload:   () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>,
    clear:    () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>,
    calendar: () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>,

}

// per-event icon + color for activity log cards
const actIco = {
    message:   { color: "#5865f2", Icon: () => <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M2 22V4a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6l-4 4z"/></svg> },
    edit:      { color: "#f0b232", Icon: () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg> },
    delete:    { color: "#da373c", Icon: () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg> },
    typing:    { color: "#949cf4", Icon: () => <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><circle cx="4" cy="12" r="2.2"/><circle cx="12" cy="12" r="2.2"/><circle cx="20" cy="12" r="2.2"/></svg> },

    listening: { color: "#c586f5", Icon: () => <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M9 18a3 3 0 1 1-3-3h1V5.5a1 1 0 0 1 .8-.98l9-2a1 1 0 0 1 1.2.98v9a3 3 0 1 1-2-2.83V6.7l-7 1.56V15a3 3 0 0 1-3 3v0z"/></svg> },
    watching:  { color: "#9146ff", Icon: () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="4" width="20" height="15" rx="2"/><path d="M8 21h8M12 19v2"/></svg> },
    playing:   { color: "#f0b232", Icon: () => <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M6 9h4v2H8v2H6v-2H4V9h2V7h2v2zm9.5 3a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm3-4a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zM17 3H7a5 5 0 0 0-5 5v6a5 5 0 0 0 5 5h.5a3 3 0 0 0 2.4-1.2l1.4-1.87a2 2 0 0 1 3.4 0l1.4 1.87A3 3 0 0 0 16.5 19H17a5 5 0 0 0 5-5V8a5 5 0 0 0-5-5z"/></svg> },
    streaming: { color: "#da373c", Icon: () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/><circle cx="12" cy="10" r="1.5" fill="currentColor" stroke="none"/></svg> },
    camera:    { color: "#23a55a", Icon: () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M23 7l-7 5 7 5V7z"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg> },
    screen:    { color: "#ff5e5e", Icon: () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="4" width="20" height="13" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/><polyline points="8 12 11 9 13 11 16 8"/></svg> },

    voice:     { color: "#23a55a", Icon: () => <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z"/><path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/></svg> },
    vcMove:    { color: "#dbdee1", Icon: () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg> },

    online:    { color: "#23a55a", Icon: () => <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="9"/></svg> },
    idle:      { color: "#f0b232", Icon: () => <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M12 3a9 9 0 1 0 9 9c0-.46-.04-.92-.1-1.36A5.389 5.389 0 0 1 17.5 12c-3.03 0-5.5-2.47-5.5-5.5 0-1.33.47-2.55 1.26-3.5A9.04 9.04 0 0 0 12 3z"/></svg> },
    dnd:       { color: "#da373c", Icon: () => <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="9"/><rect x="7.5" y="10.8" width="9" height="2.4" rx="1.2" fill="#1e1f22"/></svg> },
    offline:   { color: "#80848e", Icon: () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="9"/></svg> },
    status:    { color: "#23a55a", Icon: () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" opacity="0.35"/><circle cx="12" cy="12" r="4.5" fill="currentColor"/></svg> },
    customStatus: { color: "#949cf4", Icon: () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><circle cx="9" cy="10" r="1" fill="currentColor" stroke="none"/><circle cx="15" cy="10" r="1" fill="currentColor" stroke="none"/></svg> },

    profile:   { color: "#ff6b6b", Icon: () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg> },
    avatar:    { color: "#ff6b6b", Icon: () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="4"/><circle cx="12" cy="10" r="3"/><path d="M7 21c0-2.76 2.24-5 5-5s5 2.24 5 5"/></svg> },
    banner:    { color: "#ff6b6b", Icon: () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="6" width="20" height="12" rx="2"/><path d="M2 10h20"/></svg> },
    bio:       { color: "#ff6b6b", Icon: () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="7" y1="8" x2="17" y2="8"/><line x1="7" y1="12" x2="17" y2="12"/><line x1="7" y1="16" x2="13" y2="16"/></svg> },
    username:  { color: "#ff6b6b", Icon: () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20.59 13.41 13.42 20.58a2 2 0 0 1-2.83 0L2.5 12.5V2.5h10z"/><circle cx="6.5" cy="6.5" r="1.5" fill="currentColor" stroke="none"/></svg> },
    pronouns:  { color: "#ff6b6b", Icon: () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><line x1="8" y1="9" x2="16" y2="9"/><line x1="8" y1="13" x2="14" y2="13"/><line x1="8" y1="17" x2="12" y2="17"/></svg> },

    join:      { color: "#23a55a", Icon: () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><path d="M20 8v6M23 11h-6"/></svg> },
    leave:     { color: "#da373c", Icon: () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="17" y1="8" x2="23" y2="14"/><line x1="23" y1="8" x2="17" y2="14"/></svg> },

    session:   { color: "#949ba4", Icon: () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg> },
} as const

const CtxEyeIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" style={{ width: 18, height: 18 }}>
        <path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" />
        <path fillRule="evenodd" d="M1.323 11.447C2.811 6.976 7.028 3.75 12.001 3.75c4.97 0 9.185 3.223 10.675 7.69.12.362.12.752 0 1.113-1.487 4.471-5.705 7.697-10.677 7.697-4.97 0-9.186-3.223-10.675-7.69a1.762 1.762 0 0 1 0-1.113ZM17.25 12a5.25 5.25 0 1 1-10.5 0 5.25 5.25 0 0 1 10.5 0Z" clipRule="evenodd" />
    </svg>
)
const CtxEyeOffIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" style={{ width: 18, height: 18 }}>
        <path d="M3.53 2.47a.75.75 0 0 0-1.06 1.06l18 18a.75.75 0 1 0 1.06-1.06l-18-18ZM22.676 12.553a11.249 11.249 0 0 1-2.631 4.31l-3.099-3.099a5.25 5.25 0 0 0-6.71-6.71L7.759 4.577a11.217 11.217 0 0 1 4.242-.827c4.97 0 9.185 3.223 10.675 7.69.12.362.12.752 0 1.113Z" />
        <path d="M15.75 12c0 .18-.013.357-.037.53l-4.244-4.243A3.75 3.75 0 0 1 15.75 12ZM12.53 15.713l-4.243-4.244a3.75 3.75 0 0 0 4.244 4.243Z" />
        <path d="M6.75 12c0-.619.107-1.213.304-1.764l-3.1-3.1a11.25 11.25 0 0 0-2.63 4.31c-.12.362-.12.752 0 1.114 1.489 4.467 5.704 7.69 10.675 7.69 1.5 0 2.933-.294 4.242-.827l-2.477-2.477A5.25 5.25 0 0 1 6.75 12Z" />
    </svg>
)
const CtxGearIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" style={{ width: 18, height: 18 }}>
        <path fillRule="evenodd" d="M2.25 5.25a3 3 0 0 1 3-3h13.5a3 3 0 0 1 3 3V15a3 3 0 0 1-3 3h-3v.257c0 .597.237 1.17.659 1.591l.621.622a.75.75 0 0 1-.53 1.28h-9a.75.75 0 0 1-.53-1.28l.621-.622a2.25 2.25 0 0 0 .659-1.59V18h-3a3 3 0 0 1-3-3V5.25Zm1.5 0v7.5a1.5 1.5 0 0 0 1.5 1.5h13.5a1.5 1.5 0 0 0 1.5-1.5v-7.5a1.5 1.5 0 0 0-1.5-1.5H5.25a1.5 1.5 0 0 0-1.5 1.5Z" clipRule="evenodd" />
    </svg>
)

function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
    return (
        <div
            role="switch" aria-checked={on}
            onClick={() => onChange(!on)}
            style={{
                width: 36, height: 22, borderRadius: 11, flexShrink: 0,
                background: on ? "#5865f2" : "#3f4147",
                cursor: "pointer", position: "relative",
                transition: "background 150ms ease",
            }}
        >
            <div style={{
                position: "absolute", top: 2, left: on ? 16 : 2,
                width: 18, height: 18, borderRadius: "50%",
                background: C.white, boxShadow: "0 1px 3px rgba(0,0,0,0.25)",
                transition: "left 150ms cubic-bezier(0.4,0,0.2,1)",
            }} />
        </div>
    )
}

type LookupStage =
    | { s: "idle" }
    | { s: "loading" }
    | { s: "done"; user: any; av: string }
    | { s: "err"; msg: string }

function timeAgo(ts: number): string {
    const diff = Date.now() - ts
    const d    = new Date(ts)
    const now  = new Date()
    const mins = Math.floor(diff / 60000)
    const isSameDay = d.getDate() === now.getDate() &&
                      d.getMonth() === now.getMonth() &&
                      d.getFullYear() === now.getFullYear()
    const yesterday = new Date(now)
    yesterday.setDate(yesterday.getDate() - 1)
    const isYesterday = d.getDate() === yesterday.getDate() &&
                        d.getMonth() === yesterday.getMonth() &&
                        d.getFullYear() === yesterday.getFullYear()

    if (mins < 1)    return "just now"
    if (mins < 60)   return `${mins}m ago`
    if (isSameDay)   return `${Math.floor(mins / 60)}h ago`
    if (isYesterday) return "Yesterday"
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" })
}

function exactTime(ts: number): string {
    return new Date(ts).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "medium", hour12: true })
}

function decodeSnowflake(id: string) {
    try {
        const snowflake = BigInt(id)
        const timestamp = Number(snowflake >> 22n) + 1420070400000
        const workerId = Number((snowflake >> 17n) & 0x1Fn)
        const processId = Number((snowflake >> 12n) & 0x1Fn)
        const increment = Number(snowflake & 0xFFFn)
        return { timestamp, workerId, processId, increment, date: new Date(timestamp) }
    } catch {
        return null
    }
}

function AddUserInput({ rawId, setRawId, hasErr, lk, setLk, doLookup }: {
    rawId: string
    setRawId: (v: string) => void
    hasErr: boolean
    lk: LookupStage
    setLk: (v: LookupStage) => void
    doLookup: () => void
}) {
    const [focused, setFocused] = React.useState(false)
    const [btnState, setBtnState] = React.useState<"idle" | "valid" | "searching" | "found" | "notfound">("idle")
    const btnRef = React.useRef<HTMLButtonElement>(null)
    const borderColor = hasErr ? C.red : focused ? C.brand : C.border

    React.useEffect(() => {
        const clean = rawId.trim().replace(/\D/g, "")
        if (lk.s === "loading") setBtnState("searching")
        else if (lk.s === "done") {
            setBtnState("found")
            const t = setTimeout(() => setBtnState("idle"), 2000)
            return () => clearTimeout(t)
        }
        else if (lk.s === "err") {
            setBtnState("notfound")
            const t = setTimeout(() => setBtnState("idle"), 3000)
            return () => clearTimeout(t)
        }
        else if (clean.length >= 17 && clean.length <= 20) setBtnState("valid")
        else setBtnState("idle")
    }, [rawId, lk.s])

    const btnStyle: React.CSSProperties = {
        borderRadius: 20,
        height: 40,
        boxSizing: "border-box",
        padding: "0 20px",
        color: "#ffffff",
        border: "none",
        fontSize: 14,
        fontWeight: 600,
        cursor: btnState === "idle" ? "not-allowed" : "pointer",
        flexShrink: 0,
        fontFamily: "inherit",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        transition: "background 200ms ease, opacity 200ms ease",
    }

    const getBtnBg = () => {
        if (btnState === "found") return "#248046"
        if (btnState === "notfound") return "#da373c"
        if (btnState === "searching") return "#4752c4"
        if (btnState === "valid") return "#5865f2"
        return "rgba(255,255,255,0.06)"
    }

    const getBtnText = () => {
        if (btnState === "found") return "Added ✓"
        if (btnState === "notfound") return "Not found"
        if (btnState === "searching") return <><span className="ur-spin" style={{ marginRight: 6 }} />Searching...</>
        return "look up"
    }

    return (
        <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
            <div style={{ flex: 1, minWidth: 0 }}>
                <input
                    placeholder="paste a discord user id"
                    value={rawId}
                    onChange={(e) => { setRawId(e.target.value); if (hasErr) setLk({ s: "idle" }) }}
                    onKeyDown={(e) => { if (e.key === "Enter" && btnState !== "idle") doLookup() }}
                    onFocus={() => setFocused(true)}
                    onBlur={() => setFocused(false)}
                    autoFocus
                    style={{
                        background: "#1e1f22",
                        borderRadius: 20,
                        border: `1px solid ${borderColor}`,
                        height: 40,
                        boxSizing: "border-box",
                        padding: "0 14px",
                        transition: "border-color 150ms ease, box-shadow 150ms ease",
                        width: "100%",
                        fontSize: 14,
                        color: "#dbdee1",
                        outline: "none",
                        fontFamily: "inherit",
                        boxShadow: focused ? "inset 0 0 0 1px #5865f2" : "none",
                    }}
                />
                <div style={{ fontSize: 11, color: hasErr ? C.danger : C.muted, marginTop: 5, display: "flex", alignItems: "center", gap: 4 }}>
                    {hasErr ? <ico.x /> : null}
                    {hasErr ? (lk as any).msg : "developer mode → right-click user → copy user id"}
                </div>
            </div>
            <button
                ref={btnRef}
                onClick={() => { if (btnState !== "idle") doLookup() }}
                className={btnState === "notfound" ? "ur-shake" : btnState === "valid" ? "ur-pulse" : ""}
                style={{ ...btnStyle, background: getBtnBg(), opacity: btnState === "idle" ? 0.5 : 1 }}
            >
                {getBtnText()}
            </button>
        </div>
    )
}

function AddLabelInput({ label, setLabel, doAdd }: {
    label: string
    setLabel: (v: string) => void
    doAdd: () => void
}) {
    const [focused, setFocused] = React.useState(false)
    return (
        <input
            placeholder='e.g. "bestie", "the rat", "ex"'
            maxLength={50}
            value={label}
            onChange={(e) => setLabel(e.target.value.slice(0, 50))}
            onKeyDown={(e) => { if (e.key === "Enter") doAdd() }}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            autoFocus
            style={{
                background: "#1e1f22",
                borderRadius: 20,
                border: `1px solid ${focused ? C.brand : "#3f4147"}`,
                boxShadow: focused ? "0 0 0 3px rgba(88,101,242,0.18)" : "none",
                height: 40,
                boxSizing: "border-box",
                padding: "0 14px",
                transition: "border-color 150ms ease, box-shadow 150ms ease",
                width: "100%",
                fontSize: 14,
                color: "#dbdee1",
                outline: "none",
                fontFamily: "inherit",
                marginBottom: 14,
            }}
        />
    )
}

function AddUserSection({ onAdded }: { onAdded: () => void }) {
    const [rawId, setRawId] = React.useState("")
    const [label, setLabel] = React.useState("")
    const [lk, setLk]       = React.useState<LookupStage>({ s: "idle" })
    const [copiedId, setCopiedId] = React.useState(false)

    const cleanId = rawId.trim().replace(/\D/g, "")
    const hasErr  = lk.s === "err"

    const copyId = (id: string) => {
        navigator.clipboard.writeText(id)
        setCopiedId(true)
        setTimeout(() => setCopiedId(false), 1200)
    }

    const doLookup = () => {
        if (!cleanId)                                    return setLk({ s: "err", msg: "enter a user id first" })
        if (cleanId.length < 17 || cleanId.length > 20) return setLk({ s: "err", msg: "discord ids are 17-20 digits" })
        if (isWatched(settings, cleanId))                return setLk({ s: "err", msg: "already on your watchlist" })

        setLk({ s: "loading" })
        RestAPI.get({
            url: `/users/${cleanId}/profile`,
            query: { with_mutual_guilds: false, with_mutual_friends_count: false },
        }).then((res: any) => {
            const d = camelize(res.body)
            setLk({ s: "done", user: d.user, av: avatarUrl(d.user.id, d.user.avatar, 64) })
        }).catch((e: any) => {
            const code = e?.status ?? e?.response?.status
            setLk({
                s: "err",
                msg: code === 404 ? "user not found"
                   : code === 403 ? "profile is private (no shared server) /*
 * TrashCord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// UserRadar - k1ng_op
// tracks msgs, edits, deletes, typing, profile/pfp, voice, status, activity, joins

import { addContextMenuPatch, NavContextMenuPatchCallback, removeContextMenuPatch } from "@api/ContextMenu"
import { DataStore, Notifications } from "@api/index"
import { definePluginSettings } from "@api/Settings"
import { getCurrentChannel, openUserProfile } from "@utils/discord"
import definePlugin, { OptionType } from "@utils/types"
import { findByProps } from "@webpack"
import { ChannelStore, Menu, MessageStore, Modal, openModal, React, RestAPI, showToast, UserStore } from "@webpack/common"
import type { JSX } from "react"

import {
    addUser, camelize, displayName, featureOn,
    getWatchedUser, getWatchlist, inQuietHours,
    isWatched, log, patchUser, removeUser
} from "./store"

import {
    GuildMemberEvent, MsgCreateEvent, MsgDeleteEvent, MsgUpdateEvent,
    PresenceEvent,
    TypingEvent, VoiceStateEvent, WatchedUser
} from "./types"

const STATUS_EMOJI_LOCAL: Record<string, string> = {
    online: "🟢",
    idle: "🌙",
    dnd: "🔴",
    offline: "⚫",
    invisible: "⚫",
}
const ACTIVITY_LOG_KEY = "UserRadar_ActivityLog_v2"
export type ActivityType =
    | "msg" | "edit" | "delete" | "typing"
    | "status" | "activity" | "voice"
    | "join" | "leave" | "boost"
    | "profile" | "avatar" | "banner" | "bio" | "username" | "displayname"
    | "pronouns" | "custom_status"
    | "online" | "offline" | "idle" | "dnd"
    | "game_start" | "game_stop" | "spotify" | "streaming"
    | "vc_join" | "vc_leave" | "vc_move"
    | "session"

export interface ActivityEntry {
    id: string
    uid: string
    ts: number
    type: ActivityType
    icon: string
    title: string
    body: string
    guildId?: string
    channelId?: string
    msgId?: string
    metadata?: Record<string, any>
}

function sessionKey(uid: string, type: string, channelId?: string): string {
    return channelId ? `${uid}_${type}_${channelId}` : `${uid}_${type}`
}

class ActivityStore {
    private cache: Record<string, ActivityEntry[]> = {}
    private loaded = false
    private loadPromise: Promise<void> | null = null

    async load() {
        if (this.loaded) return
        if (this.loadPromise) return this.loadPromise
        this.loadPromise = (async () => {
            try {
                const data = await DataStore.get(ACTIVITY_LOG_KEY)
                if (data) this.cache = JSON.parse(data)
            } catch (e) { console.error("[UserRadar] Failed to load activity log", e) }
            this.loaded = true
        })()
        return this.loadPromise
    }

    async save() {
        try {
            await DataStore.set(ACTIVITY_LOG_KEY, JSON.stringify(this.cache))
        } catch (e) { console.error("[UserRadar] Failed to save activity log", e) }
    }

    // batches rapid writes into one save
    private saveTimer: ReturnType<typeof setTimeout> | null = null
    private pendingSave: { resolve: () => void }[] = []
    private scheduleSave(): Promise<void> {
        return new Promise(resolve => {
            this.pendingSave.push({ resolve })
            if (this.saveTimer) return
            this.saveTimer = setTimeout(async () => {
                this.saveTimer = null
                const waiters = this.pendingSave
                this.pendingSave = []
                await this.save()
                waiters.forEach(w => w.resolve())
            }, 1500)
        })
    }
    // forces the pending debounced save through immediately
    async flushSave() {
        if (this.saveTimer) { clearTimeout(this.saveTimer); this.saveTimer = null }
        const waiters = this.pendingSave
        this.pendingSave = []
        await this.save()
        waiters.forEach(w => w.resolve())
    }

    getLogs(uid: string): ActivityEntry[] {
        return this.cache[uid] || []
    }

    // serializes writes so addLog/removeLog/updateLog never interleave
    private writeQueue: Promise<any> = Promise.resolve()
    private enqueue<T>(fn: () => Promise<T>): Promise<T> {
        const next = this.writeQueue.then(fn, fn)
        this.writeQueue = next.catch(() => {})
        return next
    }

    async addLog(entry: Omit<ActivityEntry, "id">) {
        return this.enqueue(async () => {
            await this.load()
            if (!this.cache[entry.uid]) this.cache[entry.uid] = []
            const fullEntry: ActivityEntry = {
                ...entry,
                id: `${entry.uid}_${entry.ts}_${Math.random().toString(36).slice(2, 8)}`,
            }
            this.cache[entry.uid].unshift(fullEntry)
            const rawMax = settings.store.maxLogsPerUser
            const max = rawMax < 0 ? 0 : Math.min(rawMax, 50000)
            if (max > 0 && this.cache[entry.uid].length > max)
                this.cache[entry.uid].length = max
            await this.scheduleSave()
            return fullEntry
        })
    }

    async clearLogs(uid: string) {
        return this.enqueue(async () => {
            await this.load()
            delete this.cache[uid]
            await this.save()
        })
    }

    async clearAll() {
        return this.enqueue(async () => {
            this.cache = {}
            await DataStore.del(ACTIVITY_LOG_KEY)
        })
    }

    exportAll(): string {
        return JSON.stringify(this.cache, null, 2)
    }

    async importAll(json: string) {
        return this.enqueue(async () => {
            try {
                const parsed = JSON.parse(json)
                // Validate it's a plain object whose values are arrays of entries
                if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return false
                for (const [uid, entries] of Object.entries(parsed)) {
                    if (typeof uid !== "string") return false
                    if (!Array.isArray(entries)) return false
                    for (const e of entries as any[]) {
                        if (typeof e !== "object" || e === null) return false
                        if (typeof e.id !== "string" || typeof e.uid !== "string" || typeof e.ts !== "number") return false
                    }
                }
                await this.load()
                // merge by id, don't replace whole cache - category export would wipe everything
                for (const [uid, entries] of Object.entries(parsed as Record<string, ActivityEntry[]>)) {
                    if (!this.cache[uid]) this.cache[uid] = []
                    const existingIds = new Set(this.cache[uid].map(e => e.id))
                    for (const e of entries) {
                        if (!existingIds.has(e.id)) this.cache[uid].push(e)
                    }
                    this.cache[uid].sort((a, b) => b.ts - a.ts)
                }
                await this.save()
                return true
            } catch { return false }
        })
    }

    async updateLog(uid: string, logId: string, updates: Partial<ActivityEntry>) {
        return this.enqueue(async () => {
            await this.load()
            const logs = this.cache[uid]
            if (!logs) return false
            const idx = logs.findIndex(l => l.id === logId)
            if (idx === -1) return false
            const updated = { ...logs[idx], ...updates, ts: Date.now() }
            logs.splice(idx, 1)
            logs.unshift(updated)
            await this.save()
            emitActivityUpdate(uid, updated)
            return true
        })
    }

    async removeLog(uid: string, logId: string) {
        return this.enqueue(async () => {
            await this.load()
            const logs = this.cache[uid]
            if (!logs) return false
            this.cache[uid] = logs.filter(l => l.id !== logId)
            await this.save()
            emitActivityRemove(uid, logId)
            return true
        })
    }

    // bulk delete - e.g. "remove all typing cards" / "remove all status cards" for a user
    async removeLogsWhere(uid: string, predicate: (log: ActivityEntry) => boolean): Promise<number> {
        return this.enqueue(async () => {
            await this.load()
            const logs = this.cache[uid]
            if (!logs) return 0
            const toRemove = logs.filter(predicate)
            if (toRemove.length === 0) return 0
            this.cache[uid] = logs.filter(l => !predicate(l))
            await this.save()
            toRemove.forEach(l => emitActivityRemove(uid, l.id))
            return toRemove.length
        })
    }
}

export const activityStore = new ActivityStore()

const activityListeners = new Set<(uid: string, entry: ActivityEntry) => void>()

export function onActivityUpdate(cb: (uid: string, entry: ActivityEntry) => void) {
    activityListeners.add(cb)
    return () => activityListeners.delete(cb)
}

function emitActivityUpdate(uid: string, entry: ActivityEntry) {
    activityListeners.forEach(cb => cb(uid, entry))
}

const activityRemoveListeners = new Set<(uid: string, logId: string) => void>()

export function onActivityRemove(cb: (uid: string, logId: string) => void) {
    activityRemoveListeners.add(cb)
    return () => activityRemoveListeners.delete(cb)
}

function emitActivityRemove(uid: string, logId: string) {
    activityRemoveListeners.forEach(cb => cb(uid, logId))
}

export async function logUserActivity(
    uid: string,
    type: ActivityType,
    icon: string,
    title: string,
    body: string,
    options?: {
        guildId?: string
        channelId?: string
        msgId?: string
        metadata?: Record<string, any>
    }
) {
    const entry = await activityStore.addLog({
        uid, ts: Date.now(), type, icon, title, body, ...options,
    })
    emitActivityUpdate(uid, entry)
    return entry
}

function logActivity(uid: string, type: string, icon: string, title: string, body?: string, guildId?: string, channelId?: string, msgId?: string) {
    logUserActivity(uid, type as ActivityType, icon, title, body ?? title, { guildId, channelId, msgId }).catch(() => {})
}

const profileCache:  Record<string, any>                          = {}
const vcCache:       Record<string, string | null>                = {}
const statusCache:   Record<string, string>                       = {}
const activityCache: Record<string, string[]>                     = {}
const guildCache:    Record<string, Set<string>>                  = {}
const vcJoinTime:    Record<string, number>                       = {}
const clientCache:   Record<string, string | null>                = {}
const cameraCache:   Record<string, boolean>                      = {}
const streamCache:   Record<string, boolean>                      = {}
const customStatusCache: Record<string, string | null>            = {}  // text status (activity type 4)
const statusSessionCache: Record<string, { startTime: number; startStatus: string; changes: { status: string; ts: number }[]; platforms: { platform: string; ts: number }[] } | null> = {}  // status session tracking

const activeSessions: Record<string, { logId: string; startTime: number; channelId?: string; guildId?: string; metadata?: any }> = {}

// pending "is typing" log per user+channel - MESSAGE_CREATE deletes it if they actually send.
// stays if they don't.
const pendingTypingLog: Record<string, { logId: string; ts: number }> = {}
const TYPING_LOG_TTL_MS = 3 * 60 * 1000

// persisted so a discord restart doesn't orphan whatever was mid-session
const ACTIVE_SESSIONS_KEY = "UserRadar_ActiveSessions_v1"

async function saveActiveSessions() {
    try { await DataStore.set(ACTIVE_SESSIONS_KEY, JSON.stringify(activeSessions)) }
    catch (e) { log.warn("[UserRadar] failed to save active sessions", e) }
}

async function loadActiveSessions(): Promise<Record<string, { logId: string; startTime: number; channelId?: string; guildId?: string; metadata?: any }>> {
    try {
        const data = await DataStore.get(ACTIVE_SESSIONS_KEY)
        return data ? JSON.parse(data) : {}
    } catch { return {} }
}

let _sessSaveTimer: ReturnType<typeof setTimeout> | null = null
function scheduleSessionSave() {
    if (_sessSaveTimer) return
    _sessSaveTimer = setTimeout(() => { _sessSaveTimer = null; saveActiveSessions() }, 1000)
}
let _sessSaveInterval: ReturnType<typeof setInterval> | null = null

const MAX_SESSION_AGE_MS = 24 * 60 * 60 * 1000  // 24h - a session stuck this long means the close event never arrived (client crash, force quit, etc)

async function sweepStaleSessions() {
    const now = Date.now()
    let touched = false
    for (const [sk, sess] of Object.entries(activeSessions)) {
        if (now - sess.startTime < MAX_SESSION_AGE_MS) continue
        delete activeSessions[sk]
        touched = true
        try {
            await activityStore.updateLog(sk.split("_")[0], sess.logId, {
                title: sess.metadata?.channel ? `Was in #${sess.metadata.channel}` : "Session ended",
                body: "session ended unexpectedly (no close event received)",
                metadata: { ...sess.metadata, duration: formatDuration(now - sess.startTime), startTime: sess.startTime, endTime: now },
            })
        } catch { }
    }
    if (touched) scheduleSessionSave()
}

let pluginStartedAt = 0

let pollTimer:  ReturnType<typeof setInterval> | null = null
let pluginActive = false

function tryLoadLoggedMsgs() {
    try {
        const plugin = (Vencord as any)?.Plugins?.plugins?.["vc-message-logger-enhanced"]
            ?? (Vencord as any)?.Plugins?.plugins?.["MessageLoggerEnhanced"]
            ?? (Vencord as any)?.Plugins?.plugins?.["messageLoggerEnhanced"]
        if (plugin?.loggedMessages) return plugin.loggedMessages
        if (plugin?.store?.loggedMessages) return plugin.store.loggedMessages
    } catch { }

    try {
        const { wreq } = (window as any).webpackChunkdiscord_app?.find?.(
            (x: any) => x?.[1]?.["loggedMessages"]
        )?.[1] ?? {}
        if (wreq?.["loggedMessages"]) return wreq["loggedMessages"]
    } catch { }

    return null
}

const settings = definePluginSettings({
    watchlist:          { type: OptionType.STRING,  hidden: true,  default: "[]",    description: "watchlist json - managed by the ui, don't touch" },
    globalPresetMode:   { type: OptionType.STRING,  hidden: true,  default: "custom",               description: "global preset mode" },
    installedSha:       { type: OptionType.STRING,  hidden: true,  default: "none",  description: "installed commit sha" },
    globalMsgs:         { type: OptionType.BOOLEAN, default: true,                   description: "messages" },
    globalEdits:        { type: OptionType.BOOLEAN, default: true,                   description: "edits" },
    globalDeletes:      { type: OptionType.BOOLEAN, default: true,                   description: "deletes (needs msg-logger-enhanced)" },
    globalTyping:       { type: OptionType.BOOLEAN, default: true,                   description: "typing" },
    globalProfile:      { type: OptionType.BOOLEAN, default: true,                   description: "profile changes" },
    globalAvatar:       { type: OptionType.BOOLEAN, default: true,                   description: "avatar changes" },
    globalVoice:        { type: OptionType.BOOLEAN, default: true,                   description: "voice" },
    globalStatus:       { type: OptionType.BOOLEAN, default: false,                  description: "status (spammy)" },
    globalActivity:     { type: OptionType.BOOLEAN, default: false,                  description: "activity changes (spammy)" },
    globalJoins:        { type: OptionType.BOOLEAN, default: true,                   description: "server joins/leaves" },
    showPreview:        { type: OptionType.BOOLEAN, default: true,                   description: "show message preview" },
    previewLen:         { type: OptionType.NUMBER,  default: 120,                  description: "preview length (0 = unlimited)" },
    quietHours:         { type: OptionType.BOOLEAN, default: false,                  description: "quiet hours" },
    quietStart:         { type: OptionType.STRING,  default: "23:00",                description: "quiet hours start (24h, e.g. 23:00)" },
    quietEnd:           { type: OptionType.STRING,  default: "07:00",                description: "quiet hours end (24h, e.g. 07:00)" },
    skipCurrentChannel: { type: OptionType.BOOLEAN, default: true,                   description: "skip if already in that channel" },
    maxLogsPerUser:     { type: OptionType.NUMBER,  default: 500,                    description: "max logs per user (0 = unlimited)" },
    pinnedUsers:        { type: OptionType.STRING,  hidden: true,  default: "[]",    description: "pinned watchlist user ids" },
    compactLogView:     { type: OptionType.BOOLEAN, default: false,                  description: "compact activity log cards" },
    autoCleanupLogs:    { type: OptionType.BOOLEAN, default: true,                   description: "delete logs when removing a user from watchlist" },
    debugLog:           { type: OptionType.BOOLEAN, default: false,                  description: "debug logging" },
    showToolbarIcon:    { type: OptionType.BOOLEAN, default: true,                   description: "toolbar icon" },
    logVcMembers:       { type: OptionType.BOOLEAN, default: false,                  description: "also log names of other people in the voice channel (privacy: logs non-watched users too)" },
})

function trunc(s: string, max: number) {
    return max > 0 && s.length > max ? s.slice(0, max) + "…" : s
}

function msgPreview(content: string, filename?: string) {
    if (!settings.store.showPreview) return "click to jump"
    return trunc(content || filename || "click to jump", settings.store.previewLen)
}

function jumpTo(guildId?: string, channelId?: string, msgId?: string) {
    if (guildId)   findByProps("transitionToGuildSync")?.transitionToGuildSync(guildId)
    if (channelId) findByProps("selectChannel")?.selectChannel({ guildId: guildId ?? "@me", channelId, messageId: msgId })
}

// wipes all per-user caches when someone is removed from the watchlist -
// otherwise re-adding compares against a stale baseline
function purgeUserCaches(uid: string) {
    delete profileCache[uid]
    delete vcCache[uid]
    delete statusCache[uid]
    delete activityCache[uid]
    delete guildCache[uid]
    delete vcJoinTime[uid]
    delete clientCache[uid]
    delete cameraCache[uid]
    delete streamCache[uid]
    delete customStatusCache[uid]
    delete statusSessionCache[uid]
    // sessionKey always prefixes with "uid_", safe to match on that
    for (const k of Object.keys(activeSessions)) {
        if (k === uid || k.startsWith(`${uid}_`)) delete activeSessions[k]
    }
    scheduleSessionSave()
    for (const k of Object.keys(_logDebounce)) {
        if (k.includes(uid)) delete _logDebounce[k]
    }
}

function getPinned(): string[] {
    try { return JSON.parse(settings.store.pinnedUsers || "[]") } catch { return [] }
}
function togglePin(uid: string) {
    const cur = getPinned()
    const next = cur.includes(uid) ? cur.filter(id => id !== uid) : [...cur, uid]
    settings.store.pinnedUsers = JSON.stringify(next)
}

function isFeatureOn(uid: string, userKey: keyof WatchedUser["overrides"], globalKey: string): boolean {
    if (!isWatched(settings, uid)) return false
    const mode = settings.store.globalPresetMode ?? "custom"
    if (mode !== "custom") {
        if (mode === "silent") return false
        if (mode === "stalker") return true
        if (mode === "lite") {
            const liteFeatures = ["msgs", "deletes", "typing", "avatar", "voice", "status"]
            return liteFeatures.includes(userKey as string)
        }
    }
    return featureOn(settings, uid, userKey, globalKey)
}

const _notifDebounce: Record<string, number> = {}
const _logDebounce: Record<string, number> = {}
const presenceDebounce = new Map<string, ReturnType<typeof setTimeout>>()

const STATUS_LABEL: Record<string, string> = { online: "Online", idle: "Away", dnd: "Do Not Disturb", offline: "Offline", invisible: "Invisible" }
const ACT_VERB: Record<number, string> = { 0: "playing", 2: "listening to", 3: "watching", 5: "competing in" }
const isOfflineStatus = (s: string) => s === "offline" || s === "invisible"

function notify(opts: { title: string; body: string; icon?: string; onClick?: () => void; _uid?: string }) {
    if (inQuietHours(settings)) return
    if (settings.store.globalPresetMode === "silent") return

    // title already has the name baked in, unique per user
    const key = `${opts._uid ?? opts.title}\x00${opts.title}\x00${opts.body}`
    const now = Date.now()
    if (_notifDebounce[key] && now - _notifDebounce[key] < 1500) return
    _notifDebounce[key] = now

    // sweep stale entries so this doesn't grow forever over a long session
    if (Object.keys(_notifDebounce).length > 500) {
        for (const k of Object.keys(_notifDebounce)) {
            if (now - _notifDebounce[k] > 60000) delete _notifDebounce[k]
        }
    }

    if (settings.store.debugLog) log.info(`[notif] ${opts.title} - ${opts.body}`)
    Notifications.showNotification({ title: opts.title, body: opts.body, icon: opts.icon, onClick: opts.onClick })
}

function avatarUrl(id: string, hash?: string | null, size = 80): string {
    try {
        if (hash) return `https://cdn.discordapp.com/avatars/${id}/${hash}.${hash.startsWith("a_") ? "gif" : "webp"}?size=${size}`
        let i = 0
        try { i = Number((BigInt(id) >> 22n) % 6n) } catch { i = parseInt(id.slice(-4), 10) % 6 || 0 }
        return `https://cdn.discordapp.com/embed/avatars/${i}.png`
    } catch { return "https://cdn.discordapp.com/embed/avatars/0.png" }
}

function guildName(guildId?: string | null): string | null {
    if (!guildId) return null
    return findByProps("getGuild")?.getGuild(guildId)?.name ?? null
}

const FALLBACK_AV = "https://cdn.discordapp.com/embed/avatars/0.png"

const PROFILE_TEXT = ["username", "globalName", "bio", "banner", "pronouns"] as const
const FIELD_NAME: Record<string, string> = {
    username: "username", globalName: "display name",
    bio: "about me", banner: "banner", pronouns: "pronouns",
}
const PROFILE_TYPE_MAP: Record<string, ActivityType> = {
    username: "username",
    globalName: "displayname",
    bio: "bio",
    banner: "banner",
    pronouns: "pronouns",
}
const PROFILE_ICON_MAP: Record<string, string> = {
    username: "🏷️",
    globalName: "📛",
    bio: "📝",
    banner: "🏳️",
    pronouns: "🪪",
}

function checkProfileChanged(uid: string, fresh: any) {
    if (!isWatched(settings, uid)) return
    const old = profileCache[uid]
    if (!old) {
        profileCache[uid] = fresh
        return
    }

    // avatar - separate feature flag
    const oldAvatar = old.user?.avatar ?? old.user?.avatarUrl ?? null
    const newAvatar = fresh.user?.avatar ?? fresh.user?.avatarUrl ?? null
    if (newAvatar !== oldAvatar) {
        if (isFeatureOn(uid, "avatar", "globalAvatar")) {
            const name  = displayName(fresh.user)
            const label = getWatchedUser(settings, uid)?.nick
            const dn    = label ? `${label} (${name})` : name
            const oldAvatarUrl = oldAvatar ? avatarUrl(uid, oldAvatar, 256) : null
            const newAvatarUrl = newAvatar ? avatarUrl(uid, newAvatar, 256) : null
            notify({
                _uid: uid,
                title: newAvatar ? `${dn} changed their avatar` : `${dn} removed their avatar`,
                body: newAvatar ? "click to see new pfp" : "reset to default",
                icon: newAvatarUrl ?? undefined,
                onClick: () => openUserProfile(uid),
            })
            logUserActivity(uid, "avatar", "🖼️",
                newAvatar ? `changed their avatar` : `removed their avatar`,
                "",
                { metadata: { oldAvatar: oldAvatarUrl, newAvatar: newAvatarUrl } }
            ).catch(() => {})
        }
    }

    // text profile fields - one log per changed field
    if (isFeatureOn(uid, "profile", "globalProfile")) {
        const u     = UserStore.getUser(uid)
        const name  = displayName(fresh.user)
        const label = getWatchedUser(settings, uid)?.nick
        const dn    = label ? `${label} (${name})` : name
        const icon  = u ? avatarUrl(u.id, (u as any).avatar) : undefined

        for (const f of PROFILE_TEXT) {
            // pronouns sits at root, not under user
            const rawOld = f === "pronouns"
                ? (old.pronouns ?? old.user?.pronouns ?? null)
                : (old.user?.[f] ?? null)
            const rawNew = f === "pronouns"
                ? (fresh.pronouns ?? fresh.user?.pronouns ?? null)
                : (fresh.user?.[f] ?? null)
            const oldVal = rawOld === "" ? null : rawOld
            const newVal = rawNew === "" ? null : rawNew
            if (oldVal === newVal) continue

            const fieldLabel = FIELD_NAME[f] ?? f
            const actType    = PROFILE_TYPE_MAP[f] ?? "profile"
            const actIcon    = PROFILE_ICON_MAP[f] ?? "👤"

            const notifyBody = newVal
                ? (oldVal ? `${oldVal} → ${newVal}` : newVal)
                : `removed ${fieldLabel}`

            notify({
                _uid: uid,
                title: `${dn} changed their ${fieldLabel}`,
                body: notifyBody,
                icon,
                onClick: () => openUserProfile(uid),
            })
            logUserActivity(uid, actType, actIcon,
                `changed their ${fieldLabel}`,
                "",  // shown via diff card instead
                { metadata: { field: f, before: oldVal, after: newVal } }
            ).catch(() => {})
        }
    }

    profileCache[uid] = fresh
}

let _pollRunning = false
// fetches profile/status/activity right away for one freshly-added user instead
// of waiting for the next 5-minute poll cycle to reach them
async function fetchNewUserBaseline(uid: string) {
    if (!pluginActive) return
    try {
        const presMod = findByProps("getStatus", "getActivities")
        const status = presMod?.getStatus?.(uid)
        if (status) statusCache[uid] = status
        const acts: any[] = presMod?.getActivities?.(uid) ?? []
        // must match actKeyOf()'s shape exactly (array of keys) - PRESENCE_UPDATES does
        // `oldActKeys.includes(k)` and `for (const k of oldActKeys)` on this cache. a bare
        // string here gets iterated char-by-char and substring-matched instead of key-matched,
        // which fires garbage "stopped playing" notifs on the very next real presence tick.
        const realActs = acts.filter((a: any) => a.type !== 4)
        activityCache[uid] = realActs.map((a: any) => a.type === 2
            ? `2\x00${a.name}\x00${a.details || ""}\x00${a.state || ""}`
            : `${a.type}\x00${a.name}`)
        const customAct = acts.find((a: any) => a.type === 4) ?? null
        customStatusCache[uid] = customAct
            ? [customAct.emoji?.name, customAct.state].filter(Boolean).join(" ") || null
            : null
        guildCache[uid] = new Set()

        const { body } = await RestAPI.get({
            url: `/users/${uid}/profile`,
            query: { with_mutual_guilds: true, with_mutual_friends_count: false },
        })
        const data = camelize(body)
        profileCache[uid] = data
        if (Array.isArray(data.mutualGuilds)) {
            guildCache[uid] = new Set(data.mutualGuilds.map((g: any) => g.id))
        }
    } catch { }
}

async function pollProfiles() {
    if (_pollRunning || !pluginActive) return
    _pollRunning = true
    const list = getWatchlist(settings)
    try {
        await sweepStaleSessions()
        for (const wu of list) {
            if (!pluginActive) break
            try {
                const { body } = await RestAPI.get({
                    url: `/users/${wu.id}/profile`,
                    query: { with_mutual_guilds: false, with_mutual_friends_count: false },
                })
                checkProfileChanged(wu.id, camelize(body))
            } catch { }
            await new Promise(r => setTimeout(r, 1500))
        }
    } finally {
        _pollRunning = false
    }
}

const STYLE_ID = "ur-s9"
function injectStyles() {
    if (document.getElementById(STYLE_ID)) return
    const s = document.createElement("style")
    s.id = STYLE_ID
    s.textContent = `
        @keyframes ur-spin { to { transform:rotate(360deg) } }
        .ur-spin { display:inline-block;width:14px;height:14px;border-radius:50%;
            border:2.5px solid #3f4147;border-top-color:#dbdee1;
            animation:ur-spin .55s linear infinite;vertical-align:middle; }
        @keyframes ur-fade-in { from { opacity:0;transform:translateY(-4px) } to { opacity:1;transform:translateY(0) } }
        .ur-fade-in { animation:ur-fade-in .2s cubic-bezier(.4,0,.2,1) forwards; }
        .ur-expand { display:grid;grid-template-rows:0fr;transition:grid-template-rows .3s cubic-bezier(.4,0,.2,1); }
        .ur-expand.open { grid-template-rows:1fr; }
        .ur-expand > div { overflow:hidden; }
        .ur-row-hover:hover { background:rgba(255,255,255,0.06); }

        @keyframes ur-row-in { from { opacity:0; transform:translateY(6px) scale(.98); } to { opacity:1; transform:translateY(0) scale(1); } }
        .ur-row { animation: ur-row-in .28s cubic-bezier(.2,.9,.3,1.2) both; transition: transform .2s cubic-bezier(.2,.8,.2,1.1), box-shadow .2s ease, background .2s ease, border-color .18s ease; }
        .ur-row:hover { transform: translateY(-3px) scale(1.008); box-shadow: 0 14px 30px rgba(0,0,0,0.38); border-color: #3f4147; background: linear-gradient(135deg, rgba(0,0,0,0.22) 0%, rgba(0,0,0,0.1) 100%) !important; }
        .ur-row:active { transform: translateY(-1px) scale(.995); }
        .ur-row.open { box-shadow: 0 8px 22px rgba(0,0,0,0.3); }

        .ur-row-avatar { transition: transform .2s cubic-bezier(.2,.8,.2,1.4); }
        .ur-row:hover .ur-row-avatar { transform: scale(1.08); }

        .ur-row-pin { transition: opacity .12s ease, color .12s ease, transform .22s cubic-bezier(.34,1.56,.64,1); }
        .ur-row:hover .ur-row-pin { transform: scale(1.12); }

        .ur-row-chevron { display:flex; align-items:center; justify-content:center; color:#949ba4; flex-shrink:0; opacity:.55; transition: transform .28s cubic-bezier(.4,0,.2,1), opacity .18s ease, color .18s ease; }
        .ur-row:hover .ur-row-chevron { opacity:1; transform: scale(1.15); }
        .ur-row-chevron.open { transform: rotate(180deg); opacity:1; color:#949cf4; }
        .ur-row:hover .ur-row-chevron.open { transform: rotate(180deg) scale(1.15); }

        .ur-badge-in { animation: ur-badge-in .25s cubic-bezier(.34,1.56,.64,1) both; transition: transform .18s cubic-bezier(.2,.8,.2,1.3); }
        .ur-row:hover .ur-badge-in { transform: scale(1.07); }

        .ur-activity-btn { transition: transform .22s cubic-bezier(.34,1.56,.64,1), background .18s ease, border-color .18s ease, box-shadow .22s ease; backdrop-filter: blur(8px) saturate(160%); -webkit-backdrop-filter: blur(8px) saturate(160%); }
        .ur-activity-btn:hover { transform: translateY(-2px) scale(1.06); background: rgba(88,101,242,0.18) !important; border-color: rgba(88,101,242,0.5) !important; box-shadow: 0 6px 16px rgba(88,101,242,0.28); }
        .ur-activity-btn:active { transform: translateY(0) scale(.95); }

        @keyframes ur-pin-pop { 0% { transform:scale(.6) rotate(-20deg); } 60% { transform:scale(1.25) rotate(6deg); } 100% { transform:scale(1) rotate(0); } }
        .ur-pin-pop { animation: ur-pin-pop .38s cubic-bezier(.34,1.56,.64,1) both; }

        .ur-chip { transition: transform .12s cubic-bezier(.2,.8,.2,1), background .18s ease, color .18s ease; }
        .ur-chip:active { transform: scale(.94); }

        @keyframes ur-badge-in { from { opacity:0; transform:scale(.5); } to { opacity:1; transform:scale(1); } }
        .ur-badge-in { animation: ur-badge-in .25s cubic-bezier(.34,1.56,.64,1) both; }

        .ur-icon-btn { transition: transform .14s cubic-bezier(.2,.8,.2,1.3), background .14s ease, color .14s ease; }
        .ur-icon-btn:hover { transform: translateY(-1px) scale(1.08); }
        .ur-icon-btn:active { transform: scale(.9); }

        @keyframes ur-float { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-6px); } }
        .ur-float { animation: ur-float 3s ease-in-out infinite; }

        /* Discord-style thin scrollbar - only visible on hover */
        .ur-scrollbar::-webkit-scrollbar { width:4px; height:4px; }
        .ur-scrollbar::-webkit-scrollbar-track { background:transparent; }
        .ur-scrollbar::-webkit-scrollbar-thumb { background:transparent; border-radius:4px; }
        .ur-scrollbar:hover::-webkit-scrollbar-thumb { background:#3f4147; }
        .ur-scrollbar::-webkit-scrollbar-thumb:hover { background:#4a4a6e; }

        /* Firefox scrollbar */
        .ur-scrollbar { scrollbar-width: thin; scrollbar-color: transparent transparent; }
        .ur-scrollbar:hover { scrollbar-color: #3f4147 transparent; }

        .ur-typing-dot { animation: ur-typing 1.4s infinite ease-in-out both; }
        .ur-typing-dot:nth-child(1) { animation-delay: -0.32s; }
        .ur-typing-dot:nth-child(2) { animation-delay: -0.16s; }
        @keyframes ur-typing { 0%, 80%, 100% { transform: scale(0); } 40% { transform: scale(1); } }
        @keyframes ur-shake { 0%, 100% { transform: translateX(0); } 10%, 30%, 50%, 70%, 90% { transform: translateX(-4px); } 20%, 40%, 60%, 80% { transform: translateX(4px); } }
        .ur-shake { animation: ur-shake 0.5s cubic-bezier(.36,.07,.19,.97) both; }
        @keyframes ur-pulse { 0% { box-shadow: 0 0 0 0 #5865f2; } 70% { box-shadow: 0 0 0 6px transparent; } 100% { box-shadow: 0 0 0 0 transparent; } }
        .ur-pulse { animation: ur-pulse 2s infinite; }
        @keyframes ur-flash-green { 0% { background: #248046; } 100% { background: #5865f2; } }
        .ur-flash-green { animation: ur-flash-green 0.5s ease; }
        @keyframes ur-blink-dot { 0%, 100% { opacity: 1; transform: scale(1); } 50% { opacity: 0.25; transform: scale(0.7); } }
        .ur-blink-dot { animation: ur-blink-dot 1.4s ease-in-out infinite; }

        .ur-compact [data-ur-card-body] { padding: 6px 10px !important; gap: 8px !important; margin-bottom: 3px !important; min-height: 0 !important; border-radius: 10px !important; }
        .ur-compact [data-ur-card-icon] { width: 22px !important; height: 22px !important; border-radius: 6px !important; font-size: 12px !important; margin-top: 0 !important; }
        .ur-compact [data-ur-card-icon] img { width: 14px !important; height: 14px !important; }
        .ur-compact [data-ur-card-title] { font-size: 12px !important; margin-bottom: 0 !important; gap: 5px !important; }
        .ur-compact [data-ur-card-body-text="meta"] { display: none !important; }
        .ur-compact [data-ur-card-body-text="content"] { font-size: 11px !important; margin-top: 0 !important; -webkit-line-clamp: 1; display: -webkit-box !important; -webkit-box-orient: vertical; overflow: hidden; }
        .ur-compact [data-ur-card-location] { display: none !important; }
        .ur-compact [data-ur-card-live] { padding: 1px 5px !important; font-size: 8px !important; margin-bottom: 0 !important; }
        .ur-compact { gap: 4px !important; }
        .ur-compact [data-ur-day-header] { margin-bottom: 3px !important; }

        /* Activity log modal specific - prevent horizontal scroll */
        .ur-activity-modal { overflow-x: hidden !important; }
        .ur-activity-modal * { max-width: 100%; box-sizing: border-box; }

        /* glassmorphism helpers */
        .ur-glass { backdrop-filter: blur(14px) saturate(160%); -webkit-backdrop-filter: blur(14px) saturate(160%); }
        .ur-badge-glass { backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px); }

        .ur-tab-btn { transition: transform 160ms cubic-bezier(.34,1.56,.64,1), background 200ms ease, color 200ms ease, box-shadow 200ms ease; }
        .ur-tab-btn:hover { transform: translateY(-1px) scale(1.03); }
        .ur-tab-btn:active { transform: scale(.95); }

        .ur-preset-card { transition: transform 200ms cubic-bezier(.34,1.56,.64,1), background 220ms ease, border-color 220ms ease, box-shadow 220ms ease; }
        .ur-preset-card:hover { transform: translateY(-2px) scale(1.015); }
        .ur-preset-card:active { transform: translateY(0) scale(.985); }

        @keyframes ur-modal-in { from { opacity:0; transform:scale(.97) translateY(8px); } to { opacity:1; transform:scale(1) translateY(0); } }
        .ur-modal-in { animation: ur-modal-in .28s cubic-bezier(.2,.9,.3,1.1) both; }

        @keyframes ur-status-pop { from { opacity:0; transform:scale(.4); } to { opacity:1; transform:scale(1); } }
        .ur-status-dot { animation: ur-status-pop .3s cubic-bezier(.34,1.56,.64,1) both; transition: background 200ms ease, box-shadow 200ms ease; }

        .ur-card-hover { transition: transform 180ms cubic-bezier(.2,.8,.2,1), box-shadow 180ms ease, border-color 180ms ease, background 180ms ease; }
        .ur-card-hover:hover { transform: translateY(-2px); box-shadow: 0 6px 18px rgba(0,0,0,0.3); }

        @keyframes ur-log-in { from { opacity:0; transform:translateY(6px) scale(.98); } to { opacity:1; transform:translateY(0) scale(1); } }
        .ur-log-card { animation: ur-log-in .26s cubic-bezier(.2,.9,.3,1.15) both; transition: transform .2s cubic-bezier(.2,.8,.2,1.1), box-shadow .2s ease, background .2s ease, border-color .18s ease; }
        .ur-log-card:hover { transform: translateY(-3px) scale(1.008); box-shadow: 0 14px 30px rgba(0,0,0,0.38); border-color: #3f4147; background: linear-gradient(135deg, rgba(0,0,0,0.22) 0%, rgba(0,0,0,0.1) 100%) !important; }
        .ur-log-card:active { transform: translateY(-1px) scale(.995); }
        .ur-log-card.open { box-shadow: 0 8px 22px rgba(0,0,0,0.3); }

        .ur-log-icon { transition: transform .22s cubic-bezier(.2,.8,.2,1.4), box-shadow .22s ease; }
        .ur-log-card:hover .ur-log-icon { transform: scale(1.08) rotate(-4deg); }

        .ur-log-chevron { display:flex; align-items:center; justify-content:center; color:#949ba4; flex-shrink:0; opacity:.55; transition: transform .28s cubic-bezier(.4,0,.2,1), opacity .18s ease, color .18s ease; }
        .ur-log-card:hover .ur-log-chevron { opacity:1; }
        .ur-log-chevron.open { transform: rotate(180deg); opacity:1; color:#949cf4; }

        .ur-log-expand-in { animation: ur-fade-in .22s cubic-bezier(.4,0,.2,1) both; }

        .ur-footer-btn { transition: transform .2s cubic-bezier(.34,1.56,.64,1), background .18s ease, border-color .18s ease, box-shadow .2s ease, color .18s ease; backdrop-filter: blur(10px) saturate(160%); -webkit-backdrop-filter: blur(10px) saturate(160%); }
        .ur-footer-btn:hover { transform: translateY(-2px) scale(1.04); background: rgba(255,255,255,0.09) !important; border-color: #3f4147 !important; box-shadow: 0 6px 16px rgba(0,0,0,0.3); }
        .ur-footer-btn:active { transform: translateY(0) scale(.94); }
        .ur-footer-btn-danger:hover { background: rgba(218,55,60,0.2) !important; border-color: #da373c !important; box-shadow: 0 6px 16px rgba(218,55,60,0.3); }
        .ur-footer-btn-primary:hover { background: #5865f2 !important; border-color: #5865f2 !important; color: #fff !important; box-shadow: 0 6px 18px rgba(88,101,242,0.4); }
    `
    document.head.appendChild(s)
}

const CLIENT_EMOJI: Record<string, string> = {
    desktop:  "💻",
    mobile:   "📱",
    web:      "🌐",
    embedded: "🎮",
    vr:       "🥽",
}

function resolveClient(cs?: Record<string, string> | null): string | null {
    if (!cs) return null
    // priority order for the "primary" platform
    if (cs.mobile)   return "mobile"
    if (cs.desktop)  return "desktop"
    if (cs.web)      return "web"
    if (cs.embedded) return "embedded"
    if (cs.vr)       return "vr"
    const first = Object.keys(cs).find(k => cs[k])
    return first ?? null
}

// returns every active platform, not just one - display only
function resolveAllClients(cs?: Record<string, string> | null): string[] {
    if (!cs) return []
    return Object.keys(cs).filter(k => cs[k])
}

const CLIENT_LABEL_MAP: Record<string, string> = { desktop: "Desktop", mobile: "Mobile", web: "Web", embedded: "Console", vr: "VR" }
function platformSuffixLog(uid: string): string {
    const c = clientCache[uid]
    if (!c) return ""
    return ` · on ${CLIENT_EMOJI[c] || "📡"} ${CLIENT_LABEL_MAP[c] || c}`
}

const C = {
    bg1:         "#1e1f22",
    bg2:         "#2b2d31",
    bg3:         "#313338",
    bgEl:        "#3f4147",
    border:      "#3f4147",
    hov:         "rgba(255,255,255,0.06)",
    header:      "#f2f3f5",
    subheader:   "#b5bac1",
    text:        "#dbdee1",
    muted:       "#949ba4",
    danger:      "#fa777c",
    brand:       "#5865f2",
    brandLight:  "#949cf4",
    brandGrad:   "linear-gradient(135deg, #5865f2 0%, #949cf4 100%)",
    green:       "#248046",
    red:         "#da373c",
    white:       "#ffffff",
    expanded:    "#232428",
} as const

const ico = {
    search:   () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>,
    check:    () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M20 6 9 17l-5-5" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/></svg>,
    x:        () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M18 6 6 18M6 6l12 12" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/></svg>,
    chevron:  () => <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M7.41 8.59 12 13.17l4.59-4.58L18 10l-6 6-6-6z"/></svg>,
    trash:    () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6h14zM10 11v6M14 11v6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>,
    copy:     () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><rect x="9" y="9" width="13" height="13" rx="2" stroke="currentColor" strokeWidth="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" stroke="currentColor" strokeWidth="2"/></svg>,
    external: () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>,
    sortAz:   () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M3 6h12M3 12h8M3 18h4M16 8l4-4 4 4M20 4v16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>,
    sortDate: () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2"/><path d="M12 6v6l4 2" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>,
    eye:      () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={C.white} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3" fill={C.white} stroke="none"/><path d="M12 2v2M12 20v2" strokeWidth="1.5" opacity="0.5"/></svg>,
    ghost:    () => <svg width="48" height="48" viewBox="0 0 24 24" fill="currentColor" opacity=".25"><path d="M12 2a9 9 0 0 0-9 9v7c0 1.66 1.34 3 3 3h3v-4h6v4h3c1.66 0 3-1.34 3-3v-7a9 9 0 0 0-9-9zm-3 8a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm6 0a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3z"/></svg>,
    msg:      () => <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M2 22V4a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6l-4 4z"/></svg>,
    edit:     () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M12 20h9" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>,
    del:      () => <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M15 3v-1a2 2 0 0 0-2-2h-2a2 2 0 0 0-2 2v1H3v2h2v13a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V5h2V3h-6zm-4-1h2v1h-2V2zm-2 5h2v9h-2V7zm4 0h2v9h-2V7z"/></svg>,
    typing:   () => <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><circle cx="4" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="20" cy="12" r="2"/></svg>,
    profile:  () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/><circle cx="12" cy="7" r="4" stroke="currentColor" strokeWidth="2"/></svg>,
    avatar:   () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><rect x="3" y="3" width="18" height="18" rx="4" stroke="currentColor" strokeWidth="2"/><circle cx="12" cy="10" r="3" stroke="currentColor" strokeWidth="2"/><path d="M7 21c0-2.76 2.24-5 5-5s5 2.24 5 5" stroke="currentColor" strokeWidth="2"/></svg>,
    voice:    () => <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z"/><path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/></svg>,
    status:   () => <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="10" opacity=".3"/><circle cx="12" cy="12" r="5"/></svg>,
    activity: () => <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M21 6H3c-1.1 0-2 .9-2 2v8c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2zm-10 7H8v3H6v-3H3v-2h3V8h2v3h3v2zm4.5 2c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zm4-3c-.83 0-1.5-.67-1.5-1.5S18.67 9 19.5 9s1.5.67 1.5 1.5-.67 1.5-1.5 1.5z"/></svg>,
    joins:    () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" stroke="currentColor" strokeWidth="2"/><circle cx="8.5" cy="7" r="4" stroke="currentColor" strokeWidth="2"/><path d="M20 8v6M23 11h-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>,
    history:  () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>,
    preview:  () => <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>,
    catMsg:       () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>,
    catEdit:      () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4L18.5 2.5z"/></svg>,
    catDelete:    () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>,
    catTyping:    () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="6" x2="20" y2="6"/><line x1="4" y1="18" x2="20" y2="18"/></svg>,
    catStatus:    () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" opacity="0.35"/><circle cx="12" cy="12" r="4" fill="currentColor"/></svg>,
    catVoice:     () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/></svg>,
    catProfile:   () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>,
    catActivity:  () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>,

    location: () => <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>,
    clock:    () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>,
    download: () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>,
    pin:      () => <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="1"><path d="M16 3l5 5-5.5 5.5L17 17l-2 2-4.5-4.5L5 20l-1-1 5.5-5.5L5 9l2-2 3.5 3.5L16 3z"/></svg>,
    pinOutline: () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 3l5 5-5.5 5.5L17 17l-2 2-4.5-4.5L5 20l-1-1 5.5-5.5L5 9l2-2 3.5 3.5L16 3z"/></svg>,
    compact:  () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="4" y1="7" x2="20" y2="7"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="17" x2="20" y2="17"/></svg>,
    upload:   () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>,
    clear:    () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>,
    calendar: () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>,

}

// per-event icon + color for activity log cards
const actIco = {
    message:   { color: "#5865f2", Icon: () => <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M2 22V4a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6l-4 4z"/></svg> },
    edit:      { color: "#f0b232", Icon: () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg> },
    delete:    { color: "#da373c", Icon: () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg> },
    typing:    { color: "#949cf4", Icon: () => <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><circle cx="4" cy="12" r="2.2"/><circle cx="12" cy="12" r="2.2"/><circle cx="20" cy="12" r="2.2"/></svg> },

    listening: { color: "#c586f5", Icon: () => <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M9 18a3 3 0 1 1-3-3h1V5.5a1 1 0 0 1 .8-.98l9-2a1 1 0 0 1 1.2.98v9a3 3 0 1 1-2-2.83V6.7l-7 1.56V15a3 3 0 0 1-3 3v0z"/></svg> },
    watching:  { color: "#9146ff", Icon: () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="4" width="20" height="15" rx="2"/><path d="M8 21h8M12 19v2"/></svg> },
    playing:   { color: "#f0b232", Icon: () => <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M6 9h4v2H8v2H6v-2H4V9h2V7h2v2zm9.5 3a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm3-4a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zM17 3H7a5 5 0 0 0-5 5v6a5 5 0 0 0 5 5h.5a3 3 0 0 0 2.4-1.2l1.4-1.87a2 2 0 0 1 3.4 0l1.4 1.87A3 3 0 0 0 16.5 19H17a5 5 0 0 0 5-5V8a5 5 0 0 0-5-5z"/></svg> },
    streaming: { color: "#da373c", Icon: () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/><circle cx="12" cy="10" r="1.5" fill="currentColor" stroke="none"/></svg> },
    camera:    { color: "#23a55a", Icon: () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M23 7l-7 5 7 5V7z"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg> },
    screen:    { color: "#ff5e5e", Icon: () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="4" width="20" height="13" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/><polyline points="8 12 11 9 13 11 16 8"/></svg> },

    voice:     { color: "#23a55a", Icon: () => <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z"/><path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/></svg> },
    vcMove:    { color: "#dbdee1", Icon: () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg> },

    online:    { color: "#23a55a", Icon: () => <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="9"/></svg> },
    idle:      { color: "#f0b232", Icon: () => <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M12 3a9 9 0 1 0 9 9c0-.46-.04-.92-.1-1.36A5.389 5.389 0 0 1 17.5 12c-3.03 0-5.5-2.47-5.5-5.5 0-1.33.47-2.55 1.26-3.5A9.04 9.04 0 0 0 12 3z"/></svg> },
    dnd:       { color: "#da373c", Icon: () => <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="9"/><rect x="7.5" y="10.8" width="9" height="2.4" rx="1.2" fill="#1e1f22"/></svg> },
    offline:   { color: "#80848e", Icon: () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="9"/></svg> },
    status:    { color: "#23a55a", Icon: () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" opacity="0.35"/><circle cx="12" cy="12" r="4.5" fill="currentColor"/></svg> },
    customStatus: { color: "#949cf4", Icon: () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><circle cx="9" cy="10" r="1" fill="currentColor" stroke="none"/><circle cx="15" cy="10" r="1" fill="currentColor" stroke="none"/></svg> },

    profile:   { color: "#ff6b6b", Icon: () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg> },
    avatar:    { color: "#ff6b6b", Icon: () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="4"/><circle cx="12" cy="10" r="3"/><path d="M7 21c0-2.76 2.24-5 5-5s5 2.24 5 5"/></svg> },
    banner:    { color: "#ff6b6b", Icon: () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="6" width="20" height="12" rx="2"/><path d="M2 10h20"/></svg> },
    bio:       { color: "#ff6b6b", Icon: () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="7" y1="8" x2="17" y2="8"/><line x1="7" y1="12" x2="17" y2="12"/><line x1="7" y1="16" x2="13" y2="16"/></svg> },
    username:  { color: "#ff6b6b", Icon: () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20.59 13.41 13.42 20.58a2 2 0 0 1-2.83 0L2.5 12.5V2.5h10z"/><circle cx="6.5" cy="6.5" r="1.5" fill="currentColor" stroke="none"/></svg> },
    pronouns:  { color: "#ff6b6b", Icon: () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><line x1="8" y1="9" x2="16" y2="9"/><line x1="8" y1="13" x2="14" y2="13"/><line x1="8" y1="17" x2="12" y2="17"/></svg> },

    join:      { color: "#23a55a", Icon: () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><path d="M20 8v6M23 11h-6"/></svg> },
    leave:     { color: "#da373c", Icon: () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="17" y1="8" x2="23" y2="14"/><line x1="23" y1="8" x2="17" y2="14"/></svg> },

    session:   { color: "#949ba4", Icon: () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg> },
} as const

const CtxEyeIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" style={{ width: 18, height: 18 }}>
        <path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" />
        <path fillRule="evenodd" d="M1.323 11.447C2.811 6.976 7.028 3.75 12.001 3.75c4.97 0 9.185 3.223 10.675 7.69.12.362.12.752 0 1.113-1.487 4.471-5.705 7.697-10.677 7.697-4.97 0-9.186-3.223-10.675-7.69a1.762 1.762 0 0 1 0-1.113ZM17.25 12a5.25 5.25 0 1 1-10.5 0 5.25 5.25 0 0 1 10.5 0Z" clipRule="evenodd" />
    </svg>
)
const CtxEyeOffIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" style={{ width: 18, height: 18 }}>
        <path d="M3.53 2.47a.75.75 0 0 0-1.06 1.06l18 18a.75.75 0 1 0 1.06-1.06l-18-18ZM22.676 12.553a11.249 11.249 0 0 1-2.631 4.31l-3.099-3.099a5.25 5.25 0 0 0-6.71-6.71L7.759 4.577a11.217 11.217 0 0 1 4.242-.827c4.97 0 9.185 3.223 10.675 7.69.12.362.12.752 0 1.113Z" />
        <path d="M15.75 12c0 .18-.013.357-.037.53l-4.244-4.243A3.75 3.75 0 0 1 15.75 12ZM12.53 15.713l-4.243-4.244a3.75 3.75 0 0 0 4.244 4.243Z" />
        <path d="M6.75 12c0-.619.107-1.213.304-1.764l-3.1-3.1a11.25 11.25 0 0 0-2.63 4.31c-.12.362-.12.752 0 1.114 1.489 4.467 5.704 7.69 10.675 7.69 1.5 0 2.933-.294 4.242-.827l-2.477-2.477A5.25 5.25 0 0 1 6.75 12Z" />
    </svg>
)
const CtxGearIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" style={{ width: 18, height: 18 }}>
        <path fillRule="evenodd" d="M2.25 5.25a3 3 0 0 1 3-3h13.5a3 3 0 0 1 3 3V15a3 3 0 0 1-3 3h-3v.257c0 .597.237 1.17.659 1.591l.621.622a.75.75 0 0 1-.53 1.28h-9a.75.75 0 0 1-.53-1.28l.621-.622a2.25 2.25 0 0 0 .659-1.59V18h-3a3 3 0 0 1-3-3V5.25Zm1.5 0v7.5a1.5 1.5 0 0 0 1.5 1.5h13.5a1.5 1.5 0 0 0 1.5-1.5v-7.5a1.5 1.5 0 0 0-1.5-1.5H5.25a1.5 1.5 0 0 0-1.5 1.5Z" clipRule="evenodd" />
    </svg>
)

function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
    return (
        <div
            role="switch" aria-checked={on}
            onClick={() => onChange(!on)}
            style={{
                width: 36, height: 22, borderRadius: 11, flexShrink: 0,
                background: on ? "#5865f2" : "#3f4147",
                cursor: "pointer", position: "relative",
                transition: "background 150ms ease",
            }}
        >
            <div style={{
                position: "absolute", top: 2, left: on ? 16 : 2,
                width: 18, height: 18, borderRadius: "50%",
                background: C.white, boxShadow: "0 1px 3px rgba(0,0,0,0.25)",
                transition: "left 150ms cubic-bezier(0.4,0,0.2,1)",
            }} />
        </div>
    )
}

type LookupStage =
    | { s: "idle" }
    | { s: "loading" }
    | { s: "done"; user: any; av: string }
    | { s: "err"; msg: string }

function timeAgo(ts: number): string {
    const diff = Date.now() - ts
    const d    = new Date(ts)
    const now  = new Date()
    const mins = Math.floor(diff / 60000)
    const isSameDay = d.getDate() === now.getDate() &&
                      d.getMonth() === now.getMonth() &&
                      d.getFullYear() === now.getFullYear()
    const yesterday = new Date(now)
    yesterday.setDate(yesterday.getDate() - 1)
    const isYesterday = d.getDate() === yesterday.getDate() &&
                        d.getMonth() === yesterday.getMonth() &&
                        d.getFullYear() === yesterday.getFullYear()

    if (mins < 1)    return "just now"
    if (mins < 60)   return `${mins}m ago`
    if (isSameDay)   return `${Math.floor(mins / 60)}h ago`
    if (isYesterday) return "Yesterday"
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" })
}

function exactTime(ts: number): string {
    return new Date(ts).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "medium", hour12: true })
}

function decodeSnowflake(id: string) {
    try {
        const snowflake = BigInt(id)
        const timestamp = Number(snowflake >> 22n) + 1420070400000
        const workerId = Number((snowflake >> 17n) & 0x1Fn)
        const processId = Number((snowflake >> 12n) & 0x1Fn)
        const increment = Number(snowflake & 0xFFFn)
        return { timestamp, workerId, processId, increment, date: new Date(timestamp) }
    } catch {
        return null
    }
}

function AddUserInput({ rawId, setRawId, hasErr, lk, setLk, doLookup }: {
    rawId: string
    setRawId: (v: string) => void
    hasErr: boolean
    lk: LookupStage
    setLk: (v: LookupStage) => void
    doLookup: () => void
}) {
    const [focused, setFocused] = React.useState(false)
    const [btnState, setBtnState] = React.useState<"idle" | "valid" | "searching" | "found" | "notfound">("idle")
    const btnRef = React.useRef<HTMLButtonElement>(null)
    const borderColor = hasErr ? C.red : focused ? C.brand : C.border

    React.useEffect(() => {
        const clean = rawId.trim().replace(/\D/g, "")
        if (lk.s === "loading") setBtnState("searching")
        else if (lk.s === "done") {
            setBtnState("found")
            const t = setTimeout(() => setBtnState("idle"), 2000)
            return () => clearTimeout(t)
        }
        else if (lk.s === "err") {
            setBtnState("notfound")
            const t = setTimeout(() => setBtnState("idle"), 3000)
            return () => clearTimeout(t)
        }
        else if (clean.length >= 17 && clean.length <= 20) setBtnState("valid")
        else setBtnState("idle")
    }, [rawId, lk.s])

    const btnStyle: React.CSSProperties = {
        borderRadius: 20,
        height: 40,
        boxSizing: "border-box",
        padding: "0 20px",
        color: "#ffffff",
        border: "none",
        fontSize: 14,
        fontWeight: 600,
        cursor: btnState === "idle" ? "not-allowed" : "pointer",
        flexShrink: 0,
        fontFamily: "inherit",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        transition: "background 200ms ease, opacity 200ms ease",
    }

    const getBtnBg = () => {
        if (btnState === "found") return "#248046"
        if (btnState === "notfound") return "#da373c"
        if (btnState === "searching") return "#4752c4"
        if (btnState === "valid") return "#5865f2"
        return "rgba(255,255,255,0.06)"
    }

    const getBtnText = () => {
        if (btnState === "found") return "Added ✓"
        if (btnState === "notfound") return "Not found"
        if (btnState === "searching") return <><span className="ur-spin" style={{ marginRight: 6 }} />Searching...</>
        return "look up"
    }

    return (
        <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
            <div style={{ flex: 1, minWidth: 0 }}>
                <input
                    placeholder="paste a discord user id"
                    value={rawId}
                    onChange={(e) => { setRawId(e.target.value); if (hasErr) setLk({ s: "idle" }) }}
                    onKeyDown={(e) => { if (e.key === "Enter" && btnState !== "idle") doLookup() }}
                    onFocus={() => setFocused(true)}
                    onBlur={() => setFocused(false)}
                    autoFocus
                    style={{
                        background: "#1e1f22",
                        borderRadius: 20,
                        border: `1px solid ${borderColor}`,
                        height: 40,
                        boxSizing: "border-box",
                        padding: "0 14px",
                        transition: "border-color 150ms ease, box-shadow 150ms ease",
                        width: "100%",
                        fontSize: 14,
                        color: "#dbdee1",
                        outline: "none",
                        fontFamily: "inherit",
                        boxShadow: focused ? "inset 0 0 0 1px #5865f2" : "none",
                    }}
                />
                <div style={{ fontSize: 11, color: hasErr ? C.danger : C.muted, marginTop: 5, display: "flex", alignItems: "center", gap: 4 }}>
                    {hasErr ? <ico.x /> : null}
                    {hasErr ? (lk as any).msg : "developer mode → right-click user → copy user id"}
                </div>
            </div>
            <button
                ref={btnRef}
                onClick={() => { if (btnState !== "idle") doLookup() }}
                className={btnState === "notfound" ? "ur-shake" : btnState === "valid" ? "ur-pulse" : ""}
                style={{ ...btnStyle, background: getBtnBg(), opacity: btnState === "idle" ? 0.5 : 1 }}
            >
                {getBtnText()}
            </button>
        </div>
    )
}

function AddLabelInput({ label, setLabel, doAdd }: {
    label: string
    setLabel: (v: string) => void
    doAdd: () => void
}) {
    const [focused, setFocused] = React.useState(false)
    return (
        <input
            placeholder='e.g. "bestie", "the rat", "ex"'
            maxLength={50}
            value={label}
            onChange={(e) => setLabel(e.target.value.slice(0, 50))}
            onKeyDown={(e) => { if (e.key === "Enter") doAdd() }}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            autoFocus
            style={{
                background: "#1e1f22",
                borderRadius: 20,
                border: `1px solid ${focused ? C.brand : "#3f4147"}`,
                boxShadow: focused ? "0 0 0 3px rgba(88,101,242,0.18)" : "none",
                height: 40,
                boxSizing: "border-box",
                padding: "0 14px",
                transition: "border-color 150ms ease, box-shadow 150ms ease",
                width: "100%",
                fontSize: 14,
                color: "#dbdee1",
                outline: "none",
                fontFamily: "inherit",
                marginBottom: 14,
            }}
        />
    )
}

function AddUserSection({ onAdded }: { onAdded: () => void }) {
    const [rawId, setRawId] = React.useState("")
    const [label, setLabel] = React.useState("")
    const [lk, setLk]       = React.useState<LookupStage>({ s: "idle" })
    const [copiedId, setCopiedId] = React.useState(false)

    const cleanId = rawId.trim().replace(/\D/g, "")
    const hasErr  = lk.s === "err"

    const copyId = (id: string) => {
        navigator.clipboard.writeText(id)
        setCopiedId(true)
        setTimeout(() => setCopiedId(false), 1200)
    }

    const doLookup = () => {
        if (!cleanId)                                    return setLk({ s: "err", msg: "enter a user id first" })
        if (cleanId.length < 17 || cleanId.length > 20) return setLk({ s: "err", msg: "discord ids are 17-20 digits" })
        if (isWatched(settings, cleanId))                return setLk({ s: "err", msg: "already on your watchlist" })

        setLk({ s: "loading" })
        RestAPI.get({
            url: `/users/${cleanId}/profile`,
            query: { with_mutual_guilds: false, with_mutual_friends_count: false },
        }).then((res: any) => {
            const d = camelize(res.body)
            setLk({ s: "done", user: d.user, av: avatarUrl(d.user.id, d.user.avatar, 64) })
        }).catch((e: any) => {
            const code = e?.status ?? e?.response?.status
            setLk({
                s: "err",
                msg: code === 404 ? "user not found"
                   : code === 403 ? "profile is private (no shared server) - you can still add by id"
                   : `request failed${code ? ` (${code})` : ""}`,
            })
        })
    }

    const doAdd = () => {
        if (lk.s !== "done") return
        addUser(settings, cleanId, label.trim().slice(0, 50))
        fetchNewUserBaseline(cleanId)
        setRawId(""); setLabel(""); setLk({ s: "idle" })
        onAdded()
    }

    return (
        <div className="ur-fade-in">
            <div style={{ fontSize: 12, fontWeight: 800, textTransform: "uppercase", letterSpacing: 0.6, color: C.subheader, marginBottom: 12 }}>
                add user
            </div>

            {lk.s !== "done" && (
                <AddUserInput
                    rawId={rawId}
                    setRawId={setRawId}
                    hasErr={hasErr}
                    lk={lk}
                    setLk={setLk}
                    doLookup={doLookup}
                />
            )}

            {lk.s === "done" && (
                <div className="ur-fade-in">
                    <div style={{
                        background: C.bg1,
                        borderRadius: 16,
                        border: `1px solid ${C.border}`,
                        marginBottom: 14,
                        overflow: "hidden",
                    }}>
                        <div style={{ padding: "12px 16px" }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 10 }}>
                                <img
                                    src={lk.av}
                                    style={{
                                        width: 52, height: 52,
                                        borderRadius: "50%",
                                        border: `2px solid ${C.border}`,
                                        flexShrink: 0,
                                        background: C.bg1,
                                    }}
                                    onError={(e: any) => { e.target.src = FALLBACK_AV }}
                                />
                                <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                                        <span style={{ fontSize: 17, fontWeight: 800, color: C.header, lineHeight: 1.2 }}>
                                            {lk.user.globalName || lk.user.username}
                                        </span>
                                        {lk.user.globalName && (
                                            <span style={{ fontSize: 12, color: C.muted, fontWeight: 500 }}>@{lk.user.username}</span>
                                        )}
                                    </div>
                                    {lk.user.pronouns && (
                                        <div style={{ fontSize: 11, color: C.brandLight, marginTop: 2, fontWeight: 500 }}>
                                            {lk.user.pronouns}
                                        </div>
                                    )}
                                </div>
                                <div style={{
                                    width: 20, height: 20,
                                    borderRadius: "50%",
                                    background: "rgba(36,128,70,0.15)",
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    flexShrink: 0,
                                }}>
                                    <span style={{ color: C.green, display: "flex", transform: "scale(0.8)" }}><ico.check /></span>
                                </div>
                            </div>

                            {lk.user.bio && (
                                <div style={{ marginBottom: 10 }}>
                                    <div style={{ fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: 0.6, color: C.subheader, marginBottom: 4 }}>
                                        About Me
                                    </div>
                                    <div style={{
                                        fontSize: 12,
                                        color: C.text,
                                        lineHeight: 1.5,
                                        padding: "8px 10px",
                                        background: C.bg2,
                                        borderRadius: 8,
                                        border: `1px solid ${C.border}`,
                                        whiteSpace: "pre-wrap",
                                        wordBreak: "break-word",
                                    }}>
                                        {lk.user.bio}
                                    </div>
                                </div>
                            )}

                            <div style={{ height: 1, background: C.border, margin: "8px 0" }} />

                            {(() => {
                                const sf = decodeSnowflake(lk.user.id)
                                return sf && (
                                <div>
                                    <div style={{ fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: 0.6, color: C.subheader, marginBottom: 5 }}>
                                        Account Info
                                    </div>
                                    <div style={{
                                        display: "grid",
                                        gridTemplateColumns: "repeat(2, 1fr)",
                                        gap: 6,
                                    }}>
                                        <div
                                            onClick={() => copyId(lk.user.id)}
                                            style={{
                                                padding: "8px 10px",
                                                background: C.bg2,
                                                borderRadius: 8,
                                                border: `1px solid ${C.border}`,
                                                cursor: "pointer",
                                                transition: "border-color 150ms ease, background 150ms ease",
                                            }}
                                            onMouseEnter={e => { e.currentTarget.style.borderColor = C.bgEl; e.currentTarget.style.background = "#232428" }}
                                            onMouseLeave={e => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.background = C.bg2 }}
                                            title="Click to copy ID"
                                        >
                                            <div style={{ fontSize: 10, color: C.muted, marginBottom: 2, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.4 }}>User ID</div>
                                            <div style={{ fontSize: 11, fontFamily: "monospace", color: C.text, display: "flex", alignItems: "center", gap: 4 }}>
                                                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{lk.user.id}</span>
                                                <span style={{ color: copiedId ? C.green : C.muted, flexShrink: 0, transition: "color 150ms ease", display: "flex" }}>
                                                    {copiedId ? <ico.check /> : <ico.copy />}
                                                </span>
                                            </div>
                                        </div>

                                        <div style={{ padding: "8px 10px", background: C.bg2, borderRadius: 8, border: `1px solid ${C.border}` }}>
                                            <div style={{ fontSize: 10, color: C.muted, marginBottom: 2, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.4 }}>Created</div>
                                            <div style={{ fontSize: 11, color: C.text, fontWeight: 600 }}>
                                                {sf.date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
                                            </div>
                                            <div style={{ fontSize: 10, color: C.muted, marginTop: 1 }}>
                                                {sf.date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
                                            </div>
                                        </div>

                                        <div style={{ padding: "8px 10px", background: C.bg2, borderRadius: 8, border: `1px solid ${C.border}` }}>
                                            <div style={{ fontSize: 10, color: C.muted, marginBottom: 2, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.4 }}>Account Age</div>
                                            <div style={{ fontSize: 11, color: C.text, fontWeight: 600 }}>
                                                {(() => {
                                                    const diff = Date.now() - sf.timestamp
                                                    const years = Math.floor(diff / 31536000000)
                                                    const months = Math.floor((diff % 31536000000) / 2592000000)
                                                    const days = Math.floor((diff % 2592000000) / 86400000)
                                                    if (years > 0) return `${years}y ${months}mo`
                                                    if (months > 0) return `${months}mo ${days}d`
                                                    return `${days}d`
                                                })()}
                                            </div>
                                        </div>

                                        <div
                                            title={`Worker ${sf.workerId} · Process ${sf.processId} · Increment ${sf.increment}`}
                                            style={{ padding: "8px 10px", background: C.bg2, borderRadius: 8, border: `1px solid ${C.border}` }}
                                        >
                                            <div style={{ fontSize: 10, color: C.muted, marginBottom: 2, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.4 }}>Snowflake</div>
                                            <div style={{ fontSize: 11, fontFamily: "monospace", color: C.brandLight, fontWeight: 600 }}>
                                                w{sf.workerId} · p{sf.processId}
                                            </div>
                                            <div style={{ fontSize: 10, color: C.muted, marginTop: 1, fontFamily: "monospace" }}>
                                                inc {sf.increment}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                                )
                            })()}
                        </div>
                    </div>

                    <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.6, color: C.subheader, marginBottom: 6 }}>
                        label <span style={{ fontWeight: 500, color: C.muted, textTransform: "none" }}>(optional, only you see this)</span>
                    </div>
                    <AddLabelInput label={label} setLabel={setLabel} doAdd={doAdd} />

                    <div style={{ display: "flex", gap: 8 }}>
                        <button
                            onClick={doAdd}
                            style={{
                                flex: 1,
                                borderRadius: 20,
                                height: 40,
                                boxSizing: "border-box",
                                padding: "0 20px",
                                background: C.green,
                                color: "#ffffff",
                                border: "none",
                                fontSize: 14,
                                fontWeight: 600,
                                cursor: "pointer",
                                fontFamily: "inherit",
                                transition: "background 150ms ease",
                            }}
                            onMouseEnter={e => { e.currentTarget.style.background = "#2d9c5a" }}
                            onMouseLeave={e => { e.currentTarget.style.background = C.green }}
                        >
                            add to watchlist
                        </button>
                        <button
                            onClick={() => { setLk({ s: "idle" }); setLabel("") }}
                            style={{
                                borderRadius: 20,
                                height: 40,
                                boxSizing: "border-box",
                                padding: "0 18px",
                                background: "transparent",
                                color: C.text,
                                border: `1px solid ${C.border}`,
                                fontSize: 14,
                                fontWeight: 500,
                                cursor: "pointer",
                                fontFamily: "inherit",
                                transition: "background 150ms ease, border-color 150ms ease",
                            }}
                            onMouseEnter={e => {
                                e.currentTarget.style.background = "rgba(255,255,255,0.05)"
                                e.currentTarget.style.borderColor = C.bgEl
                            }}
                            onMouseLeave={e => {
                                e.currentTarget.style.background = "transparent"
                                e.currentTarget.style.borderColor = C.border
                            }}
                        >
                            cancel
                        </button>
                    </div>
                </div>
            )}
        </div>
    )
}

const OV_GROUPS = {
    messages: [
        { label: "messages",  key: "msgs",     gk: "globalMsgs",     Icon: ico.msg,      desc: "Notify on new messages" },
        { label: "edits",     key: "edits",    gk: "globalEdits",    Icon: ico.edit,     desc: "Notify on message edits" },
        { label: "deletes",   key: "deletes",  gk: "globalDeletes",  Icon: ico.del,      desc: "Notify on deleted messages" },
        { label: "typing",    key: "typing",   gk: "globalTyping",   Icon: ico.typing,   desc: "Notify when typing starts" },
    ],
    presence: [
        { label: "status",    key: "status",   gk: "globalStatus",   Icon: ico.status,   desc: "Notify on status changes" },
        { label: "activity",  key: "activity", gk: "globalActivity", Icon: ico.activity, desc: "Game/music activity (off by default)" },
        { label: "voice",     key: "voice",    gk: "globalVoice",    Icon: ico.voice,    desc: "Notify on voice channel activity" },
        { label: "joins",     key: "joins",    gk: "globalJoins",    Icon: ico.joins,    desc: "Notify on server joins / leaves" },
    ],
    profile: [
        { label: "profile",   key: "profile",  gk: "globalProfile",  Icon: ico.profile,  desc: "Notify on profile changes" },
        { label: "avatar",    key: "avatar",   gk: "globalAvatar",   Icon: ico.avatar,   desc: "Notify on avatar updates" },
    ],
} as const

type OvTab = "messages" | "presence" | "profile"
const OV_TAB_LABELS: Record<OvTab, string> = { messages: "Messages", presence: "Presence", profile: "Profile" }
const OV_TAB_ICONS: Record<OvTab, () => JSX.Element> = {
    messages: () => <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M2 22V4a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6l-4 4z"/></svg>,
    presence: () => <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="10" opacity=".25"/><circle cx="12" cy="12" r="5"/></svg>,
    profile:  () => <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>,
}

function LabelInput({ nick, setNick, saveNick }: { nick: string; setNick: (v: string) => void; saveNick: () => void }) {
    const [focused, setFocused] = React.useState(false)
    return (
        <input
            placeholder="label"
            maxLength={50}
            value={nick}
            onChange={(e) => setNick(e.target.value.slice(0, 50))}
            onBlur={() => { setFocused(false); saveNick() }}
            onFocus={() => setFocused(true)}
            onKeyDown={(e) => { if (e.key === "Enter") { setFocused(false); saveNick() } }}
            style={{
                background: C.bg1,
                borderRadius: 20,
                border: `1px solid ${focused ? C.brand : C.border}`,
                boxShadow: focused ? "0 0 0 3px rgba(88,101,242,0.18)" : "none",
                height: 26,
                boxSizing: "border-box",
                display: "flex",
                alignItems: "center",
                padding: "0 10px",
                fontSize: 12,
                width: "100%",
                margin: 0,
                color: C.text,
                outline: "none",
                transition: "border-color 150ms ease, box-shadow 150ms ease",
                fontFamily: "inherit",
            }}
        />
    )
}

function SearchInput({ query, setQuery }: { query: string; setQuery: (v: string) => void }) {
    const [focused, setFocused] = React.useState(false)
    return (
        <div style={{ position: "relative", width: 160, flexShrink: 0 }}>
            <input
                placeholder="search…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onBlur={() => setFocused(false)}
                onFocus={() => setFocused(true)}
                style={{
                    background: "#1e1f22",
                    borderRadius: 20,
                    border: `1px solid ${focused ? C.brand : "#3f4147"}`,
                    boxShadow: focused ? "0 0 0 3px rgba(88,101,242,0.18)" : "none",
                    height: 28,
                    boxSizing: "border-box",
                    padding: "0 28px 0 12px",
                    width: "100%",
                    fontSize: 13,
                    color: "#dbdee1",
                    outline: "none",
                    fontFamily: "inherit",
                    transition: "border-color 150ms ease, box-shadow 150ms ease",
                }}
            />
            <div style={{
                position: "absolute",
                right: 8,
                top: "50%",
                transform: "translateY(-50%)",
                color: "#949ba4",
                display: query ? "none" : "flex",
                alignItems: "center",
                pointerEvents: "none",
            }}>
                <ico.search />
            </div>
            {query && (
                <div
                    role="button"
                    onClick={() => setQuery("")}
                    style={{
                        position: "absolute",
                        right: 8,
                        top: "50%",
                        transform: "translateY(-50%)",
                        color: "#949ba4",
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        lineHeight: 1,
                    }}
                >
                    <ico.x />
                </div>
            )}
        </div>
    )
}

function previewNotification(uid: string, type: string) {
    const u = UserStore.getUser(uid)
    const label = getWatchedUser(settings, uid)?.nick
    const name = displayName(u) || uid
    const dn = label ? `${label} (${name})` : name
    const icon = u ? avatarUrl(u.id, (u as any).avatar) : undefined

    const previews: Record<string, { title: string; body: string }> = {
        msgs:     { title: `${dn} sent a message`, body: "This is a preview of how message notifications will appear." },
        edits:    { title: `${dn} edited a message`, body: `"before" → "after preview text"` },
        deletes:  { title: `${dn} deleted a message`, body: `"this is a preview of deleted message content"` },
        typing:   { title: `${dn} is typing…`, body: "in #general" },
        status   { title: `${dn} is now online`, body: "was: offline" },
        activity: { title: `${dn} is playing Game Name`, body: "doing something - details here" },
        voice:    { title: `${dn} joined voice`, body: "#General Voice" },
        joins:    { title: `${dn} joined a server`, body: "Server Name" },
        profile:  { title: `${dn} updated their profile`, body: "bio, display name" },
        avatar:   { title: `${dn} changed their avatar`, body: "click to see new pfp" },
    }

    const p = previews[type] || { title: `${dn}: ${type}`, body: "preview notification" }
    notify({ title: "[Preview] " + p.title, body: p.body, icon })
}

// known-good public logos - only apps i can confirm resolve, no guessing broken urls
const MUSIC_APP_ICONS: Record<string, string> = {
    "spotify":        "https://cdn.simpleicons.org/spotify/1ED760",
    "apple music":    "https://cdn.simpleicons.org/applemusic/FA243C",
    "youtube music":  "https://cdn.simpleicons.org/youtubemusic/FF0000",
    "tidal":          "https://cdn.simpleicons.org/tidal/000000",
    "deezer":         "https://cdn.simpleicons.org/deezer/FEAA2D",
    "soundcloud":     "https://cdn.simpleicons.org/soundcloud/FF5500",
    "pandora":        "https://cdn.simpleicons.org/pandora/224099",
    "qobuz":          "https://cdn.simpleicons.org/qobuz/000000",
    "last.fm":        "https://cdn.simpleicons.org/lastdotfm/D51007",
}

// one resolver for games and listening. only works when discord actually sends asset
// data though - a lot of games (minecraft's xbox rpc included) send just an appId with
// no assets, so the icon has to come from the app's own public record instead - see below
const appIconCache: Record<string, string | null> = {}
const _appIconFetching: Partial<Record<string, Promise<string | null>>> = {}

async function fetchAppIcon(appId: string): Promise<string | null> {
    if (appId in appIconCache) return appIconCache[appId]
    if (_appIconFetching[appId]) return _appIconFetching[appId]
    const p = (async () => {
        try {
            const { body } = await RestAPI.get({ url: `/applications/${appId}/rpc` })
            const icon = body?.icon
            const url = icon ? `https://cdn.discordapp.com/app-icons/${appId}/${icon}.png?size=128` : null
            appIconCache[appId] = url
            return url
        } catch {
            appIconCache[appId] = null
            return null
        } finally {
            delete _appIconFetching[appId]
        }
    })()
    _appIconFetching[appId] = p
    return p
}

function resolveActivityImage(act: any): string {
    const img = act.assets?.large_image || act.assets?.largeImage || ""
    const appId = act.application_id || act.applicationId || ""
    if (img.startsWith("spotify:")) return `https://i.scdn.co/image/${img.slice(8)}`
    if (img.startsWith("twitch:")) return `https://static-cdn.jtvnw.net/previews-ttv/live_user_${img.slice(7)}-256x144.jpg`
    if (img.startsWith("youtube:")) return `https://i.ytimg.com/vi/${img.slice(8)}/hqdefault.jpg`
    if (img.startsWith("mp:external/")) return `https://media.discordapp.net/external/${img.slice(12)}`
    if (img.startsWith("mp:app-asset/")) return `https://media.discordapp.net/app-assets/${img.slice(13)}`
    if (img.startsWith("mp:")) return `https://media.discordapp.net/${img.slice(3)}`
    if (img.startsWith("http")) return img
    // some console-linked / embedded RPCs (Xbox, PlayStation, activity SDK games) send the
    // media-proxy path without discord's "mp:" scheme in front - same asset, missing prefix.
    // these got dropped straight to the controller icon before since they don't match any
    // case above and always contain a "/", tripping the old blanket "!img.includes(':')" guard.
    if (img.startsWith("external/")) return `https://media.discordapp.net/${img}`
    if (img.startsWith("app-asset/")) return `https://media.discordapp.net/${img}`
    if (appId && img && !img.includes(":")) return `https://cdn.discordapp.com/app-assets/${appId}/${img}.png`
    if (act.type === 2) return MUSIC_APP_ICONS[(act.name || "").toLowerCase()] || ""
    return ""
}

function getActivityIconKey(entry: ActivityEntry): keyof typeof actIco {
    const type = entry.type
    const meta = entry.metadata || {}

    // exact type first so a msg containing "spotify" isn't mis-tagged
    if (type === "msg") return "message"
    if (type === "edit") return "edit"
    if (type === "delete") return "delete"
    if (type === "typing") return "typing"
    if (type === "profile") return "profile"
    if (type === "avatar") return "avatar"
    if (type === "banner") return "banner"
    if (type === "bio") return "bio"
    if (type === "username" || type === "displayname") return "username"
    if (type === "pronouns") return "pronouns"
    if (type === "custom_status") return "customStatus"
    if (type === "join") return "join"
    if (type === "leave") return "leave"
    if (type === "vc_move") return "vcMove"
    if (type === "game_start" || type === "game_stop") return "playing"
    if (type === "spotify") return "listening"
    if (type === "streaming") return "watching"
    if (type === "online") return "online"
    if (type === "offline") return "offline"
    if (type === "idle") return "idle"
    if (type === "dnd") return "dnd"

    // camera/screenshare log as type "voice" while live, check metadata
    if (type === "voice" || type === "vc_join" || type === "vc_leave") {
        const action = (meta.action || "").toLowerCase()
        if (action.includes("camera")) return "camera"
        if (action.includes("stream") || action.includes("screen")) return "screen"
        return "voice"
    }

    // activity/session are generic - real kind lives in metadata
    if (type === "activity" || type === "session") {
        const action = (meta.action || "").toLowerCase()
        const activityType = meta.type

        if (action === "status_session") return "status"
        if (action.includes("listening") || activityType === 2 || meta.trackId) return "listening"
        if (action.includes("voice")) return "voice"
        if (action.includes("camera")) return "camera"
        if (action.includes("stream") || action.includes("screen")) return "screen"
        if (action.includes("game") || activityType === 0) return "playing"
        if (activityype === 1) return "watching"

        return "session"
    }

    if (type === "status") return "status"

    return "session"
}

function formatDuration(ms: number): string {
    if (!ms || ms < 0) return "0m"
    const totalSeconds = Math.floor(ms / 1000)
    const mins = Math.floor(totalSeconds / 60)
    const hours = Math.floor(mins / 60)
    const days = Math.floor(hours / 24)

    if (days > 0) {
        const remainingHours = hours % 24
        const remainingMins = mins % 60
        if (remainingHours > 0 && remainingMins > 0) return `${days}d ${remainingHours}h ${remainingMins}m`
        if (remainingHours > 0) return `${days}d ${remainingHours}h`
        return `${days}d ${remainingMins}m`
    }
    if (hours > 0) {
        const remainingMins = mins % 60
        if (remainingMins > 0) return `${hours}h ${remainingMins}m`
        return `${hours}h`
    }
    if (mins > 0) {
        const remainingSecs = totalSeconds % 60
        if (remainingSecs > 0) return `${mins}m ${remainingSecs}s`
        return `${mins}m`
    }
    return `${totalSeconds}s`
}

const _albumColorCache: Record<string, string> = {}
const ALBUM_CACHE_MAX = 300  // small hex strings, but cap it so long sessions don't grow this forever

function extractAlbumColor(imageUrl: string): Promise<string> {
    if (_albumColorCache[imageUrl]) return Promise.resolve(_albumColorCache[imageUrl])
    return new Promise((resolve) => {
        const img = new Image()
        img.crossOrigin = "anonymous"
        img.onload = () => {
            try {
                const canvas = document.createElement("canvas")
                const ctx = canvas.getContext("2d")
                if (!ctx) { resolve("#1ed760"); return }
                const size = 64
                canvas.width = size
                canvas.height = size
                ctx.drawImage(img, 0, 0, size, size)
                const data = ctx.getImageData(0, 0, size, size).data

                const buckets: Record<string, { r: number; g: number; b: number; count: number; satSum: number }> = {}
                const bucketSize = 24 // quantize to 24-unit steps

                for (let i = 0; i < data.length; i += 8) { // sample every 2nd pixel for speed
                    const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3]
                    if (a < 128) continue

                    const max = Math.max(r, g, b)
                    const min = Math.min(r, g, b)
                    const lum = (max + min) / 2
                    // Skip near-white, near-black, and very low saturation
                    if (lum < 35 || lum > 240) continue
                    if (max - min < 30) continue // too gray

                    const sat = max === 0 ? 0 : (max - min) / max
                    if (sat < 0.15) continue // skip low saturation

                    const br = Math.floor(r / bucketSize) * bucketSize
                    const bg = Math.floor(g / bucketSize) * bucketSize
                    const bb = Math.floor(b / bucketSize) * bucketSize
                    const key = `${br},${bg},${bb}`

                    if (!buckets[key]) buckets[key] = { r: 0, g: 0, b: 0, count: 0, satSum: 0 }
                    buckets[key].r += r
                    buckets[key].g += g
                    buckets[key].b += b
                    buckets[key].count++
                    buckets[key].satSum += sat
                }

                let bestKey = ""
                let bestScore = 0
                for (const key in buckets) {
                    const b = buckets[key]
                                const avgSat = b.satSum / b.count
                    const score = b.count * avgSat
                    if (score > bestScore) {
                        bestScore = score
                        bestKey = key
                    }
                }

                let hex: string
                if (bestKey && buckets[bestKey]) {
                    const b = buckets[bestKey]
                    const avgR = Math.round(b.r / b.count)
                    const avgG = Math.round(b.g / b.count)
                    const avgB = Math.round(b.b / b.count)
                    hex = `#${avgR.toString(16).padStart(2, "0")}${avgG.toString(16).padStart(2, "0")}${avgB.toString(16).padStart(2, "0")}`
                } else {
                    hex = "#1ed760"
                }

                _albumColorCache[imageUrl] = hex
                const keys = Object.keys(_albumColorCache)
                if (keys.length > ALBUM_CACHE_MAX) delete _albumColorCache[keys[0]]
                resolve(hex)
            } catch {
                resolve("#1ed760")
            }
        }
        img.onerror = () => resolve("#1ed760")
        img.src = imageUrl
    })
}
function hexToRgba(hex: string, alpha: number): string {
    const r = parseInt(hex.slice(1, 3), 16)
    const g = parseInt(hex.slice(3, 5), 16)
    const b = parseInt(hex.slice(5, 7), 16)
    return `rgba(${r},${g},${b},${alpha})`
}

const ACTIVITY_CATEGORIES = [
    { key: "msg" as ActivityType, label: "Messages", Icon: ico.catMsg, color: "#5865f2" },
    { key: "edit" as ActivityType, label: "Edits", Icon: ico.catEdit, color: "#f0b232" },
    { key: "delete" as ActivityType, label: "Deletes", Icon: ico.catDelete, color: "#da373c" },
    { key: "typing" as ActivityType, label: "Typing", Icon: ico.catTyping, color: "#949cf4" },
    { key: "status" as ActivityType, label: "Status", Icon: ico.catStatus, color: "#23a55a" },
    { key: "voice" as ActivityType, label: "Voice", Icon: ico.catVoice, color: "#dbdee1" },
    { key: "profile" as ActivityType, label: "Profile", Icon: ico.catProfile, color: "#ff6b6b" },
    { key: "activity" as ActivityType, label: "Activity", Icon: ico.catActivity, color: "#f0b232" },
] as const

function matchesCatgory(log: ActivityEntry, category: ActivityType): boolean {
    if (category === "msg") return log.type === "msg"
    if (category === "edit") return log.type === "edit"
    if (category === "delete") return log.type === "delete"
    if (category === "typing") return log.type === "typing"
    if (category === "status") {
        return log.type === "online" || log.type === "offline" || log.type === "idle" || log.type === "dnd" || log.type === "status" || log.type === "custom_status" || (log.type === "session" && log.metadata?.action === "status_session")
    }
    if (category === "voice") return log.type === "voice" || log.type === "vc_join" || log.type === "vc_leave" || log.type === "vc_move" || (log.type === "session" && (["voice_session", "stream_session", "camera_session"].includes(log.metadata?.action || "") || (log.metadata?.action || "").includes("voice")))
    if (category === "profile") return log.type === "profile" || log.type === "avatar" || log.type === "banner" || log.type === "bio" || log.type === "username" || log.type === "displayname" || log.type === "pronouns"
    if (category === "activity") return log.type === "activity" || log.type === "game_start" || log.type === "game_stop" || log.type === "spotify" || log.type === "streaming" || (log.type === "session" && (log.metadata?.action || "").includes("activity"))
    return log.type === category
}

function ActivityCardIcon({ log }: { log: ActivityEntry }) {
    const [failed, setFailed] = React.useState(false)
    const isListening = log.metadata?.type === 2 || (log.metadata?.action || "").includes("listening")
    const appLogo = isListening ? MUSIC_APP_ICONS[(log.metadata?.appName || "").toLowerCase()] : ""
    const storedUrl = log.metadata?.iconUrl || log.metadata?.gameIconUrl || (isListening ? "" : log.metadata?.albumArtUrl) || ""
    const appId = log.metadata?.applicationId || ""
    // heals old entries logged before appIconCache existed
    const [healedUrl, setHealedUrl] = React.useState(() => (appId ? appIconCache[appId] || "" : ""))
    React.useEffect(() => {
        if (storedUrl || !appId || healedUrl || appIconCache[appId] !== undefined) return
        let live = true
        fetchAppIcon(appId).then(url => { if (live && url) setHealedUrl(url) }).catch(() => {})
        return () => { live = false }
    }, [storedUrl, appId, healedUrl])
    const realUrl = appLogo || storedUrl || healedUrl
    const key = getActivityIconKey(log)
    const { Icon, color } = actIco[key]
    const showImg = realUrl && !failed
    return (
        <div data-ur-card-icon className="ur-log-icon" style={{
            width: 42, height: 42, borderRadius: appLogo ? "50%" : 12,
            display: "flex", alignItems: "center", justifyContent: "center",
            flexShrink: 0, marginTop: 1, overflow: "hidden",
            background: showImg ? C.bg1 : `${color}1c`,
            border: appLogo ? "none" : `1px solid ${showImg ? C.border : color + "40"}`,
            color,
        }}>
            {showImg
                ? <img src={realUrl} onError={() => setFailed(true)} style={{ width: "100%", height: "100%", objectFit: appLogo ? "contain" : "cover", padding: appLogo ? 4 : 0 }} />
                : <Icon />}
        </div>
    )
}

// on-avatar status badges - built from the provided status SVG set instead of flat
// color dots. online/dnd/offline are complete self-contained badge shapes already;
// idle's source asset is just the crescent glyph with no backing circle, so it gets
// composited onto a solid circle here (crescent recolored to the card bg to "bite" it)
// to read as a full badge like the other three, matching Discord's real idle icon.
function StatusBadgeIcon({ status }: { status: string }) {
    if (status === "online") {
        return (
            <svg viewBox="0 0 16 16" width="100%" height="100%">
                <path d="M16 8C16 12.4183 12.4183 16 8 16C3.58172 16 0 12.4183 0 8C0 3.58172 3.58172 0 8 0C12.4183 0 16 3.58172 16 8Z" fill="#45a366" />
            </svg>
        )
    }
    if (status === "dnd") {
        return (
            <svg viewBox="0 0 16 16" width="100%" height="100%">
                <path fillRule="evenodd" clipRule="evenodd" d="M8 16C3.58172 16 0 12.4183 0 8C0 3.58172 3.58172 0 8 0C12.4183 0 16 3.58172 16 8C16 12.4183 12.4183 16 8 16ZM5.24902 7C4.69674 7 4.24902 7.44772 4.24902 8C4.24902 8.55229 4.69674 9 5.24902 9H10.7499C11.3022 9 11.7499 8.55229 11.7499 8C11.7499 7.44772 11.3022 7 10.7499 7H5.24902Z" fill="#e00000" />
            </svg>
        )
    }
    if (status === "idle") {
        return (
            <svg viewBox="0 0 24 24" width="100%" height="100%" style={{ transform: "scaleX(-1)" }}>
                <path d="M12.0557 3.59974C12.2752 3.2813 12.2913 2.86484 12.0972 2.53033C11.9031 2.19582 11.5335 2.00324 11.1481 2.03579C6.02351 2.46868 2 6.76392 2 12C2 17.5228 6.47715 22 12 22C17.236 22 21.5313 17.9764 21.9642 12.8518C21.9967 12.4664 21.8041 12.0968 21.4696 11.9027C21.1351 11.7086 20.7187 11.7248 20.4002 11.9443C19.4341 12.6102 18.2641 13 17 13C13.6863 13 11 10.3137 11 6.99996C11 5.73589 11.3898 4.56587 12.0557 3.59974Z" fill="#ffc04e" />
            </svg>
        )
    }
    // offline / invisible - hollow ring, same as Discord's real offline badge
    return (
        <svg viewBox="0 0 16 16" width="100%" height="100%">
            <path fillRule="evenodd" clipRule="evenodd" d="M8 2C4.68629 2 2 4.68629 2 8C2 11.3137 4.68629 14 8 14C11.3137 14 14 11.3137 14 8C14 4.68629 11.3137 2 8 2ZM0 8C0 3.58172 3.58172 0 8 0C12.4183 0 16 3.58172 16 8C16 12.4183 12.4183 16 8 16C3.58172 16 0 12.4183 0 8Z" fill="#84858d" />
        </svg>
    )
}

function LogCard({ log, expanded, onToggle, onDelte, userId, index }: {
    log: ActivityEntry
    expanded: boolean
    onToggle: () => void
    onDelete: (id: string) => void
    userId: string
    index?: number
}) {
    return (
            <div
                key={log.id}
                data-ur-card-body
                className={`ur-log-card${expanded ? " open" : ""}`}
                onClick={() => onToggle()}
                style={{
                    display: "flex",
                    gap: 14,
                    padding: "14px 16px",
                    borderRadius: 18,
                    background: expanded
                        ? "linear-gradient(135deg, rgba(255,255,255,0.065) 0%, rgba(255,255,255,0.03) 100%)"
                        : "linear-gradient(135deg, rgba(255,255,255,0.045) 0%, rgba(255,255,255,0.02) 100%)",
                    border: `1px solid ${expanded ? C.bgEl : C.border}`,
                    marginBottom: 6,
                    cursor: "pointer",
                    minHeight: 56,
                    animationDelay: `${Math.min(index ?? 0, 12) * 22}ms`,
                }}
            >
                <ActivityCardIcon log={log} />
                <div style={{ flex: 1, minWidth: 0 }}>
                    {(() => {
                        // Check if this log entry has an ongoing active session
                        const isLiveSession = Object.values(activeSessions).some(s => s.logId === log.id)
                        return isLiveSession ? (
                            <div data-ur-card-live style={{
                                display: "inline-flex",
                                alignItems: "center",
                                gap: 5,
                                fontSize: 10,
                                fontWeight: 800,
                                textTransform: "uppercase",
                                letterSpacing: 0.6,
                                color: "#23a55a",
                                background: "rgba(35,165,90,0.12)",
                                border: "1px solid rgba(35,165,90,0.3)",
                                borderRadius: 8,
                                padding: "3px 8px",
                                marginBottom: 5,
                            }}>
                               <span className="ur-blink-dot style={{ display: "inline-block", width: 6, height: 6, borderRadius: "50%", background: "#23a55a", flexShrink: 0 }} />
                                Live
                            </div>
                        ) : null
                    })()}
                    <div data-ur-card-title style={{
                        fontSize: log.type === "msg" || log.type === "edit" || log.type === "delete" ? 15 : 14,
                        fontWeight: 800,
                        color: C.header,
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        marginBottom: 4,
                    }}>
                        <span style={{ wordBreak: "break-word", flex: 1, minWidth: 0 }}>
                            {(() => {
                                // still in vc - show "In #channel" not "joined"
                                const isLive = Object.values(activeSessions).some(s => s.logId === log.id)
                                if (isLive && log.type === "voice" && log.metadata?.action === "joined") {
                                    return `In #${log.metadata.channel || "voice"}`
                                }
                                return log.title
                            })()}
                        </span>
                        <span style={{
                            fontSize: 12,
                            color: C.subheader,
                            fontWeight: 700,                            background: C.bg1,
                            padding: "4px 10px",
                            borderRadius: 8,
                            border: `1px solid ${C.border}`,
                            flexShrink: 0,
                            whiteSpace: "nowrap",
                            display: "flex",
                            alignItems: "center",
                            gap: 6,
                        }} title={exactTime(log.ts)}>
                            <span style={{ display: "flex", alignItems: "center" }}><ico.clock /></span>
                            {new Date(log.ts).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", hour12: true })}
                            <span style={{ color: C.muted, fontWeight: 500 }}>· {timeAgo(log.ts)}</span>
                        </span>
                        <div className={`ur-log-chevron${expanded ? " open" : ""}`} title={expanded ? "Collapse" : "Expand"}>
                            <ico.chevron />
                        </div>
                        <div
                            role="button"
                            title="Delete this entry"
                            onClick={async (e) => {
                                e.stopPropagation()
                                if (!confirm("Delete this activity entry?")) return
                                await activityStore.removeLog(userId, log.id)
                                onDelete(log.id)
                            }}
                            style={{
                                padding: "4px 8px",
                                borderRadius: 6,
                                cursor: "pointer",
                                background: "transparent",
                                color: C.muted,
                                fontSize: 11,
                                fontWeight: 700,
                                display: "flex",
                                alignItems: "center",
                                opacity: 0.4,
                                transition: "opacity 150ms ease, background 150ms ease, color 150ms ease",
                            }}
                            onMouseEnter={e => {
                                e.currentTarget.style.opacity = "1"
                                e.currentTarget.style.background = "rgba(218,55,60,0.12)"
                                e.currentTarget.style.color = C.red
                            }}
                            onMouseLeave={e => {
                                e.currentTarget.style.opacity = "0.4"
                               e.currentTarget.style.background = "transparent"
                                e.currentTarget.style.color = C.muted
                            }}
                        >
                            <ico.trash />
                        </div>
                    </di>
                    {log.body && log.body !== log.title && log.type !== "activity" && log.type !== "session" && log.type !== "edit" && log.metadata?.action !== "status_session" && (
                        <div data-ur-card-body-text={(log.type === "msg" || log.type === "delete") ? "content" : "meta"} style={{
                            fontSize: log.type === "msg" || log.type === "delete" ? 14 : 13,
                            color: log.type === "msg" || log.type === "delete" ? C.text : C.muted,
                            lineHeight: 1.4,
                            wordBreak: "break-word",
                            fontWeight: log.type === "msg" || log.type === "delete" ? 500 : 400,
                            marginTop: log.type === "msg" || log.type === "delete" ? 2 : 0,
                        }}>
                            {log.body}
                        </div>
                    )}
                    {(log.type === "msg" || log.type === "edit" || log.type === "delete" || log.type === "voice" || log.type === "activity" || (log.type === "session" && ["listening_session", "activity_session", "voice_session", "camera_session", "stream_session"].includes(log.metadata?.action))) && (
                        <div data-ur-card-location style={{
                            fontSize: 11,
                            color: C.subheader,
                            marginTop: 4,
                            display: "flex",
                            alignItems: "center",
                            gap: 5,
                        }}>
                            <span style={{ opacity: 0.5, display: "flex", alignItems: "center" }}><ico.location /></span>
                            <span>
                                {(log.type === "activity" || log.type === "session") && log.metadata?.appName
                                    ? log.metadata.appName
                                   : log.metadata?.server || "Unknown"}
                                {log.metadata?.channel ? ` · #${log.metadata.channel}` : ""}
                            </span>
                        </div>
                    )}
                    {log.type === "session" && log.metadata?.action === "status_session" && (
                        <div data-ur-card-location style={{
                            fontSize: 11,
                            color: C.subheader,
                            marginTop: 4,
                            display: "flex",
                            alignItems: "center",
                            gap: 5,
                        }}>
                            <span style={{ opacity: 0.5, display: "flex", alignItems: "center" }}><ico.status /></span>
                            <span>
                                {log.metadata?.platform ? `${CLIENT_EMOJI[log.metadata.platform.toLowerCase()] || "📡"} ${log.metadata.platform}` : "Status session"}
                                {log.metadata?.duration ? ` · ${log.metadata.duration}` : ""}
                            </span>
                        </div>
                   )}
                    {log.type === "edit" && log.metadata?.before && (
                        <div style={{
                            marginTop: 10,
                            borderRadius: 14,
                            overflow: "hidden",
                            border: `1px solid rgba(240,178,50,0.25)`,
                        }}>
                            <div style={{ padding: "8px 14px", background: "rgba(240,178,50,0.08)", fontSize: 10, fontWeight: 800, color: "#f0b232", textTransform: "uppercase", letterSpacing: 0.6, display: "flex", alignItems: "center", gap: 6 }}>
                                <ico.edit />
                                Message Edit
                            </div>
                            <div style={{ padding: "10px 14px", borderBottom: log.metadata?.after ? `1px solid rgba(240,178,50,0.15)` : "none", background: "rgba(218,55,60,0.06)" }}>
                                <div style={{ fontSize: 9, fontWeight: 800, color: C.muted, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 5 }}>Before</div>
                                <span style={{ fontSize: 12, textDecoration: "line-through", opacity: 0.7, wordBreak: "break-word", lineHeight: 1.5, color: C.text }}>
                                    {trunc(log.metadata.before, 300)}
                                </span>
                            </div>
                            {log.metadata?.after && (
                                <div style={{ padding: "10px 14px", background: "rgba(36,128,70,0.06)" }}>
                                    <div style={{ fontSize: 9, fontWeight: 800, color: C.muted, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 5 }}>After</div>
                                    <span style={{ fontSize: 12, wordBreak: "break-word", lineHeight: 1.5, color: C.text }}>
                                        {trunc(log.metadata.after, 300)}
                                    </span>
                                </div>
                            )}
                        </div>
                    )}
                    <div className={`ur-expand${expanded ? " open" : ""}`}>
                        <div className={expanded ? "ur-log-expand-in" : ""}>
                            {(log.channelId || log.guildId) && (
                                <div
                                    onClick={(e) => { e.stopPropagation(); jumpTo(log.guildId, log.channelId, log.msgId) }}
                                    style={{
                                        marginTop: 10,
                                        padding: "10px 16px",
                                        background: C.brand,
                                        borderRadius: 10,
                                        color: C.white,
                                        fontSize: 13,
                                        fontWeight: 700,
                                        cursor: "pointer",
                                        textAlign: "center",
                                        fontFamily: "inherit",
                                        transition: "background 150ms ease",
                                        display: "flex",
                                        alignItems: "center",
                                        justifyContent: "center",
                                        gap: 6,
                                    }}
                                    onMouseEnter={e => { e.currentTarget.style.background = "#4752c4" }}
                                    onMouseLeave={e => { e.currentTarget.style.background = C.brand }}
                                >
                                    <ico.external />
                                    Jump to Discord
                                </div>
                            )}
                            {/* Profile field before/after diff card */}
                            {(["username","displayname","bio","banner","pronouns","custom_status","avatar"] as ActivityType[]).includes(log.type) && log.metadata && (log.metadata.before !== undefined || log.metadata.after !== undefined || log.metadata.oldAvatar !== undefined || log.metadata.newAvatar !== undefined) && (
                                <div style={{
                                    marginTop: 10,
                                    borderRadius: 14,
                                    overflow: "hidden",
                                    border: `1px solid rgba(255,107,107,0.3)`,
                                }}>
                                    {/* Header */}
                                    <div style={{
                                        padding: "8px 14px",
                                        background: "rgba(255,107,107,0.12)",
                                        fontSize: 10,
                                        fontWeight: 800,
                                        textTransform: "uppercase",
                                        letterSpacing: 0.6,
                                        color: "#ff6b6b",
                                        display: "flex",
                                        alignItems: "center",
                                        gap: 6,
                                    }}>
                                        <span style={{ display: "flex", alignItems: "center", transform: "scale(0.7)" }}>
                                            {(() => {
                                                const key = getActivityIconKey(log)
                                                const { Icon } = actIco[key]
                                                return <Icon />
                                            })()}
                                        </span>
                                        <span>{FIELD_NAME[log.metadata.field ?? ""] ?? log.type.replace("_", " ")} change</span>
                                    </div>
                                    {/* Avatar images row */}
                                    {log.type === "avatar" && (log.metadata.oldAvatar || log.metadata.newAvatar) && (
                                        <div style={{
                                            display: "flex",
                                            gap: 12,
                                            padding: "14px",
                                            background: C.bg1,
                                            alignItems: "center",
                                       }}>
                                            <div style={{ textAlign: "center" }}>
                                                <div style={{ fontSize: 9, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 }}>Before</div>
                                                {log.metadata.oldAvatar
                                                    ? <img src={log.metadata.oldAvatar} style={{ width: 64, height: 64, borderRadius: "50%", border: `2px solid ${C.border}` }} onError={(e: any) => { e.target.style.display = "none" }} />
                                                    : <div style={{ width: 64, height: 64, borderRadius: "50%", background: C.bg2, border: `2px solid ${C.border}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18 }}>🚫</div>
                                                }
                                            </div>
                                            <div style={{ fontSize: 20, color: C.muted, flexShrink: 0 }}>→</div>
                                            <div style={{ textAlign: "center" }}>
                                                <div style={{ fontSize: 9, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 }}>After</div>
                                                {log.metadata.newAvatar
                                                    ? <img src={log.metadata.newAvatar} style={{ width: 64, height: 64, borderRadius: "50%", border: `2px solid rgba(255,107,107,0.5)` }} onError={(e: any) => { e.target.style.display = "none" }} />
                                                    : <div style={{ width: 64, height: 64, borderRadius: "50%", background: C.bg2, border: `2px solid rgba(255,107,107,0.5)`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18 }}>🚫</div>
                                                }
                                            </div>
                                        </div>
                                    )}
                                    {/* Text before/after */}
                                    {log.type !== "avatar" && (
                                        <div style={{ background: C.bg1 }}>
                                            {log.metadata.before != null && (
                                                <div style={{ padding: "10px 14px", borderBottom: `1px solid ${C.border}` }}>
                                                    <div style={{ fontSize: 9, fontWeight: 800, textTransform: "uppercase", letterSpacing: 0.5, color: C.muted, marginBottom: 5 }}>Before</div>
                                                    <div style={{
                                                        fontSize: 12,
                                                        color: C.text,
                                                        background: "rgba(218,55,60,0.08)",
                                                        border: "1px solid rgba(218,55,60,0.25)",
                                                        borderRadius: 8,
                                                        padding: "8px 10px",
                                                        whiteSpace: "pre-wrap",
                                                        wordBreak: "break-word",
                                                        lineHeight: 1.5,
                                                        textDecoration: "line-through",
                                                        opacity: 0.8,
                                                    }}>
                                                        {String(log.metadata.before)}
                                                    </div>
                                                </div>
                                            )}
                                            {log.metadata.after != null && (
                                                <div style={{ padding: "10px 14px" }}>
                                                    <div style={{ fontSize: 9, fontWeight: 800, textTransform: "uppercase", letterSpacing: 0.5, color: C.muted, marginBottom: 5 }}>After</div>
                                                    <div style={{
                                                        fontSize: 12,
                                                        color: C.text,
                                                        background: "rgba(36,128,70,0.08)",
                                                        border: "1px solid rgba(36,128,70,0.25)",
                                                        borderRadius: 8,
                                                        padding: "8px 10px",
                                                        whiteSpace: "pre-wrap",
                                                        wordBreak: "break-word",
                                                        lineHeight: 1.5,
                                                    }}>
                                                        {String(log.metadata.after)}
                                                    </div>
                                                </div>
                                            )}
                                            {log.metadata.after == null && log.metadata.before != null && (
                                                <div style={{ padding: "10px 14px" }}>
                                                    <div style={{ fontSize: 9, fontWeight: 800, textTransform: "uppercase", letterSpacing: 0.5, color: C.muted, marginBottom: 5 }}>After</div>
                                                    <div style={{
                                                        fontSize: 12,
                                                        color: C.muted,
                                                        fontStyle: "italic",
                                                        padding: "8px 10px",
                                                    }}>
                                                        (removed)
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                            )}
                            {log.metadata && log.type !== "msg" && log.type !== "edit" && log.type !== "delete" && !(["username","displayname","bio","banner","pronouns","custom_status","avatar"] as ActivityType[]).includes(log.type) && (
                                <div style={{
                                    marginTop: 10,
                                    padding: "12px 16px",
                                    background: C.bg1,
                                    borderRadius: 12,
                                    fontSize: 12,
                                    color: C.muted,
                                    lineHeight: 1.6,
                                    border: `1px solid ${C.border}`,
                                }}>
                                    {log.metadata.song && (
                                        <div
                                            ref={(el: any) => {
                                                if (!el || !log.metadata?.albumArtUrl) return
                                                const cached = _albumColorCache[log.metadata.albumArtUrl]
                                                if (cached) {
                                                    el.style.background = hexToRgba(cached, 0.06)
                                                    el.style.borderColor = hexToRgba(cached, 0.35)
                                                    return
                                                }
                                                extractAlbumColor(log.metadata!.albumArtUrl!).then((hex: string) => {
                                                    if (el) {
                                                        el.style.background = hexToRgba(hex, 0.06)
                                                        el.style.borderColor = hexToRgba(hex, 0.35)
                                                    }
                                                })
                                            }}
                                            style={{
                                                display: "flex",
                                                gap: 0,
                                                marginBottom: 12,
                                                borderRadius: 10,
                                                border: "1px solid rgba(30,215,96,0.2)",
                                                overflow: "hidden",
                                                background: "rgba(30,215,96,0.06)",
                                                transition: "background 300ms ease, border-color 300ms ease",
                                                position: "relative",
                                                minHeight: 160,
                                            }}
                                        >
                                            {log.metadata.albumArtUrl && (
                                                <div style={{
                                                    position: "relative",
                                                    width: 160,
                                                    height: 160,
                                                    overflow: "hidden",
                                                    borderRadius: 10,
                                                    flexShrink: 0,
                                                    alignSelf: "center",
                                                }}>
                                                    <img
                                                        src={log.metadata.albumArtUrl}
                                                        style={{
                                                            position: "absolute",
                                                            top: 0,
                                                            left: 0,
                                                            width: "100%",
                                                            height: "100%",
                                                            objectFit: "cover",
                                                            display: "block",
                                                            borderRadius: 8,
                                                        }}
                                                        onError={(e: any) => { e.target.style.display = "none" }}
                                                    />
                                                    <div style={{
                                                        position: "absolute",
                                                        top: 0,
                                                        right: 0,
                                                        width: 50,
                                                        height: "100%",
                                                        background: "linear-gradient(to right, transparent, rgba(0,0,0,0.4))",
                                                        pointerEvents: "none",
                                                    }} />
                                                </div>
                                            )}
                                            <div style={{
                                                flex: 1,
                                                minWidth: 0,
                                                display: "flex",
                                                flexDirection: "column",
                                                justifyContent: "center",
                                                padding: "14px 16px",
                                                gap: 1,
                                            }}>
                                                {log.metadata.appName && (
                                                    <div style={{
                                                        fontSize: 10,
                                                        fontWeight: 800,
                                                        textTransform: "uppercase",
                                                        letterSpacing: 0.8,
                                                        color: C.brandLight,
                                                        display: "flex",
                                                        alignItems: "center",
                                                        gap: 5,
                                                        marginBottom: 4,
                                                    }}>
                                                        {log.metadata.appName === "Spotify" && <span>🎵</span>}
                                                        {log.metadata.appName}
                                                    </div>
                                                )}
                                                <div style={{
                                                    fontSize: 16,
                                                    fontWeight: 800,
                                                    color: C.header,
                                                    whiteSpace: "nowrap",
                                                    overflow: "hidden",
                                                    textOverflow: "ellipsis",
                                                    lineHeight: 1.2,
                                                    letterSpacing: -0.2,
                                                }}>
                                                    {log.metadata.song}
                                                </div>
                                                {log.metadata.artist && (
                                                    <div style={{
                                                        fontSize: 14,
                                                        color: C.text,
                                                        whiteSpace: "nowrap",
                                                        overflow: "hidden",
                                                        textOverflow: "ellipsis",
                                                        fontWeight: 500,
                                                        marginTop: 2,
                                                    }}>
                                                        {log.metadata.artist}
                                                    </div>
                                                )}
                                                {log.metadata.album && (
                                                    <div style={{
                                                        fontSize: 12,
                                                        color: C.muted,
                                                        whiteSpace: "nowrap",
                                                        overflow: "hidden",
                                                        textOverflow: "ellipsis",
                                                        marginTop: 1,
                                                    }}>
                                             you can still add by id"
                   : `request failed${code ? ` (${code})` : ""}`,
            })
        })
    }

    const doAdd = () => {
        if (lk.s !== "done") return
        addUser(settings, cleanId, label.trim().slice(0, 50))
        fetchNewUserBaseline(cleanId)
        setRawId(""); setLabel(""); setLk({ s: "idle" })
        onAdded()
    }

    return (
        <div className="ur-fade-in">
            <div style={{ fontSize: 12, fontWeight: 800, textTransform: "uppercase", letterSpacing: 0.6, color: C.subheader, marginBottom: 12 }}>
                add user
            </div>

            {lk.s !== "done" && (
                <AddUserInput
                    rawId={rawId}
                    setRawId={setRawId}
                    hasErr={hasErr}
                    lk={lk}
                    setLk={setLk}
                    doLookup={doLookup}
                />
            )}

            {lk.s === "done" && (
                <div className="ur-fade-in">
                    <div style={{
                        background: C.bg1,
                        borderRadius: 16,
                        border: `1px solid ${C.border}`,
                        marginBottom: 14,
                        overflow: "hidden",
                    }}>
                        <div style={{ padding: "12px 16px" }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 10 }}>
                                <img
                                    src={lk.av}
                                    style={{
                                        width: 52, height: 52,
                                        borderRadius: "50%",
                                        border: `2px solid ${C.border}`,
                                        flexShrink: 0,
                                        background: C.bg1,
                                    }}
                                    onError={(e: any) => { e.target.src = FALLBACK_AV }}
                                />
                                <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                                        <span style={{ fontSize: 17, fontWeight: 800, color: C.header, lineHeight: 1.2 }}>
                                            {lk.user.globalName || lk.user.username}
                                        </span>
                                        {lk.user.globalName && (
                                            <span style={{ fontSize: 12, color: C.muted, fontWeight: 500 }}>@{lk.user.username}</span>
                                        )}
                                    </div>
                                    {lk.user.pronouns && (
                                        <div style={{ fontSize: 11, color: C.brandLight, marginTop: 2, fontWeight: 500 }}>
                                            {lk.user.pronouns}
                                        </div>
                                    )}
                                </div>
                                <div style={{
                                    width: 20, height: 20,
                                    borderRadius: "50%",
                                    background: "rgba(36,128,70,0.15)",
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    flexShrink: 0,
                                }}>
                                    <span style={{ color: C.green, display: "flex", transform: "scale(0.8)" }}><ico.check /></span>
                                </div>
                            </div>

                            {lk.user.bio && (
                                <div style={{ marginBottom: 10 }}>
                                    <div style={{ fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: 0.6, color: C.subheader, marginBottom: 4 }}>
                                        About Me
                                    </div>
                                    <div style={{
                                        fontSize: 12,
                                        color: C.text,
                                        lineHeight: 1.5,
                                        padding: "8px 10px",
                                        background: C.bg2,
                                        borderRadius: 8,
                                        border: `1px solid ${C.border}`,
                                        whiteSpace: "pre-wrap",
                                        wordBreak: "break-word",
                                    }}>
                                        {lk.user.bio}
                                    </div>
                                </div>
                            )}

                            <div style={{ height: 1, background: C.border, margin: "8px 0" }} />

                            {(() => {
                                const sf = decodeSnowflake(lk.user.id)
                                return sf && (
                                <div>
                                    <div style={{ fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: 0.6, color: C.subheader, marginBottom: 5 }}>
                                        Account Info
                                    </div>
                                    <div style={{
                                        display: "grid",
                                        gridTemplateColumns: "repeat(2, 1fr)",
                                        gap: 6,
                                    }}>
                                        <div
                                            onClick={() => copyId(lk.user.id)}
                                            style={{
                                                padding: "8px 10px",
                                                background: C.bg2,
                                                borderRadius: 8,
                                                border: `1px solid ${C.border}`,
                                                cursor: "pointer",
                                                transition: "border-color 150ms ease, background 150ms ease",
                                            }}
                                            onMouseEnter={e => { e.currentTarget.style.borderColor = C.bgEl; e.currentTarget.style.background = "#232428" }}
                                            onMouseLeave={e => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.background = C.bg2 }}
                                            title="Click to copy ID"
                                        >
                                            <div style={{ fontSize: 10, color: C.muted, marginBottom: 2, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.4 }}>User ID</div>
                                            <div style={{ fontSize: 11, fontFamily: "monospace", color: C.text, display: "flex", alignItems: "center", gap: 4 }}>
                                                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{lk.user.id}</span>
                                                <span style={{ color: copiedId ? C.green : C.muted, flexShrink: 0, transition: "color 150ms ease", display: "flex" }}>
                                                    {copiedId ? <ico.check /> : <ico.copy />}
                                                </span>
                                            </div>
                                        </div>

                                        <div style={{ padding: "8px 10px", background: C.bg2, borderRadius: 8, border: `1px solid ${C.border}` }}>
                                            <div style={{ fontSize: 10, color: C.muted, marginBottom: 2, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.4 }}>Created</div>
                                            <div style={{ fontSize: 11, color: C.text, fontWeight: 600 }}>
                                                {sf.date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
                                            </div>
                                            <div style={{ fontSize: 10, color: C.muted, marginTop: 1 }}>
                                                {sf.date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
                                            </div>
                                        </div>

                                        <div style={{ padding: "8px 10px", background: C.bg2, borderRadius: 8, border: `1px solid ${C.border}` }}>
                                            <div style={{ fontSize: 10, color: C.muted, marginBottom: 2, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.4 }}>Account Age</div>
                                            <div style={{ fontSize: 11, color: C.text, fontWeight: 600 }}>
                                                {(() => {
                                                    const diff = Date.now() - sf.timestamp
                                                    const years = Math.floor(diff / 31536000000)
                                                    const months = Math.floor((diff % 31536000000) / 2592000000)
                                                    const days = Math.floor((diff % 2592000000) / 86400000)
                                                    if (years > 0) return `${years}y ${months}mo`
                                                    if (months > 0) return `${months}mo ${days}d`
                                                    return `${days}d`
                                                })()}
                                            </div>
                                        </div>

                                        <div
                                            title={`Worker ${sf.workerId} · Process ${sf.processId} · Increment ${sf.increment}`}
                                            style={{ padding: "8px 10px", background: C.bg2, borderRadius: 8, border: `1px solid ${C.border}` }}
                                        >
                                            <div style={{ fontSize: 10, color: C.muted, marginBottom: 2, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.4 }}>Snowflake</div>
                                            <div style={{ fontSize: 11, fontFamily: "monospace", color: C.brandLight, fontWeight: 600 }}>
                                                w{sf.workerId} · p{sf.processId}
                                            </div>
                                            <div style={{ fontSize: 10, color: C.muted, marginTop: 1, fontFamily: "monospace" }}>
                                                inc {sf.increment}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                                )
                            })()}
                        </div>
                    </div>

                    <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.6, color: C.subheader, marginBottom: 6 }}>
                        label <span style={{ fontWeight: 500, color: C.muted, textTransform: "none" }}>(optional, only you see this)</span>
                    </div>
                    <AddLabelInput label={label} setLabel={setLabel} doAdd={doAdd} />

                    <div style={{ display: "flex", gap: 8 }}>
                        <button
                            onClick={doAdd}
                            style={{
                                flex: 1,
                                borderRadius: 20,
                                height: 40,
                                boxSizing: "border-box",
                                padding: "0 20px",
                                background: C.green,
                                color: "#ffffff",
                                border: "none",
                                fontSize: 14,
                                fontWeight: 600,
                                cursor: "pointer",
                                fontFamily: "inherit",
                                transition: "background 150ms ease",
                            }}
                            onMouseEnter={e => { e.currentTarget.style.background = "#2d9c5a" }}
                            onMouseLeave={e => { e.currentTarget.style.background = C.green }}
                        >
                            add to watchlist
                        </button>
                        <button
                            onClick={() => { setLk({ s: "idle" }); setLabel("") }}
                            style={{
                                borderRadius: 20,
                                height: 40,
                                boxSizing: "border-box",
                                padding: "0 18px",
                                background: "transparent",
                                color: C.text,
                                border: `1px solid ${C.border}`,
                                fontSize: 14,
                                fontWeight: 500,
                                cursor: "pointer",
                                fontFamily: "inherit",
                                transition: "background 150ms ease, border-color 150ms ease",
                            }}
                            onMouseEnter={e => {
                                e.currentTarget.style.background = "rgba(255,255,255,0.05)"
                                e.currentTarget.style.borderColor = C.bgEl
                            }}
                            onMouseLeave={e => {
                                e.currentTarget.style.background = "transparent"
                                e.currentTarget.style.borderColor = C.border
                            }}
                        >
                            cancel
                        </button>
                    </div>
                </div>
            )}
        </div>
    )
}

const OV_GROUPS = {
    messages: [
        { label: "messages",  key: "msgs",     gk: "globalMsgs",     Icon: ico.msg,      desc: "Notify on new messages" },
        { label: "edits",     key: "edits",    gk: "globalEdits",    Icon: ico.edit,     desc: "Notify on message edits" },
        { label: "deletes",   key: "deletes",  gk: "globalDeletes",  Icon: ico.del,      desc: "Notify on deleted messages" },
        { label: "typing",    key: "typing",   gk: "globalTyping",   Icon: ico.typing,   desc: "Notify when typing starts" },
    ],
    presence: [
        { label: "status",    key: "status",   gk: "globalStatus",   Icon: ico.status,   desc: "Notify on status changes" },
        { label: "activity",  key: "activity", gk: "globalActivity", Icon: ico.activity, desc: "Game/music activity (off by default)" },
        { label: "voice",     key: "voice",    gk: "globalVoice",    Icon: ico.voice,    desc: "Notify on voice channel activity" },
        { label: "joins",     key: "joins",    gk: "globalJoins",    Icon: ico.joins,    desc: "Notify on server joins / leaves" },
    ],
    profile: [
        { label: "profile",   key: "profile",  gk: "globalProfile",  Icon: ico.profile,  desc: "Notify on profile changes" },
        { label: "avatar",    key: "avatar",   gk: "globalAvatar",   Icon: ico.avatar,   desc: "Notify on avatar updates" },
    ],
} as const

type OvTab = "messages" | "presence" | "profile"
const OV_TAB_LABELS: Record<OvTab, string> = { messages: "Messages", presence: "Presence", profile: "Profile" }
const OV_TAB_ICONS: Record<OvTab, () => JSX.Element> = {
    messages: () => <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M2 22V4a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6l-4 4z"/></svg>,
    presence: () => <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="10" opacity=".25"/><circle cx="12" cy="12" r="5"/></svg>,
    profile:  () => <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>,
}

function LabelInput({ nick, setNick, saveNick }: { nick: string; setNick: (v: string) => void; saveNick: () => void }) {
    const [focused, setFocused] = React.useState(false)
    return (
        <input
            placeholder="label"
            maxLength={50}
            value={nick}
            onChange={(e) => setNick(e.target.value.slice(0, 50))}
            onBlur={() => { setFocused(false); saveNick() }}
            onFocus={() => setFocused(true)}
            onKeyDown={(e) => { if (e.key === "Enter") { setFocused(false); saveNick() } }}
            style={{
                background: C.bg1,
                borderRadius: 20,
                border: `1px solid ${focused ? C.brand : C.border}`,
                boxShadow: focused ? "0 0 0 3px rgba(88,101,242,0.18)" : "none",
                height: 26,
                boxSizing: "border-box",
                display: "flex",
                alignItems: "center",
                padding: "0 10px",
                fontSize: 12,
                width: "100%",
                margin: 0,
                color: C.text,
                outline: "none",
                transition: "border-color 150ms ease, box-shadow 150ms ease",
                fontFamily: "inherit",
            }}
        />
    )
}

function SearchInput({ query, setQuery }: { query: string; setQuery: (v: string) => void }) {
    const [focused, setFocused] = React.useState(false)
    return (
        <div style={{ position: "relative", width: 160, flexShrink: 0 }}>
            <input
                placeholder="search…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onBlur={() => setFocused(false)}
                onFocus={() => setFocused(true)}
                style={{
                    background: "#1e1f22",
                    borderRadius: 20,
                    border: `1px solid ${focused ? C.brand : "#3f4147"}`,
                    boxShadow: focused ? "0 0 0 3px rgba(88,101,242,0.18)" : "none",
                    height: 28,
                    boxSizing: "border-box",
                    padding: "0 28px 0 12px",
                    width: "100%",
                    fontSize: 13,
                    color: "#dbdee1",
                    outline: "none",
                    fontFamily: "inherit",
                    transition: "border-color 150ms ease, box-shadow 150ms ease",
                }}
            />
            <div style={{
                position: "absolute",
                right: 8,
                top: "50%",
                transform: "translateY(-50%)",
                color: "#949ba4",
                display: query ? "none" : "flex",
                alignItems: "center",
                pointerEvents: "none",
            }}>
                <ico.search />
            </div>
            {query && (
                <div
                    role="button"
                    onClick={() => setQuery("")}
                    style={{
                        position: "absolute",
                        right: 8,
                        top: "50%",
                        transform: "translateY(-50%)",
                        color: "#949ba4",
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        lineHeight: 1,
                    }}
                >
                    <ico.x />
                </div>
            )}
        </div>
    )
}

function previewNotification(uid: string, type: string) {
    const u = UserStore.getUser(uid)
    const label = getWatchedUser(settings, uid)?.nick
    const name = displayName(u) || uid
    const dn = label ? `${label} (${name})` : name
    const icon = u ? avatarUrl(u.id, (u as any).avatar) : undefined

    const previews: Record<string, { title: string; body: string }> = {
        msgs:     { title: `${dn} sent a message`, body: "This is a preview of how message notifications will appear." },
        edits:    { title: `${dn} edited a message`, body: `"before" → "after preview text"` },
        deletes:  { title: `${dn} deleted a message`, body: `"this is a preview of deleted message content"` },
        typing:   { title: `${dn} is typing…`, body: "in #general" },
        status:   { title: `${dn} is now online`, body: "was: offline" },
        activity: { title: `${dn} is playing Game Name`, body: "doing something - details here" },
        voice:    { title: `${dn} joined voice`, body: "#General Voice" },
        joins:    { title: `${dn} joined a server`, body: "Server Name" },
        profile:  { title: `${dn} updated their profile`, body: "bio, display name" },
        avatar:   { title: `${dn} changed their avatar`, body: "click to see new pfp" },
    }

    const p = previews[type] || { title: `${dn}: ${type}`, body: "preview notification" }
    notify({ title: "[Preview] " + p.title, body: p.body, icon })
}

// known-good public logos - only apps i can confirm resolve, no guessing broken urls
const MUSIC_APP_ICONS: Record<string, string> = {
    "spotify":        "https://cdn.simpleicons.org/spotify/1ED760",
    "apple music":    "https://cdn.simpleicons.org/applemusic/FA243C",
    "youtube music":  "https://cdn.simpleicons.org/youtubemusic/FF0000",
    "tidal":          "https://cdn.simpleicons.org/tidal/000000",
    "deezer":         "https://cdn.simpleicons.org/deezer/FEAA2D",
    "soundcloud":     "https://cdn.simpleicons.org/soundcloud/FF5500",
    "pandora":        "https://cdn.simpleicons.org/pandora/224099",
    "qobuz":          "https://cdn.simpleicons.org/qobuz/000000",
    "last.fm":        "https://cdn.simpleicons.org/lastdotfm/D51007",
}

// one resolver for games and listening. only works when discord actually sends asset
// data though - a lot of games (minecraft's xbox rpc included) send just an appId with
// no assets, so the icon has to come from the app's own public record instead - see below
const appIconCache: Record<string, string | null> = {}
const _appIconFetching: Partial<Record<string, Promise<string | null>>> = {}

async function fetchAppIcon(appId: string): Promise<string | null> {
    if (appId in appIconCache) return appIconCache[appId]
    if (_appIconFetching[appId]) return _appIconFetching[appId]
    const p = (async () => {
        try {
            const { body } = await RestAPI.get({ url: `/applications/${appId}/rpc` })
            const icon = body?.icon
            const url = icon ? `https://cdn.discordapp.com/app-icons/${appId}/${icon}.png?size=128` : null
            appIconCache[appId] = url
            return url
        } catch {
            appIconCache[appId] = null
            return null
        } finally {
            delete _appIconFetching[appId]
        }
    })()
    _appIconFetching[appId] = p
    return p
}

function resolveActivityImage(act: any): string {
    const img = act.assets?.large_image || act.assets?.largeImage || ""
    const appId = act.application_id || act.applicationId || ""
    if (img.startsWith("spotify:")) return `https://i.scdn.co/image/${img.slice(8)}`
    if (img.startsWith("twitch:")) return `https://static-cdn.jtvnw.net/previews-ttv/live_user_${img.slice(7)}-256x144.jpg`
    if (img.startsWith("youtube:")) return `https://i.ytimg.com/vi/${img.slice(8)}/hqdefault.jpg`
    if (img.startsWith("mp:external/")) return `https://media.discordapp.net/external/${img.slice(12)}`
    if (img.startsWith("mp:app-asset/")) return `https://media.discordapp.net/app-assets/${img.slice(13)}`
    if (img.startsWith("mp:")) return `https://media.discordapp.net/${img.slice(3)}`
    if (img.startsWith("http")) return img
    // some console-linked / embedded RPCs (Xbox, PlayStation, activity SDK games) send the
    // media-proxy path without discord's "mp:" scheme in front - same asset, missing prefix.
    // these got dropped straight to the controller icon before since they don't match any
    // case above and always contain a "/", tripping the old blanket "!img.includes(':')" guard.
    if (img.startsWith("external/")) return `https://media.discordapp.net/${img}`
    if (img.startsWith("app-asset/")) return `https://media.discordapp.net/${img}`
    if (appId && img && !img.includes(":")) return `https://cdn.discordapp.com/app-assets/${appId}/${img}.png`
    if (act.type === 2) return MUSIC_APP_ICONS[(act.name || "").toLowerCase()] || ""
    return ""
}

function getActivityIconKey(entry: ActivityEntry): keyof typeof actIco {
    const type = entry.type
    const meta = entry.metadata || {}

    // exact type first so a msg containing "spotify" isn't mis-tagged
    if (type === "msg") return "message"
    if (type === "edit") return "edit"
    if (type === "delete") return "delete"
    if (type === "typing") return "typing"
    if (type === "profile") return "profile"
    if (type === "avatar") return "avatar"
    if (type === "banner") return "banner"
    if (type === "bio") return "bio"
    if (type === "username" || type === "displayname") return "username"
    if (type === "pronouns") return "pronouns"
    if (type === "custom_status") return "customStatus"
    if (type === "join") return "join"
    if (type === "leave") return "leave"
    if (type === "vc_move") return "vcMove"
    if (type === "game_start" || type === "game_stop") return "playing"
    if (type === "spotify") return "listening"
    if (type === "streaming") return "watching"
    if (type === "online") return "online"
    if (type === "offline") return "offline"
    if (type === "idle") return "idle"
    if (type === "dnd") return "dnd"

    // camera/screenshare log as type "voice" while live, check metadata
    if (type === "voice" || type === "vc_join" || type === "vc_leave") {
        const action = (meta.action || "").toLowerCase()
        if (action.includes("camera")) return "camera"
        if (action.includes("stream") || action.includes("screen")) return "screen"
        return "voice"
    }

    // activity/session are generic - real kind lives in metadata
    if (type === "activity" || type === "session") {
        const action = (meta.action || "").toLowerCase()
        const activityType = meta.type

        if (action === "status_session") return "status"
        if (action.includes("listening") || activityType === 2 || meta.trackId) return "listening"
        if (action.includes("voice")) return "voice"
        if (action.includes("camera")) return "camera"
        if (action.includes("stream") || action.includes("screen")) return "screen"
        if (action.includes("game") || activityType === 0) return "playing"
        if (activityType === 1) return "watching"

        return "session"
    }

    if (type === "status") return "status"

    return "session"
}

function formatDuration(ms: number): string {
    if (!ms || ms < 0) return "0m"
    const totalSeconds = Math.floor(ms / 1000)
    const mins = Math.floor(totalSeconds / 60)
    const hours = Math.floor(mins / 60)
    const days = Math.floor(hours / 24)

    if (days > 0) {
        const remainingHours = hours % 24
        const remainingMins = mins % 60
        if (remainingHours > 0 && remainingMins > 0) return `${days}d ${remainingHours}h ${remainingMins}m`
        if (remainingHours > 0) return `${days}d ${remainingHours}h`
        return `${days}d ${remainingMins}m`
    }
    if (hours > 0) {
        const remainingMins = mins % 60
        if (remainingMins > 0) return `${hours}h ${remainingMins}m`
        return `${hours}h`
    }
    if (mins > 0) {
        const remainingSecs = totalSeconds % 60
        if (remainingSecs > 0) return `${mins}m ${remainingSecs}s`
        return `${mins}m`
    }
    return `${totalSeconds}s`
}

const _albumColorCache: Record<string, string> = {}
const ALBUM_CACHE_MAX = 300  // small hex strings, but cap it so long sessions don't grow this forever

function extractAlbumColor(imageUrl: string): Promise<string> {
    if (_albumColorCache[imageUrl]) return Promise.resolve(_albumColorCache[imageUrl])
    return new Promise((resolve) => {
        const img = new Image()
        img.crossOrigin = "anonymous"
        img.onload = () => {
            try {
                const canvas = document.createElement("canvas")
                const ctx = canvas.getContext("2d")
                if (!ctx) { resolve("#1ed760"); return }
                const size = 64
                canvas.width = size
                canvas.height = size
                ctx.drawImage(img, 0, 0, size, size)
                const data = ctx.getImageData(0, 0, size, size).data

                const buckets: Record<string, { r: number; g: number; b: number; count: number; satSum: number }> = {}
                const bucketSize = 24 // quantize to 24-unit steps

                for (let i = 0; i < data.length; i += 8) { // sample every 2nd pixel for speed
                    const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3]
                    if (a < 128) continue

                    const max = Math.max(r, g, b)
                    const min = Math.min(r, g, b)
                    const lum = (max + min) / 2
                    // Skip near-white, near-black, and very low saturation
                    if (lum < 35 || lum > 240) continue
                    if (max - min < 30) continue // too gray

                    const sat = max === 0 ? 0 : (max - min) / max
                    if (sat < 0.15) continue // skip low saturation

                    const br = Math.floor(r / bucketSize) * bucketSize
                    const bg = Math.floor(g / bucketSize) * bucketSize
                    const bb = Math.floor(b / bucketSize) * bucketSize
                    const key = `${br},${bg},${bb}`

                    if (!buckets[key]) buckets[key] = { r: 0, g: 0, b: 0, count: 0, satSum: 0 }
                    buckets[key].r += r
                    buckets[key].g += g
                    buckets[key].b += b
                    buckets[key].count++
                    buckets[key].satSum += sat
                }

                let bestKey = ""
                let bestScore = 0
                for (const key in buckets) {
                    const b = buckets[key]
                                const avgSat = b.satSum / b.count
                    const score = b.count * avgSat
                    if (score > bestScore) {
                        bestScore = score
                        bestKey = key
                    }
                }

                let hex: string
                if (bestKey && buckets[bestKey]) {
                    const b = buckets[bestKey]
                    const avgR = Math.round(b.r / b.count)
                    const avgG = Math.round(b.g / b.count)
                    const avgB = Math.round(b.b / b.count)
                    hex = `#${avgR.toString(16).padStart(2, "0")}${avgG.toString(16).padStart(2, "0")}${avgB.toString(16).padStart(2, "0")}`
                } else {
                    hex = "#1ed760"
                }

                _albumColorCache[imageUrl] = hex
                const keys = Object.keys(_albumColorCache)
                if (keys.length > ALBUM_CACHE_MAX) delete _albumColorCache[keys[0]]
                resolve(hex)
            } catch {
                resolve("#1ed760")
            }
        }
        img.onerror = () => resolve("#1ed760")
        img.src = imageUrl
    })
}
function hexToRgba(hex: string, alpha: number): string {
    const r = parseInt(hex.slice(1, 3), 16)
    const g = parseInt(hex.slice(3, 5), 16)
    const b = parseInt(hex.slice(5, 7), 16)
    return `rgba(${r},${g},${b},${alpha})`
}

const ACTIVITY_CATEGORIES = [
    { key: "msg" as ActivityType, label: "Messages", Icon: ico.catMsg, color: "#5865f2" },
    { key: "edit" as ActivityType, label: "Edits", Icon: ico.catEdit, color: "#f0b232" },
    { key: "delete" as ActivityType, label: "Deletes", Icon: ico.catDelete, color: "#da373c" },
    { key: "typing" as ActivityType, label: "Typing", Icon: ico.catTyping, color: "#949cf4" },
    { key: "status" as ActivityType, label: "Status", Icon: ico.catStatus, color: "#23a55a" },
    { key: "voice" as ActivityType, label: "Voice", Icon: ico.catVoice, color: "#dbdee1" },
    { key: "profile" as ActivityType, label: "Profile", Icon: ico.catProfile, color: "#ff6b6b" },
    { key: "activity" as ActivityType, label: "Activity", Icon: ico.catActivity, color: "#f0b232" },
] as const

function matchesCategory(log: ActivityEntry, category: ActivityType): boolean {
    if (category === "msg") return log.type === "msg"
    if (category === "edit") return log.type === "edit"
    if (category === "delete") return log.type === "delete"
    if (category === "typing") return log.type === "typing"
    if (category === "status") {
        return log.type === "online" || log.type === "offline" || log.type === "idle" || log.type === "dnd" || log.type === "status" || log.type === "custom_status" || (log.type === "session" && log.metadata?.action === "status_session")
    }
    if (category === "voice") return log.type === "voice" || log.type === "vc_join" || log.type === "vc_leave" || log.type === "vc_move" || (log.type === "session" && (["voice_session", "stream_session", "camera_session"].includes(log.metadata?.action || "") || (log.metadata?.action || "").includes("voice")))
    if (category === "profile") return log.type === "profile" || log.type === "avatar" || log.type === "banner" || log.type === "bio" || log.type === "username" || log.type === "displayname" || log.type === "pronouns"
    if (category === "activity") return log.type === "activity" || log.type === "game_start" || log.type === "game_stop" || log.type === "spotify" || log.type === "streaming" || (log.type === "session" && (log.metadata?.action || "").includes("activity"))
    return log.type === category
}

function ActivityCardIcon({ log }: { log: ActivityEntry }) {
    const [failed, setFailed] = React.useState(false)
    const isListening = log.metadata?.type === 2 || (log.metadata?.action || "").includes("listening")
    const appLogo = isListening ? MUSIC_APP_ICONS[(log.metadata?.appName || "").toLowerCase()] : ""
    const storedUrl = log.metadata?.iconUrl || log.metadata?.gameIconUrl || (isListening ? "" : log.metadata?.albumArtUrl) || ""
    const appId = log.metadata?.applicationId || ""
    // heals old entries logged before appIconCache existed
    const [healedUrl, setHealedUrl] = React.useState(() => (appId ? appIconCache[appId] || "" : ""))
    React.useEffect(() => {
        if (storedUrl || !appId || healedUrl || appIconCache[appId] !== undefined) return
        let live = true
        fetchAppIcon(appId).then(url => { if (live && url) setHealedUrl(url) }).catch(() => {})
        return () => { live = false }
    }, [storedUrl, appId, healedUrl])
    const realUrl = appLogo || storedUrl || healedUrl
    const key = getActivityIconKey(log)
    const { Icon, color } = actIco[key]
    const showImg = realUrl && !failed
    return (
        <div data-ur-card-icon className="ur-log-icon" style={{
            width: 42, height: 42, borderRadius: appLogo ? "50%" : 12,
            display: "flex", alignItems: "center", justifyContent: "center",
            flexShrink: 0, marginTop: 1, overflow: "hidden",
            background: showImg ? C.bg1 : `${color}1c`,
            border: appLogo ? "none" : `1px solid ${showImg ? C.border : color + "40"}`,
            color,
        }}>
            {showImg
                ? <img src={realUrl} onError={() => setFailed(true)} style={{ width: "100%", height: "100%", objectFit: appLogo ? "contain" : "cover", padding: appLogo ? 4 : 0 }} />
                : <Icon />}
        </div>
    )
}

// on-avatar status badges - built from the provided status SVG set instead of flat
// color dots. online/dnd/offline are complete self-contained badge shapes already;
// idle's source asset is just the crescent glyph with no backing circle, so it gets
// composited onto a solid circle here (crescent recolored to the card bg to "bite" it)
// to read as a full badge like the other three, matching Discord's real idle icon.
function StatusBadgeIcon({ status }: { status: string }) {
    if (status === "online") {
        return (
            <svg viewBox="0 0 16 16" width="100%" height="100%">
                <path d="M16 8C16 12.4183 12.4183 16 8 16C3.58172 16 0 12.4183 0 8C0 3.58172 3.58172 0 8 0C12.4183 0 16 3.58172 16 8Z" fill="#45a366" />
            </svg>
        )
    }
    if (status === "dnd") {
        return (
            <svg viewBox="0 0 16 16" width="100%" height="100%">
                <path fillRule="evenodd" clipRule="evenodd" d="M8 16C3.58172 16 0 12.4183 0 8C0 3.58172 3.58172 0 8 0C12.4183 0 16 3.58172 16 8C16 12.4183 12.4183 16 8 16ZM5.24902 7C4.69674 7 4.24902 7.44772 4.24902 8C4.24902 8.55229 4.69674 9 5.24902 9H10.7499C11.3022 9 11.7499 8.55229 11.7499 8C11.7499 7.44772 11.3022 7 10.7499 7H5.24902Z" fill="#e00000" />
            </svg>
        )
    }
    if (status === "idle") {
        return (
            <svg viewBox="0 0 24 24" width="100%" height="100%" style={{ transform: "scaleX(-1)" }}>
                <path d="M12.0557 3.59974C12.2752 3.2813 12.2913 2.86484 12.0972 2.53033C11.9031 2.19582 11.5335 2.00324 11.1481 2.03579C6.02351 2.46868 2 6.76392 2 12C2 17.5228 6.47715 22 12 22C17.236 22 21.5313 17.9764 21.9642 12.8518C21.9967 12.4664 21.8041 12.0968 21.4696 11.9027C21.1351 11.7086 20.7187 11.7248 20.4002 11.9443C19.4341 12.6102 18.2641 13 17 13C13.6863 13 11 10.3137 11 6.99996C11 5.73589 11.3898 4.56587 12.0557 3.59974Z" fill="#ffc04e" />
            </svg>
        )
    }
    // offline / invisible - hollow ring, same as Discord's real offline badge
    return (
        <svg viewBox="0 0 16 16" width="100%" height="100%">
            <path fillRule="evenodd" clipRule="evenodd" d="M8 2C4.68629 2 2 4.68629 2 8C2 11.3137 4.68629 14 8 14C11.3137 14 14 11.3137 14 8C14 4.68629 11.3137 2 8 2ZM0 8C0 3.58172 3.58172 0 8 0C12.4183 0 16 3.58172 16 8C16 12.4183 12.4183 16 8 16C3.58172 16 0 12.4183 0 8Z" fill="#84858d" />
        </svg>
    )
}

function LogCard({ log, expanded, onToggle, onDelete, userId, index }: {
    log: ActivityEntry
    expanded: boolean
    onToggle: () => void
    onDelete: (id: string) => void
    userId: string
    index?: number
}) {
    return (
            <div
                key={log.id}
                data-ur-card-body
                className={`ur-log-card${expanded ? " open" : ""}`}
                onClick={() => onToggle()}
                style={{
                    display: "flex",
                    gap: 14,
                    padding: "14px 16px",
                    borderRadius: 18,
                    background: expanded
                        ? "linear-gradient(135deg, rgba(255,255,255,0.065) 0%, rgba(255,255,255,0.03) 100%)"
                        : "linear-gradient(135deg, rgba(255,255,255,0.045) 0%, rgba(255,255,255,0.02) 100%)",
                    border: `1px solid ${expanded ? C.bgEl : C.border}`,
                    marginBottom: 6,
                    cursor: "pointer",
                    minHeight: 56,
                    animationDelay: `${Math.min(index ?? 0, 12) * 22}ms`,
                }}
            >
                <ActivityCardIcon log={log} />
                <div style={{ flex: 1, minWidth: 0 }}>
                    {(() => {
                        // Check if this log entry has an ongoing active session
                        const isLiveSession = Object.values(activeSessions).some(s => s.logId === log.id)
                        return isLiveSession ? (
                            <div data-ur-card-live style={{
                                display: "inline-flex",
                                alignItems: "center",
                                gap: 5,
                                fontSize: 10,
                                fontWeight: 800,
                                textTransform: "uppercase",
                                letterSpacing: 0.6,
                                color: "#23a55a",
                                background: "rgba(35,165,90,0.12)",
                                border: "1px solid rgba(35,165,90,0.3)",
                                borderRadius: 8,
                                padding: "3px 8px",
                                marginBottom: 5,
                            }}>
                                <span className="ur-blink-dot" style={{ display: "inline-block", width: 6, height: 6, borderRadius: "50%", background: "#23a55a", flexShrink: 0 }} />
                                Live
                            </div>
                        ) : null
                    })()}
                    <div data-ur-card-title style={{
                        fontSize: log.type === "msg" || log.type === "edit" || log.type === "delete" ? 15 : 14,
                        fontWeight: 800,
                        color: C.header,
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        marginBottom: 4,
                    }}>
                        <span style={{ wordBreak: "break-word", flex: 1, minWidth: 0 }}>
                            {(() => {
                                // still in vc - show "In #channel" not "joined"
                                const isLive = Object.values(activeSessions).some(s => s.logId === log.id)
                                if (isLive && log.type === "voice" && log.metadata?.action === "joined") {
                                    return `In #${log.metadata.channel || "voice"}`
                                }
                                return log.title
                            })()}
                        </span>
                        <span style={{
                            fontSize: 12,
                            color: C.subheader,
                            fontWeight: 700,
                            background: C.bg1,
                            padding: "4px 10px",
                            borderRadius: 8,
                            border: `1px solid ${C.border}`,
                            flexShrink: 0,
                            whiteSpace: "nowrap",
                            display: "flex",
                            alignItems: "center",
                            gap: 6,
                        }} title={exactTime(log.ts)}>
                            <span style={{ display: "flex", alignItems: "center" }}><ico.clock /></span>
                            {new Date(log.ts).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", hour12: true })}
                            <span style={{ color: C.muted, fontWeight: 500 }}>· {timeAgo(log.ts)}</span>
                        </span>
                        <div className={`ur-log-chevron${expanded ? " open" : ""}`} title={expanded ? "Collapse" : "Expand"}>
                            <ico.chevron />
                        </div>
                        <div
                            role="button"
                            title="Delete this entry"
                            onClick={async (e) => {
                                e.stopPropagation()
                                if (!confirm("Delete this activity entry?")) return
                                await activityStore.removeLog(userId, log.id)
                                onDelete(log.id)
                            }}
                            style={{
                                padding: "4px 8px",
                                borderRadius: 6,
                                cursor: "pointer",
                                background: "transparent",
                                color: C.muted,
                                fontSize: 11,
                                fontWeight: 700,
                                display: "flex",
                                alignItems: "center",
                                opacity: 0.4,
                                transition: "opacity 150ms ease, background 150ms ease, color 150ms ease",
                            }}
                            onMouseEnter={e => {
                                e.currentTarget.style.opacity = "1"
                                e.currentTarget.style.background = "rgba(218,55,60,0.12)"
                                e.currentTarget.style.color = C.red
                            }}
                            onMouseLeave={e => {
                                e.currentTarget.style.opacity = "0.4"
                                e.currentTarget.style.background = "transparent"
                                e.currentTarget.style.color = C.muted
                            }}
                        >
                            <ico.trash />
                        </div>
                    </div>
                    {log.body && log.body !== log.title && log.type !== "activity" && log.type !== "session" && log.type !== "edit" && log.metadata?.action !== "status_session" && (
                        <div data-ur-card-body-text={(log.type === "msg" || log.type === "delete") ? "content" : "meta"} style={{
                            fontSize: log.type === "msg" || log.type === "delete" ? 14 : 13,
                            color: log.type === "msg" || log.type === "delete" ? C.text : C.muted,
                            lineHeight: 1.4,
                            wordBreak: "break-word",
                            fontWeight: log.type === "msg" || log.type === "delete" ? 500 : 400,
                            marginTop: log.type === "msg" || log.type === "delete" ? 2 : 0,
                        }}>
                            {log.body}
                        </div>
                    )}
                    {(log.type === "msg" || log.type === "edit" || log.type === "delete" || log.type === "voice" || log.type === "activity" || (log.type === "session" && ["listening_session", "activity_session", "voice_session", "camera_session", "stream_session"].includes(log.metadata?.action))) && (
                        <div data-ur-card-location style={{
                            fontSize: 11,
                            color: C.subheader,
                            marginTop: 4,
                            display: "flex",
                            alignItems: "center",
                            gap: 5,
                        }}>
                            <span style={{ opacity: 0.5, display: "flex", alignItems: "center" }}><ico.location /></span>
                            <span>
                                {(log.type === "activity" || log.type === "session") && log.metadata?.appName
                                    ? log.metadata.appName
                                    : log.metadata?.server || "Unknown"}
                                {log.metadata?.channel ? ` · #${log.metadata.channel}` : ""}
                            </span>
                        </div>
                    )}
                    {log.type === "session" && log.metadata?.action === "status_session" && (
                        <div data-ur-card-location style={{
                            fontSize: 11,
                            color: C.subheader,
                            marginTop: 4,
                            display: "flex",
                            alignItems: "center",
                            gap: 5,
                        }}>
                            <span style={{ opacity: 0.5, display: "flex", alignItems: "center" }}><ico.status /></span>
                            <span>
                                {log.metadata?.platform ? `${CLIENT_EMOJI[log.metadata.platform.toLowerCase()] || "📡"} ${log.metadata.platform}` : "Status session"}
                                {log.metadata?.duration ? ` · ${log.metadata.duration}` : ""}
                            </span>
                        </div>
                    )}
                    {log.type === "edit" && log.metadata?.before && (
                        <div style={{
                            marginTop: 10,
                            borderRadius: 14,
                            overflow: "hidden",
                            border: `1px solid rgba(240,178,50,0.25)`,
                        }}>
                            <div style={{ padding: "8px 14px", background: "rgba(240,178,50,0.08)", fontSize: 10, fontWeight: 800, color: "#f0b232", textTransform: "uppercase", letterSpacing: 0.6, display: "flex", alignItems: "center", gap: 6 }}>
                                <ico.edit />
                                Message Edit
                            </div>
                            <div style={{ padding: "10px 14px", borderBottom: log.metadata?.after ? `1px solid rgba(240,178,50,0.15)` : "none", background: "rgba(218,55,60,0.06)" }}>
                                <div style={{ fontSize: 9, fontWeight: 800, color: C.muted, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 5 }}>Before</div>
                                <span style={{ fontSize: 12, textDecoration: "line-through", opacity: 0.7, wordBreak: "break-word", lineHeight: 1.5, color: C.text }}>
                                    {trunc(log.metadata.before, 300)}
                                </span>
                            </div>
                            {log.metadata?.after && (
                                <div style={{ padding: "10px 14px", background: "rgba(36,128,70,0.06)" }}>
                                    <div style={{ fontSize: 9, fontWeight: 800, color: C.muted, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 5 }}>After</div>
                                    <span style={{ fontSize: 12, wordBreak: "break-word", lineHeight: 1.5, color: C.text }}>
                                        {trunc(log.metadata.after, 300)}
                                    </span>
                                </div>
                            )}
                        </div>
                    )}
                    <div className={`ur-expand${expanded ? " open" : ""}`}>
                        <div className={expanded ? "ur-log-expand-in" : ""}>
                            {(log.channelId || log.guildId) && (
                                <div
                                    onClick={(e) => { e.stopPropagation(); jumpTo(log.guildId, log.channelId, log.msgId) }}
                                    style={{
                                        marginTop: 10,
                                        padding: "10px 16px",
                                        background: C.brand,
                                        borderRadius: 10,
                                        color: C.white,
                                        fontSize: 13,
                                        fontWeight: 700,
                                        cursor: "pointer",
                                        textAlign: "center",
                                        fontFamily: "inherit",
                                        transition: "background 150ms ease",
                                        display: "flex",
                                        alignItems: "center",
                                        justifyContent: "center",
                                        gap: 6,
                                    }}
                                    onMouseEnter={e => { e.currentTarget.style.background = "#4752c4" }}
                                    onMouseLeave={e => { e.currentTarget.style.background = C.brand }}
                                >
                                    <ico.external />
                                    Jump to Discord
                                </div>
                            )}
                            {/* Profile field before/after diff card */}
                            {(["username","displayname","bio","banner","pronouns","custom_status","avatar"] as ActivityType[]).includes(log.type) && log.metadata && (log.metadata.before !== undefined || log.metadata.after !== undefined || log.metadata.oldAvatar !== undefined || log.metadata.newAvatar !== undefined) && (
                                <div style={{
                                    marginTop: 10,
                                    borderRadius: 14,
                                    overflow: "hidden",
                                    border: `1px solid rgba(255,107,107,0.3)`,
                                }}>
                                    {/* Header */}
                                    <div style={{
                                        padding: "8px 14px",
                                        background: "rgba(255,107,107,0.12)",
                                        fontSize: 10,
                                        fontWeight: 800,
                                        textTransform: "uppercase",
                                        letterSpacing: 0.6,
                                        color: "#ff6b6b",
                                        display: "flex",
                                        alignItems: "center",
                                        gap: 6,
                                    }}>
                                        <span style={{ display: "flex", alignItems: "center", transform: "scale(0.7)" }}>
                                            {(() => {
                                                const key = getActivityIconKey(log)
                                                const { Icon } = actIco[key]
                                                return <Icon />
                                            })()}
                                        </span>
                                        <span>{FIELD_NAME[log.metadata.field ?? ""] ?? log.type.replace("_", " ")} change</span>
                                    </div>
                                    {/* Avatar images row */}
                                    {log.type === "avatar" && (log.metadata.oldAvatar || log.metadata.newAvatar) && (
                                        <div style={{
                                            display: "flex",
                                            gap: 12,
                                            padding: "14px",
                                            background: C.bg1,
                                            alignItems: "center",
                                        }}>
                                            <div style={{ textAlign: "center" }}>
                                                <div style={{ fontSize: 9, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 }}>Before</div>
                                                {log.metadata.oldAvatar
                                                    ? <img src={log.metadata.oldAvatar} style={{ width: 64, height: 64, borderRadius: "50%", border: `2px solid ${C.border}` }} onError={(e: any) => { e.target.style.display = "none" }} />
                                                    : <div style={{ width: 64, height: 64, borderRadius: "50%", background: C.bg2, border: `2px solid ${C.border}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18 }}>🚫</div>
                                                }
                                            </div>
                                            <div style={{ fontSize: 20, color: C.muted, flexShrink: 0 }}>→</div>
                                            <div style={{ textAlign: "center" }}>
                                                <div style={{ fontSize: 9, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 }}>After</div>
                                                {log.metadata.newAvatar
                                                    ? <img src={log.metadata.newAvatar} style={{ width: 64, height: 64, borderRadius: "50%", border: `2px solid rgba(255,107,107,0.5)` }} onError={(e: any) => { e.target.style.display = "none" }} />
                                                    : <div style={{ width: 64, height: 64, borderRadius: "50%", background: C.bg2, border: `2px solid rgba(255,107,107,0.5)`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18 }}>🚫</div>
                                                }
                                            </div>
                                        </div>
                                    )}
                                    {/* Text before/after */}
                                    {log.type !== "avatar" && (
                                        <div style={{ background: C.bg1 }}>
                                            {log.metadata.before != null && (
                                                <div style={{ padding: "10px 14px", borderBottom: `1px solid ${C.border}` }}>
                                                    <div style={{ fontSize: 9, fontWeight: 800, textTransform: "uppercase", letterSpacing: 0.5, color: C.muted, marginBottom: 5 }}>Before</div>
                                                    <div style={{
                                                        fontSize: 12,
                                                        color: C.text,
                                                        background: "rgba(218,55,60,0.08)",
                                                        border: "1px solid rgba(218,55,60,0.25)",
                                                        borderRadius: 8,
                                                        padding: "8px 10px",
                                                        whiteSpace: "pre-wrap",
                                                        wordBreak: "break-word",
                                                        lineHeight: 1.5,
                                                        textDecoration: "line-through",
                                                        opacity: 0.8,
                                                    }}>
                                                        {String(log.metadata.before)}
                                                    </div>
                                                </div>
                                            )}
                                            {log.metadata.after != null && (
                                                <div style={{ padding: "10px 14px" }}>
                                                    <div style={{ fontSize: 9, fontWeight: 800, textTransform: "uppercase", letterSpacing: 0.5, color: C.muted, marginBottom: 5 }}>After</div>
                                                    <div style={{
                                                        fontSize: 12,
                                                        color: C.text,
                                                        background: "rgba(36,128,70,0.08)",
                                                        border: "1px solid rgba(36,128,70,0.25)",
                                                        borderRadius: 8,
                                                        padding: "8px 10px",
                                                        whiteSpace: "pre-wrap",
                                                        wordBreak: "break-word",
                                                        lineHeight: 1.5,
                                                    }}>
                                                        {String(log.metadata.after)}
                                                    </div>
                                                </div>
                                            )}
                                            {log.metadata.after == null && log.metadata.before != null && (
                                                <div style={{ padding: "10px 14px" }}>
                                                    <div style={{ fontSize: 9, fontWeight: 800, textTransform: "uppercase", letterSpacing: 0.5, color: C.muted, marginBottom: 5 }}>After</div>
                                                    <div style={{
                                                        fontSize: 12,
                                                        color: C.muted,
                                                        fontStyle: "italic",
                                                        padding: "8px 10px",
                                                    }}>
                                                        (removed)
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                            )}
                            {log.metadata && log.type !== "msg" && log.type !== "edit" && log.type !== "delete" && !(["username","displayname","bio","banner","pronouns","custom_status","avatar"] as ActivityType[]).includes(log.type) && (
                                <div style={{
                                    marginTop: 10,
                                    padding: "12px 16px",
                                    background: C.bg1,
                                    borderRadius: 12,
                                    fontSize: 12,
                                    color: C.muted,
                                    lineHeight: 1.6,
                                    border: `1px solid ${C.border}`,
                                }}>
                                    {log.metadata.song && (
                                        <div
                                            ref={(el: any) => {
                                                if (!el || !log.metadata?.albumArtUrl) return
                                                const cached = _albumColorCache[log.metadata.albumArtUrl]
                                                if (cached) {
                                                    el.style.background = hexToRgba(cached, 0.06)
                                                    el.style.borderColor = hexToRgba(cached, 0.35)
                                                    return
                                                }
                                                extractAlbumColor(log.metadata!.albumArtUrl!).then((hex: string) => {
                                                    if (el) {
                                                        el.style.background = hexToRgba(hex, 0.06)
                                                        el.style.borderColor = hexToRgba(hex, 0.35)
                                                    }
                                                })
                                            }}
                                            style={{
                                                display: "flex",
                                                gap: 0,
                                                marginBottom: 12,
                                                borderRadius: 10,
                                                border: "1px solid rgba(30,215,96,0.2)",
                                                overflow: "hidden",
                                                background: "rgba(30,215,96,0.06)",
                                                transition: "background 300ms ease, border-color 300ms ease",
                                                position: "relative",
                                                minHeight: 160,
                                            }}
                                        >
                                            {log.metadata.albumArtUrl && (
                                                <div style={{
                                                    position: "relative",
                                                    width: 160,
                                                    height: 160,
                                                    overflow: "hidden",
                                                    borderRadius: 10,
                                                    flexShrink: 0,
                                                    alignSelf: "center",
                                                }}>
                                                    <img
                                                        src={log.metadata.albumArtUrl}
                                                        style={{
                                                            position: "absolute",
                                                            top: 0,
                                                            left: 0,
                                                            width: "100%",
                                                            height: "100%",
                                                            objectFit: "cover",
                                                            display: "block",
                                                            borderRadius: 8,
                                                        }}
                                                        onError={(e: any) => { e.target.style.display = "none" }}
                                                    />
                                                    <div style={{
                                                        position: "absolute",
                                                        top: 0,
                                                        right: 0,
                                                        width: 50,
                                                        height: "100%",
                                                        background: "linear-gradient(to right, transparent, rgba(0,0,0,0.4))",
                                                        pointerEvents: "none",
                                                    }} />
                                                </div>
                                            )}
                                            <div style={{
                                                flex: 1,
                                                minWidth: 0,
                                                display: "flex",
                                                flexDirection: "column",
                                                justifyContent: "center",
                                                padding: "14px 16px",
                                                gap: 1,
                                            }}>
                                                {log.metadata.appName && (
                                                    <div style={{
                                                        fontSize: 10,
                                                        fontWeight: 800,
                                                        textTransform: "uppercase",
                                                        letterSpacing: 0.8,
                                                        color: C.brandLight,
                                                        display: "flex",
                                                        alignItems: "center",
                                                        gap: 5,
                                                        marginBottom: 4,
                                                    }}>
                                                        {log.metadata.appName === "Spotify" && <span>🎵</span>}
                                                        {log.metadata.appName}
                                                    </div>
                                                )}
                                                <div style={{
                                                    fontSize: 16,
                                                    fontWeight: 800,
                                                    color: C.header,
                                                    whiteSpace: "nowrap",
                                                    overflow: "hidden",
                                                    textOverflow: "ellipsis",
                                                    lineHeight: 1.2,
                                                    letterSpacing: -0.2,
                                                }}>
                                                    {log.metadata.song}
                                                </div>
                                                {log.metadata.artist && (
                                                    <div style={{
                                                        fontSize: 14,
                                                        color: C.text,
                                                        whiteSpace: "nowrap",
                                                        overflow: "hidden",
                                                        textOverflow: "ellipsis",
                                                        fontWeight: 500,
                                                        marginTop: 2,
                                                    }}>
                                                        {log.metadata.artist}
                                                    </div>
                                                )}
                                                {log.metadata.album && (
                                                    <div style={{
                                                        fontSize: 12,
                                                        color: C.muted,
                                                        whiteSpace: "nowrap",
                                                        overflow: "hidden",
                                                        textOverflow: "ellipsis",
                                                        marginTop: 1,
                                                    }}>
                                             