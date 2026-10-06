import definePlugin from "@utils/types";

import managedStyle from "./toastFixStyle.css?managed";

export default definePlugin({
    name: "ToastFixStyle",
    description: "Wider toasts, max 2 lines",
    authors: [{ name: "zfrancesck1", id: 456195985404592149n }], 
    required: true,
    managedStyle
});