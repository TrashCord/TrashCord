import { globalShortcut, IpcMainInvokeEvent } from "electron";

const slots = new Map<string, string>();

function release(slot: string) {
    const accelerator = slots.get(slot);
    if (!accelerator) return;
    slots.delete(slot);
    globalShortcut.unregister(accelerator);
}

export function register(event: IpcMainInvokeEvent, slot: string, accelerator: string) {
    release(slot);
    if (!accelerator) return true;
    try {
        const ok = globalShortcut.register(accelerator, () => {
            if (event.sender.isDestroyed()) return;
            event.sender
                .executeJavaScript(`Vencord.Plugins.plugins.FastScreenshare.onKeybind(${JSON.stringify(slot)})`)
                .catch(() => { });
        });
        if (ok) slots.set(slot, accelerator);
        return ok;
    } catch {
        return false;
    }
}

export function unregisterAll() {
    for (const accelerator of slots.values()) globalShortcut.unregister(accelerator);
    slots.clear();
}
