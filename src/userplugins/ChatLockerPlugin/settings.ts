import { definePluginSettings } from "@api/Settings";
import { OptionType } from "@utils/types";

export const settings = definePluginSettings({
    backgroundImage: {
        type: OptionType.STRING,
        description: "Custom lock screen background image URL(s) — leave empty for the default dark background, or enter a comma-separated list of several URLs to shuffle between",
        default: "",
    },
    shuffleBackground: {
        type: OptionType.BOOLEAN,
        description: "When multiple background URLs are provided above, pick one at random each time a chat is locked (if off, the first URL in the list is always used)",
        default: true,
    },
    backgroundSize: {
        type: OptionType.SELECT,
        description: "How the custom background image is sized within the overlay",
        options: [
            { label: "Cover (fill & crop to edges)", value: "cover", default: true },
            { label: "Contain (fit whole image, may letterbox)", value: "contain" },
            { label: "Stretch (fill exactly, may distort)", value: "stretch" },
            { label: "Tile (repeat at original size)", value: "tile" },
            { label: "Center (original size, no repeat)", value: "center" },
        ],
    },
    enableBlur: {
        type: OptionType.BOOLEAN,
        description: "Blur the lock screen background (the custom image if set, otherwise the chat behind the overlay)",
        default: true,
    },
    blurStrength: {
        type: OptionType.SLIDER,
        description: "Blur strength (px)",
        markers: [0, 5, 10, 15, 20, 30, 40, 50],
        stickToMarkers: false,
        default: 30,
    },
    idleLockEnabled: {
        type: OptionType.BOOLEAN,
        description: "Automatically lock the currently viewed channel after a period of inactivity",
        default: false,
    },
    idleLockValue: {
        type: OptionType.NUMBER,
        description: "Idle duration before auto-locking (paired with the unit below)",
        default: 5,
    },
    idleLockUnit: {
        type: OptionType.SELECT,
        description: "Unit for the idle duration",
        options: [
            { label: "Seconds", value: "seconds" },
            { label: "Minutes", value: "minutes", default: true },
            { label: "Hours", value: "hours" },
        ],
    },
});
