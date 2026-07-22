import { definePluginSettings } from "@api/Settings"
import { OptionType } from "@utils/types"
import { checkForUpdatesManual } from "../utils/updateChecker"

const settings = definePluginSettings({
  copyFormat: {
    type: OptionType.SELECT,
    description: "Format style used when copying selected messages.",
    default: "plain",
    options: [
      { label: "Plain  ([date] User: message)", value: "plain", default: true },
      { label: "Discord  (User — date\\nmessage)", value: "discord" },
      { label: "WhatsApp  ([date, time] User: message)", value: "whatsapp" },
      { label: "Markdown  (**User** — date\\nmessage)", value: "markdown" },
      { label: "Compact  (User: message)", value: "compact" },
      { label: "JSON  (structured array)", value: "json" },
    ],
  },
  includeTimestamps: {
    type: OptionType.BOOLEAN,
    description: "Include message timestamps when copying.",
    default: true,
  },
  includeAuthorIds: {
    type: OptionType.BOOLEAN,
    description: "Append the author's Discord user ID when copying.",
    default: false,
  },
  includeStickers: {
    type: OptionType.BOOLEAN,
    description: "Include sticker names in copied messages.",
    default: true,
  },
  includeMentionsAsText: {
    type: OptionType.BOOLEAN,
    description: "Render @mentions, #channels, and @roles as plain text when copying.",
    default: true,
  },
  includeMessageLinks: {
    type: OptionType.BOOLEAN,
    description: "Append a jump link to each copied message.",
    default: false,
  },
  separatorStyle: {
    type: OptionType.SELECT,
    description: "Separator between copied messages.",
    default: "blank",
    options: [
      { label: "Blank line", value: "blank", default: true },
      { label: "Horizontal line (---)", value: "line" },
      { label: "No separator", value: "compact" },
    ],
  },
  dateFormat: {
    type: OptionType.STRING,
    description: "Date format for copied messages",
    default: "DD.MM.YYYY, HH:mm:ss",
  },
  includeAttachments: {
    type: OptionType.BOOLEAN,
    description: "Include attachment filenames and URLs when copying messages.",
    default: true,
  },
  includeEmbeds: {
    type: OptionType.BOOLEAN,
    description: "Include embed image/video URLs when copying messages.",
    default: true,
  },
  mediaFormat: {
    type: OptionType.SELECT,
    description: "How to format media in copied messages",
    default: "separate",
    options: [
      { label: "Inline with text", value: "inline" },
      { label: "Separate lines", value: "separate", default: true },
      { label: "At the end", value: "end" },
    ],
  },
  animationSpeed: {
    type: OptionType.SELECT,
    description: "Animation speed",
    default: "normal",
    options: [
      { label: "Fast", value: "fast" },
      { label: "Normal", value: "normal", default: true },
      { label: "Slow", value: "slow" },
    ],
  },
  enableSoundEffects: {
    type: OptionType.BOOLEAN,
    description: "Enable sound effects for interactions",
    default: true,
  },
  showPreview: {
    type: OptionType.BOOLEAN,
    description: "Show preview of selected messages before copying",
    default: true,
  },
  exportChatEnabled: {
    type: OptionType.BOOLEAN,
    description:
      "When enabled, adds an Export Chat option to the channel/DM context menu.",
    default: false,
  },
  exportChatFormat: {
    type: OptionType.SELECT,
    description: "Choose the file format used when exporting DMs and Group DMs.",
    default: "json",
    options: [
      { label: "JSON", value: "json", default: true },
      { label: "Plain Text", value: "txt" },
      { label: "HTML", value: "html" },
    ],
  },
  largeExportWarningEnabled: {
    type: OptionType.BOOLEAN,
    description: "Show a warning when exporting more than 10,000 messages.",
    default: true,
  },
  exportBatchSize: {
    type: OptionType.SELECT,
    description: "Number of messages to format per batch during export. Lower values keep Discord more responsive.",
    default: "100",
    options: [
      { label: "50 (most responsive)", value: "50" },
      { label: "100 (recommended)", value: "100", default: true },
      { label: "250 (faster)", value: "250" },
    ],
  },
  exportBatchDelayMs: {
    type: OptionType.SELECT,
    description: "Delay between formatting batches (milliseconds). Higher values give Discord more breathing room.",
    default: "50",
    options: [
      { label: "0 ms (fastest)", value: "0" },
      { label: "50 ms (recommended)", value: "50", default: true },
      { label: "150 ms (smoothest)", value: "150" },
    ],
  },
  preferJsonForLargeExports: {
    type: OptionType.BOOLEAN,
    description: "Suggest JSON format instead of HTML for very large exports (20,000+ messages).",
    default: false,
  },
  checkForUpdates: {
    type: OptionType.BOOLEAN,
    description: "Check GitHub for a newer version of MultiMessageCopy when Discord starts.",
    default: true,
  },
  showUpdateNotifications: {
    type: OptionType.BOOLEAN,
    description: "Show a modal when a newer version is found.",
    default: true,
  },
  checkForUpdatesNow: {
    type: OptionType.COMPONENT,
    description: "Manually check for a MultiMessageCopy update right now.",
    component: () => {
      const { React, Button } = require("@webpack/common")
      const [checking, setChecking] = React.useState(false)
      async function handleClick() {
        if (checking) return
        setChecking(true)
        try {
          await checkForUpdatesManual()
        } finally {
          setChecking(false)
        }
      }
      return React.createElement(
        Button,
        {
          size: Button.Sizes.SMALL,
          disabled: checking,
          onClick: handleClick,
        },
        checking ? "Checking\u2026" : "Check for updates"
      )
    },
  },
})

export default settings
