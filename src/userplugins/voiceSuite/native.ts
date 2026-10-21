import { app, globalShortcut, type IpcMainInvokeEvent, type WebContents } from "electron";
import { createConnection, createServer, type Server, type Socket } from "net";

const HOST = "127.0.0.1";
const BASE_PORT = 47900;
const PORT_COUNT = 256;
const ROUNDS = [0, 150, 400, 1000];
const PLUGIN_KEY = "Voice Suite";

type Channel = {
    accelerator: string;
    port: number;
    dead: boolean;
    owned: boolean;
    server: Server | null;
    peer: Socket | null;
    peers: Set<Socket>;
    held: boolean;
    heldTimer: NodeJS.Timeout | null;
};

const channels = new Map<string, Channel>();
let target: WebContents | null = null;

function portOf(accelerator: string) {
    let h = 0;
    for (let i = 0; i < accelerator.length; i++) h = (h * 31 + accelerator.charCodeAt(i)) >>> 0;
    return BASE_PORT + (h % PORT_COUNT);
}

function fire(accelerator: string) {
    if (!target || target.isDestroyed()) return;
    target
        .executeJavaScript(`Vencord.Plugins.plugins[${JSON.stringify(PLUGIN_KEY)}].onKeybind(${JSON.stringify(accelerator)})`)
        .catch(() => { });
}

function press(ch: Channel) {
    if (ch.heldTimer) clearTimeout(ch.heldTimer);
    ch.heldTimer = setTimeout(() => { ch.held = false; ch.heldTimer = null; }, 100);
    if (ch.held) return;
    ch.held = true;
    if (!ch.dead) fire(ch.accelerator);
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
    s.listen(ch.port, HOST);
    ch.server = s;
}

function connect(ch: Channel) {
    return new Promise<boolean>(resolve => {
        const s = createConnection(ch.port, HOST);
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
            if (!ch.dead && data.toString().split("\n").includes(ch.accelerator)) fire(ch.accelerator);
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
    if (ch.heldTimer) clearTimeout(ch.heldTimer);
    ch.heldTimer = null;
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

function drop(accelerator: string) {
    const ch = channels.get(accelerator);
    if (!ch) return;
    channels.delete(accelerator);
    release(ch);
}

function dropAll() {
    for (const accelerator of [...channels.keys()]) drop(accelerator);
}

export async function registerKeybinds(e: IpcMainInvokeEvent, accelerators: string[]): Promise<Record<string, string>> {
    target = e.sender;
    const wanted = new Set((accelerators ?? []).filter(a => typeof a === "string" && a));
    for (const accelerator of [...channels.keys()]) if (!wanted.has(accelerator)) drop(accelerator);

    const fresh: Channel[] = [];
    for (const accelerator of wanted) {
        const cur = channels.get(accelerator);
        if (cur && !cur.dead && (cur.owned || cur.peer)) continue;
        if (cur) drop(accelerator);
        const ch: Channel = {
            accelerator, port: portOf(accelerator), dead: false, owned: false,
            server: null, peer: null, peers: new Set(), held: false, heldTimer: null
        };
        channels.set(accelerator, ch);
        fresh.push(ch);
    }

    await Promise.all(fresh.map(async ch => {
        const ok = await acquire(ch);
        if (!ok && !ch.dead) drop(ch.accelerator);
    }));

    const out: Record<string, string> = {};
    for (const accelerator of wanted) {
        const ch = channels.get(accelerator);
        out[accelerator] = !ch || ch.dead ? "failed" : ch.owned ? "owned" : ch.peer ? "linked" : "failed";
    }
    return out;
}

export function unregisterKeybinds(_e?: IpcMainInvokeEvent) {
    dropAll();
}

app.on("will-quit", dropAll);
