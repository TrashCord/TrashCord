import { React, Menu } from "@webpack/common"
import { isSelectionMode } from "../hooks/selectionState"
import { enterSelectionMode, exitSelectionMode } from "../hooks/selectionManager"

export const messageContextMenuPatch = (children: any[], props: any) => {
  const { message, channel } = props

  if (!message || !channel) return

  children.push(
    <Menu.MenuSeparator />,
    <Menu.MenuItem
      id="select-messages"
      label={isSelectionMode ? "Exit Selection Mode" : "Select Messages"}
      action={() => {
        if (isSelectionMode) {
          exitSelectionMode()
        } else {
          enterSelectionMode(channel.id)
        }
      }}
    />,
  )
}
