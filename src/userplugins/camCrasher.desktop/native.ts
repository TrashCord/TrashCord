import { app, globalShortcut, type IpcMainInvokeEvent, type WebContents } from "electron";
import { createConnection, createServer, type Server, type Socket } from "net";

const PORT = 47653;
const HOST = "127.0.0.1";
const ROUNDS = [0, 150, 400, 1000];

type Channel = {
    accelerator: string;
    target: WebContents;
    dead: boolean;
    owned: boolean;
    server: Server | null;
    peer: Socket | null;
    peers: Set<Socket>;
};

let channel: Channel | null = null;

function fire(ch: Channel) {
    if (ch.dead || ch.target.isDestroyed()) return;
    ch.target.executeJavaScript("Vencord.Plugins.plugins.CamCrasher.onKeybind()").catch(() => { });
}

function press(ch: Channel) {
    fire(ch);
    const data = `${ch.accelerator}\n`;
    for (const s of ch.peers) s.write(data);
}

function serve(ch: Channel) {
    if (ch.server) return;
    const s = createServer(sock => {
        sock.setNoDelay(true);
        ch.peers.add(sock);
        sock.on("close", () => ch.peers.delete(sock));
        sock.on("error", () => sock.destroy());
    });
    s.on("error", () => { if (ch.server === s) ch.server = null; });
    s.listen(PORT, HOST);
    ch.server = s;
}

function connect(ch: Channel) {
    return new Promise<boolean>(resolve => {
        const s = createConnection(PORT, HOST);
        let linked = false;
        s.on("connect", () => {
            if (ch.dead) {
                s.destroy();
                resolve(false);
                return;
            }
            linked = true;
            ch.peer = s;
            resolve(true);
        });
        s.on("data", data => {
            if (data.toString().split("\n").includes(ch.accelerator)) fire(ch);
        });
        s.on("error", () => {
            s.destroy();
            if (!linked) resolve(false);
        });
        s.on("close", () => {
            if (ch.peer !== s) return;
            ch.peer = null;
            if (!ch.dead) void acquire(ch);
        });
    });
}

async function acquire(ch: Channel): Promise<boolean> {
    for (const delay of ROUNDS) {
        if (delay) await new Promise(r => setTimeout(r, delay));
        if (ch.dead) return false;
        try {
            if (globalShortcut.register(ch.accelerator, () => press(ch))) {
                ch.owned = true;
                serve(ch);
                return true;
            }
        } catch {
            return false;
        }
        if (await connect(ch)) return true;
    }
    return false;
}

function release(ch: Channel) {
    ch.dead = true;
    if (ch.owned) {
        try { globalShortcut.unregister(ch.accelerator); } catch { }
        ch.owned = false;
    }
    ch.server?.close();
    ch.server = null;
    for (const s of ch.peers) s.destroy();
    ch.peers.clear();
    const p = ch.peer;
    ch.peer = null;
    p?.destroy();
}

export async function registerKeybind(e: IpcMainInvokeEvent, accelerator: string): Promise<boolean> {
    unregisterKeybind();
    if (!accelerator) return false;
    const ch: Channel = { accelerator, target: e.sender, dead: false, owned: false, server: null, peer: null, peers: new Set() };
    channel = ch;
    const ok = await acquire(ch);
    const superseded = ch.dead;
    if (!ok && !superseded) {
        release(ch);
        if (channel === ch) channel = null;
    }
    return ok || superseded;
}

export function unregisterKeybind(_e?: IpcMainInvokeEvent) {
    if (!channel) return;
    release(channel);
    channel = null;
}

app.on("will-quit", () => unregisterKeybind());