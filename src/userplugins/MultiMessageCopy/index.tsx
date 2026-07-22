import managedStyle from "./styles.css?managed";
import definePlugin from "@utils/types"
import "./styles.css"

import settings from "./src/settings"
import { messageContextMenuPatch } from "./src/patches/messageContextMenu"
import {
  channelContextMenuPatch,
  userContextMenuPatch,
} from "./src/patches/channelContextMenu"
import { isSelectionMode } from "./src/hooks/selectionState"
import { exitSelectionMode } from "./src/hooks/selectionManager"
import { closeExportProgressModal } from "./src/components/ExportProgressModal"
import { checkForUpdates } from "./src/utils/updateChecker"

// Import selectionManager to register all circular-dep callbacks on module load
import "./src/hooks/selectionManager"

export default definePlugin({
    name: "MultiMessageCopy",
    description: 
    "Enhanced Discord message selection and copying with beautiful UI/UX. Optionally export full chat history as JSON.",
    authors: [
    {
      name: "nexa029x",
      id: 1274107065434116197n,
    },
  ],
    tags: ["Chat", "Utility", "Shortcuts"],
    enabledByDefault: false,
    managedStyle,
    settings,
  contextMenus: {
    "message": messageContextMenuPatch,
    "channel-context": channelContextMenuPatch,
    "gdm-context": channelContextMenuPatch,
    "thread-context": channelContextMenuPatch,
    "user-context": userContextMenuPatch,
  },

  start() {
    // Fire-and-forget update check. Does nothing if settings disable it or if
    // the user already dismissed this remote version. Never blocks startup.
    checkForUpdates(
      settings.store.checkForUpdates,
      settings.store.showUpdateNotifications
    )
  },

  stop() {
    if (isSelectionMode) {
      exitSelectionMode()
    }
    // Close any open export modal so it doesn't linger after the plugin is disabled
    closeExportProgressModal()
  },
})
