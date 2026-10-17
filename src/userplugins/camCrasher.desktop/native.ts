import { app, globalShortcut, type IpcMainInvokeEvent, type WebContents } from "electron";
import { createConnection, createServer, type Server, type Socket } from "net";

const PORT = 47653;
const HOST = "127.0.0.1";

let current: string | null = null;
let target: WebContents | null = null;
let server: Server | null = null;
let peer: Socket | null = null;
const peers = new Set<Socket>();

function fire() {
    if (!target || target.isDestroyed()) return;
    target.executeJavaScript("Vencord.Plugins.plugins.CamCrasher.onKeybind()").catch(() => { });
}

function broadcast() {
    fire();
    for (const s of peers) s.write("f");
}

function startServer() {
    if (server) return;
    const s = createServer(sock => {
        peers.add(sock);
        sock.on("close", () => peers.delete(sock));
        sock.on("error", () => sock.destroy());
    });
    s.on("error", () => { if (server === s) server = null; });
    s.listen(PORT, HOST);
    server = s;
}

function stopServer() {
    for (const s of peers) s.destroy();
    peers.clear();
    server?.close();
    server = null;
}

function connectPeer(accelerator: string) {
    return new Promise<boolean>(resolve => {
        const s = createConnection(PORT, HOST);
        let done = false;
        s.on("connect", () => {
            done = true;
            peer = s;
            resolve(true);
        });
        s.on("data", () => fire());
        s.on("error", () => {
            s.destroy();
            if (!done) resolve(false);
        });
        s.on("close", () => {
            if (peer !== s) return;
            peer = null;
            if (target && !target.isDestroyed()) void tryRegister(accelerator);
        });
    });
}

async function tryRegister(accelerator: string): Promise<boolean> {
    try {
        if (globalShortcut.register(accelerator, broadcast)) {
            current = accelerator;
            startServer();
            return true;
        }
    } catch {
        return false;
    }
    if (await connectPeer(accelerator)) return true;
    await new Promise(r => setTimeout(r, 150));
    return connectPeer(accelerator);
}

export async function registerKeybind(e: IpcMainInvokeEvent, accelerator: string): Promise<boolean> {
    unregisterKeybind();
    if (!accelerator) return false;
    target = e.sender;
    return tryRegister(accelerator);
}

export function unregisterKeybind(_e?: IpcMainInvokeEvent) {
    if (current) {
        try { globalShortcut.unregister(current); } catch { }
        current = null;
    }
    stopServer();
    const p = peer;
    peer = null;
    p?.destroy();
    target = null;
}

app.on("will-quit", () => unregisterKeybind());