import { isPluginEnabled } from "@api/PluginManager";
import { Settings } from "@api/Settings";
import definePlugin from "@utils/types";

export default definePlugin({
    name: "NoMirroredCamera",
    description: "Prevents the camera from being mirrored on your screen",
    authors: [{ id: 456195985404592149n, name: "zfrancesck1" }, { id: 0n, name: "nyx" }],
    tags: ["Voice", "Utility"],
    enabledByDefault: false,

    start() {
        try {
            if (isPluginEnabled("EquicordHelper") && (Settings.plugins?.EquicordHelper?.noMirroredCamera ?? false)) return;
        } catch { }
        const style = document.createElement("style");
        style.id = "no-mirrored-camera-fix";
        style.textContent = `[class*="cameraPreview"] [class*="camera"]{transform:scaleX(1)!important}`;
        document.head.appendChild(style);
    },

    stop() {
        document.getElementById("no-mirrored-camera-fix")?.remove();
    },

    patches: [
        {
            find: /\i\?#{intl::SELF_VIDEO}/,
            replacement: {
                match: /mirror:\i/,
                replace: "mirror:!1"
            }
        },
        {
            find: ".mirror]:",
            replacement: {
                match: /\[(\i).mirror]:\i/,
                replace: "[$1.mirror]:!1"
            }
        }
    ]
});