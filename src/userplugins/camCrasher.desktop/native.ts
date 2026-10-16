import { app, globalShortcut, type IpcMainInvokeEvent, type WebContents } from "electron";

let current: string | null = null;
let target: WebContents | null = null;

function fire() {
    if (!target || target.isDestroyed()) return;
    target.executeJavaScript("Vencord.Plugins.plugins.CamCrasher.onKeybind()").catch(() => { });
}

export function registerKeybind(e: IpcMainInvokeEvent, accelerator: string): boolean {
    unregisterKeybind();
    if (!accelerator) return false;
    target = e.sender;
    try {
        const ok = globalShortcut.register(accelerator, fire);
        if (ok) current = accelerator;
        return ok;
    } catch {
        return false;
    }
}

export function unregisterKeybind(_e?: IpcMainInvokeEvent) {
    if (current) {
        try { globalShortcut.unregister(current); } catch { }
        current = null;
    }
    target = null;
}

app.on("will-quit", () => unregisterKeybind());