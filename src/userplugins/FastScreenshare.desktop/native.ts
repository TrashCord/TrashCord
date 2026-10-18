import { app, globalShortcut, type IpcMainInvokeEvent, type WebContents } from "electron";
import { createConnection, createServer, type Server, type Socket } from "net";

const HOST = "127.0.0.1";
const PORTS: Record<string, number> = { main: 47831, backup: 47832 };
const ROUNDS = [0, 150, 400, 1000];

type Channel = {
    slot: string;
    accelerator: string;
    target: WebContents;
    dead: boolean;
    owned: boolean;
    server: Server | null;
    peer: Socket | null;
    peers: Set<Socket>;
};

const channels = new Map<string, Channel>();

function fire(ch: Channel) {
    if (ch.dead || ch.target.isDestroyed()) return;
    ch.target
        .executeJavaScript(`Vencord.Plugins.plugins.FastScreenshare.onKeybind(${JSON.stringify(ch.slot)})`)
        .catch(() => { });
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
    s.listen(PORTS[ch.slot], HOST);
    ch.server = s;
}

function connect(ch: Channel) {
    return new Promise<boolean>(resolve => {
        const s = createConnection(PORTS[ch.slot], HOST);
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

function drop(slot: string) {
    const ch = channels.get(slot);
    if (!ch) return;
    channels.delete(slot);
    release(ch);
}

function dropAll() {
    for (const slot of [...channels.keys()]) drop(slot);
}

export async function register(event: IpcMainInvokeEvent, slot: string, accelerator: string) {
    if (!PORTS[slot]) return false;
    const previous = channels.get(slot);
    if (previous && !previous.dead && previous.accelerator === accelerator && (previous.owned || previous.peer)) {
        previous.target = event.sender;
        return true;
    }
    drop(slot);
    if (!accelerator) return true;
    const ch: Channel = { slot, accelerator, target: event.sender, dead: false, owned: false, server: null, peer: null, peers: new Set() };
    channels.set(slot, ch);
    const ok = await acquire(ch);
    const superseded = ch.dead;
    if (!ok && !superseded) drop(slot);
    return ok || superseded;
}

export function unregisterAll(_: IpcMainInvokeEvent) {
    dropAll();
}

app.on("will-quit", dropAll);