/**
 * channelContextMenu.tsx
 *
 * Adds an "Export Chat" item to the DM / Group DM context menu when
 * exportChatEnabled is true in plugin settings.
 *
 * Context menu names in Vencord:
 *   - "gdm-context"           – group DMs
 *   - "user-context"          – right-click on a user inside a private DM
 *
 * Export Chat intentionally does NOT appear for server/guild channels,
 * threads, announcement channels, or any channel that has a guild_id.
 */

import { NavContextMenuPatchCallback } from "@api/ContextMenu"
import { Menu } from "@webpack/common"
import { React } from "@webpack/common"

import settings from "../settings"
import { createCancelToken, startExport } from "../utils/exportChat"
import {
  closeExportProgressModal,
  openExportProgressModal,
} from "../components/ExportProgressModal"
import { showNotification } from "../utils/notification"

// ─── Channel type constants (Discord internal) ───────────────────────────────
// 1 = DM, 3 = GROUP_DM  — only private, non-guild channels are allowed.
const PRIVATE_CHANNEL_TYPES = new Set([1, 3])

/**
 * Returns true only when the channel is a private DM or Group DM with no guild.
 *
 * Vencord and Discord may surface the guild association under different prop
 * names depending on the Vencord version and internal Discord build:
 *   - channel.guild_id   – raw Discord API field
 *   - channel.guildId    – camelCase alias used by some Vencord wrappers
 *   - channel.getGuildId?.() – method form used by Vencord's Channel class
 *
 * We treat the channel as a guild channel if ANY of these indicate a guild.
 */
function hasGuild(channel: any): boolean {
  if (channel.guild_id) return true
  if (channel.guildId) return true
  if (typeof channel.getGuildId === "function" && channel.getGuildId()) return true
  return false
}

function isExportableChannel(channel: any): boolean {
  if (!channel) return false
  if (!PRIVATE_CHANNEL_TYPES.has(channel.type)) return false
  if (hasGuild(channel)) return false
  return true
}

// ─── Shared handler ───────────────────────────────────────────────────────────

function handleExportChat(channelId: string) {
  const cancelToken = createCancelToken()
  const exportFmt = (settings.store.exportChatFormat as string | undefined) ?? "json"
  const { update } = openExportProgressModal(cancelToken, exportFmt)

  startExport(channelId, cancelToken, state => {
    update(state)

    if (state.status === "done") {
      showNotification("Chat export completed.", "success", 5000)
    } else if (state.status === "error") {
      showNotification(`Export failed: ${state.statusText}`, "error", 7000)
    }
  }).catch(err => {
    closeExportProgressModal()
    showNotification(
      `Export error: ${err?.message ?? String(err)}`,
      "error",
      7000
    )
  })
}

// ─── Menu item builder ────────────────────────────────────────────────────────

function buildExportItem(channelId: string) {
  return (
    <Menu.MenuItem
      id="mmc-export-chat"
      label="Export Chat"
      action={() => handleExportChat(channelId)}
    />
  )
}

// ─── Patch callbacks ──────────────────────────────────────────────────────────

/**
 * Generic patch factory — works for channel-context, gdm-context, and
 * thread-context menus which all pass `{ channel }` in their props.
 */
export const channelContextMenuPatch: NavContextMenuPatchCallback = (
  children,
  { channel }
) => {
  if (!settings.store.exportChatEnabled) return
  if (!isExportableChannel(channel)) return

  children.push(
    <Menu.MenuSeparator />,
    buildExportItem(String(channel.id))
  )
}

/**
 * Patch for "user-context" — the props shape is `{ user, channel }`.
 * If a DM channel object is available we use it; otherwise we fall back
 * to opening by user id (the caller must resolve the channel id first).
 */
export const userContextMenuPatch: NavContextMenuPatchCallback = (
  children,
  { channel, user }
) => {
  if (!settings.store.exportChatEnabled) return

  // Only proceed when we have a concrete DM channel object in the context.
  // This is only set when the user right-clicks inside an open private DM.
  // Right-clicking a server member never populates this channel prop as a
  // DM channel, so server-member clicks are naturally excluded.
  if (!isExportableChannel(channel)) return

  children.push(
    <Menu.MenuSeparator />,
    buildExportItem(String(channel.id))
  )
}
