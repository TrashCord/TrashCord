import { RendererSettings } from "@main/settings";
import { app, BrowserWindow, desktopCapturer, globalShortcut, type IpcMainInvokeEvent, net, powerSaveBlocker } from "electron";
import { writeFileSync } from "fs";
import { createConnection, createServer, type Server, type Socket } from "net";
import { join } from "path";
import { platform } from "os";

const TEMP_HTML_PATH = join(app.getPath("temp"), `vc-streamcrasher-${process.pid}.html`);

const HTML_WHITE = "<!DOCTYPE html><html><head><style>html,body{margin:0;padding:0;width:100%;height:100%;background:#fff;overflow:hidden}</style></head><body></body></html>";

const HTML_FLASHING = "<!DOCTYPE html><html><head><style>html,body{margin:0;padding:0;width:100%;height:100%;overflow:hidden;animation:f .12s steps(1) infinite}@keyframes f{0%,49.9%{background:#000}50%,100%{background:#fff}}</style></head></html>";

const HTML_COLORS = "<!DOCTYPE html><html><head><style>html,body{margin:0;padding:0;width:100%;height:100%;overflow:hidden;animation:c 1.2s steps(6) infinite}@keyframes c{0%{background:#f00}17%{background:#ff8000}33%{background:#ff0}50%{background:#0f0}67%{background:#0ff}83%{background:#00f}100%{background:#f00}}</style></head></html>";

const HTML_STATIC = "<!DOCTYPE html><html><head><style>html,body{margin:0;padding:0;overflow:hidden;width:100%;height:100%;background:#000}canvas{display:block;width:100%;height:100%;image-rendering:pixelated}</style></head><body><canvas id=\"c\"></canvas><script>var cv=document.getElementById(\"c\");var ctx=cv.getContext(\"2d\",{alpha:false});cv.width=128;cv.height=72;var img=ctx.createImageData(cv.width,cv.height);var data=img.data;function draw(){for(var i=0;i<data.length;i+=4){var v=Math.random()*255|0;data[i]=data[i+1]=data[i+2]=v;data[i+3]=255;}ctx.putImageData(img,0,0);}draw();setInterval(draw,130);</script></body></html>";

function imageHtml(src: string): string {
    return "<!DOCTYPE html><html><head><style>html,body{margin:0;padding:0;overflow:hidden;width:100%;height:100%;background:#000}img{width:100%;height:100%;object-fit:fill;display:block}</style></head><body><img id=\"i\" src=\"" + src + "\"><script>var el=document.getElementById(\"i\");var s=el.getAttribute(\"src\");setInterval(function(){el.removeAttribute(\"src\");el.setAttribute(\"src\",s);},3000);</script></body></html>";
}

const Modes: Record<string, string> = {
    flashing: HTML_FLASHING,
    white: HTML_WHITE,
    colors: HTML_COLORS,
    static: HTML_STATIC
};

try {
    app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");
} catch { }

let crashedWindow: BrowserWindow | null = null;
let cachedSourceId: string | null = null;
let activeMode: string | null = null;
let creating = false;
let blockerId: number | null = null;

function startBlocker() {
    if (blockerId === null) {
        try { blockerId = powerSaveBlocker.start("prevent-app-suspension"); } catch { }
    }
}

function stopBlocker() {
    if (blockerId !== null) {
        try { powerSaveBlocker.stop(blockerId); } catch { }
        blockerId = null;
    }
}

function resetState() {
    crashedWindow = null;
    cachedSourceId = null;
    activeMode = null;
    creating = false;
    stopBlocker();
}

const AssetsURL = "https://cdn.jsdelivr.net/gh/Discord-Velocity/PluginAssets@main/StreamCrasher";
const p = platform();
const bsodUrl = p === "darwin" ? `${AssetsURL}/crashedMac.png`
    : p === "linux" ? `${AssetsURL}/crashedLinux.png`
        : `${AssetsURL}/crashedWindows10.png`;

function getMode(): string {
    return RendererSettings.store.plugins?.StreamCrasher?.crashMode ?? "freeze";
}

function getImageUrl(): string | null {
    return RendererSettings.store.plugins?.StreamCrasher?.imageUrl || null;
}

function isWindowAlive(): boolean {
    return crashedWindow !== null && !crashedWindow.isDestroyed();
}

function isLocalPath(url: string): boolean {
    return /^[A-Za-z]:[\\/]/.test(url) || (url.startsWith("/") && !url.startsWith("//"));
}

function normaliseLocalPath(url: string): string {
    const trimmed = url.trim();
    if (/^[A-Za-z]:[\\/]/.test(trimmed)) return `file:///${trimmed.replace(/\\/g, "/")}`;
    if (trimmed.startsWith("/") && !trimmed.startsWith("//")) return `file://${trimmed}`;
    return trimmed;
}

async function fetchAsDataUri(url: string): Promise<string | null> {
    try {
        const response = await net.fetch(url);
        const buf = Buffer.from(await response.arrayBuffer());
        const contentType = response.headers.get("content-type") ?? "";
        const mime = contentType.startsWith("image/")
            ? contentType.split(";")[0].trim()
            : /\.png(\?|$)/i.test(url) ? "image/png"
                : /\.gif(\?|$)/i.test(url) ? "image/gif"
                    : /\.webp(\?|$)/i.test(url) ? "image/webp"
                        : "image/jpeg";
        return `data:${mime};base64,${buf.toString("base64")}`;
    } catch {
        return null;
    }
}

async function buildModeHtml(mode: string): Promise<{ html: string; needsFile: boolean; }> {
    if (mode === "image") {
        const url = getImageUrl();
        if (!url) return { html: HTML_FLASHING, needsFile: false };
        if (isLocalPath(url)) {
            return { html: imageHtml(normaliseLocalPath(url)), needsFile: true };
        }
        const dataUri = await fetchAsDataUri(url);
        return { html: imageHtml(dataUri ?? url), needsFile: true };
    }
    if (mode === "bsod") {
        const dataUri = await fetchAsDataUri(bsodUrl);
        return { html: imageHtml(dataUri ?? bsodUrl), needsFile: true };
    }
    return { html: Modes[mode] ?? HTML_FLASHING, needsFile: false };
}

function loadCrashContent(html: string, needsFile: boolean) {
    if (needsFile) {
        try {
            writeFileSync(TEMP_HTML_PATH, html, "utf-8");
            crashedWindow?.loadFile(TEMP_HTML_PATH).catch(() => { });
        } catch { }
    } else {
        crashedWindow?.loadURL(`data:text/html,${encodeURIComponent(html)}`).catch(() => { });
    }
}

async function findSourceId(): Promise<string | null> {
    for (let i = 0; i < 20; i++) {
        const sources = await desktopCapturer.getSources({ types: ["window"], thumbnailSize: { width: 0, height: 0 } });
        const id = sources.find(s => s.name === "crashed")?.id ?? null;
        if (id) return id;
        await new Promise(r => setTimeout(r, 50));
    }
    return null;
}

export async function createCrashSource(_e: IpcMainInvokeEvent): Promise<string | null> {
    if (RendererSettings.store.plugins?.StreamCrasher?.enabled !== true) {
        if (isWindowAlive()) crashedWindow!.destroy();
        stopBlocker();
        return null;
    }

    const mode = getMode();

    if (mode === "freeze") {
        if (isWindowAlive()) crashedWindow!.hide();
        stopBlocker();
        return "-1";
    }

    const { html, needsFile } = await buildModeHtml(mode);
    const modeKey = mode === "image" ? `image:${getImageUrl()}` : mode;

    if (isWindowAlive()) {
        if (activeMode !== modeKey) {
            activeMode = modeKey;
            loadCrashContent(html, needsFile);
        }
        crashedWindow!.showInactive();
        startBlocker();
        return cachedSourceId;
    }

    if (creating) return cachedSourceId;
    creating = true;

    activeMode = modeKey;
    const win = new BrowserWindow({
        width: 1920,
        height: 1080,
        show: false,
        frame: false,
        hasShadow: false,
        resizable: false,
        movable: false,
        skipTaskbar: true,
        title: "crashed",
        webPreferences: { backgroundThrottling: false, webSecurity: false },
        x: -9999,
        y: -9999,
        roundedCorners: false
    });
    crashedWindow = win;
    cachedSourceId = null;

    win.webContents.setBackgroundThrottling(false);
    win.webContents.on("render-process-gone", () => { if (crashedWindow === win) resetState(); });
    win.once("closed", () => { if (crashedWindow === win) resetState(); });

    await new Promise<void>(resolve => {
        win.once("closed", resolve);
        win.once("ready-to-show", resolve);
        if (needsFile) {
            try { writeFileSync(TEMP_HTML_PATH, html, "utf-8"); } catch { }
            win.loadFile(TEMP_HTML_PATH).catch(() => { });
        } else {
            win.loadURL(`data:text/html,${encodeURIComponent(html)}`).catch(() => { });
        }
    });

    if (crashedWindow !== win || win.isDestroyed()) { creating = false; return null; }

    await new Promise(r => setTimeout(r, 150));

    if (crashedWindow !== win || win.isDestroyed()) { creating = false; return null; }

    win.showInactive();
    const id = win.getMediaSourceId() || await findSourceId();

    if (crashedWindow !== win || win.isDestroyed()) { creating = false; return null; }

    cachedSourceId = id;
    creating = false;
    startBlocker();
    return id;
}

export async function updateCrashMode(_e: IpcMainInvokeEvent) {
    const mode = getMode();

    if (mode === "freeze") {
        if (isWindowAlive()) crashedWindow!.hide();
        stopBlocker();
        return;
    }

    if (!isWindowAlive()) return;

    const { html, needsFile } = await buildModeHtml(mode);
    activeMode = mode === "image" ? `image:${getImageUrl()}` : mode;
    loadCrashContent(html, needsFile);
    crashedWindow?.showInactive();
    startBlocker();
}

export function stopCrashSource(_e: IpcMainInvokeEvent) {
    stopBlocker();
    if (!isWindowAlive()) return;
    crashedWindow!.destroy();
}

const PORT = 47654;
const HOST = "127.0.0.1";
const ROUNDS = [0, 150, 400, 1000];

type Channel = {
    accelerator: string;
    dead: boolean;
    owned: boolean;
    server: Server | null;
    peer: Socket | null;
    peers: Set<Socket>;
};

let channel: Channel | null = null;
const waiters: Array<() => void> = [];

function notify() {
    for (const resolve of waiters.splice(0)) resolve();
}

function fire(ch: Channel) {
    if (!ch.dead) notify();
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

export async function registerGlobalKeybind(_e: IpcMainInvokeEvent, accelerator: string): Promise<boolean> {
    unregisterGlobalKeybind();
    if (!accelerator) return false;
    const ch: Channel = { accelerator, dead: false, owned: false, server: null, peer: null, peers: new Set() };
    channel = ch;
    const ok = await acquire(ch);
    const superseded = ch.dead;
    if (!ok && !superseded) {
        release(ch);
        if (channel === ch) channel = null;
    }
    return ok || superseded;
}

export function unregisterGlobalKeybind(_e?: IpcMainInvokeEvent) {
    if (!channel) return;
    release(channel);
    channel = null;
}

export function waitForKeybind(_e: IpcMainInvokeEvent): Promise<void> {
    return new Promise(resolve => { waiters.push(resolve); });
}

export function cancelKeybindWait(_e: IpcMainInvokeEvent): void {
    notify();
}

app.on("will-quit", () => unregisterGlobalKeybind());