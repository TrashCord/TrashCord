import definePlugin from "@utils/types";

import managedStyle from "./styles.css?managed";

export default definePlugin({
    name: "ToastFixStyle",
    description: "Wider toasts, max 2 lines",
    authors: [{ name: "zfrancesck1", id: 456195985404592149n }],
    tags: ["Utility", "Developers"],
    enabledByDefault: true,
    required: true,
    hidden: true,
    managedStyle
});