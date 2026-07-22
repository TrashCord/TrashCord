import { RendererSettings } from "@main/settings";
import { app, BrowserWindow, desktopCapturer, globalShortcut, type IpcMainInvokeEvent, net, powerSaveBlocker } from "electron";
import { existsSync, statSync, watch, writeFileSync } from "fs";
import { join } from "path";
import { platform } from "os";

const TEMP_HTML_PATH = join(app.getPath("temp"), "vc-streamcrasher.html");
const KEYBIND_SIGNAL_PATH = join(app.getPath("temp"), "vc-sc-keybind.signal");

const HTML_WHITE = "<!DOCTYPE html><html><head><style>html,body{margin:0;padding:0;width:100%;height:100%;background:#fff;overflow:hidden}</style></head><body></body></html>";

const HTML_FLASHING = "<!DOCTYPE html><html><head><style>html,body{margin:0;padding:0;width:100%;height:100%;overflow:hidden}</style></head><body><script>var v=0;window.__tick=function(){document.body.style.background=v?\"#fff\":\"#000\";v^=1;};window.__tick();</script></body></html>";

const HTML_COLORS = "<!DOCTYPE html><html><head><style>html,body{margin:0;padding:0;width:100%;height:100%;overflow:hidden}</style></head><body><script>var c=[\"#f00\",\"#ff8000\",\"#ff0\",\"#0f0\",\"#0ff\",\"#00f\"];var i=0;window.__tick=function(){document.body.style.background=c[i];i=(i+1)%c.length;};window.__tick();</script></body></html>";

const HTML_STATIC = "<!DOCTYPE html><html><head><style>html,body{margin:0;padding:0;overflow:hidden;width:100%;height:100%;background:#000}canvas{display:block;width:100%;height:100%;image-rendering:pixelated}</style></head><body><canvas id=\"c\"></canvas><script>var cv=document.getElementById(\"c\");var ctx=cv.getContext(\"2d\");cv.width=160;cv.height=90;var img=ctx.createImageData(cv.width,cv.height);var data=img.data;window.__tick=function(){for(var i=0;i<data.length;i+=4){var v=Math.random()*255|0;data[i]=data[i+1]=data[i+2]=v;data[i+3]=255;}ctx.putImageData(img,0,0);};window.__tick();window.__tick();</script></body></html>";

function imageHtml(src: string): string {
    return "<!DOCTYPE html><html><head><style>html,body{margin:0;padding:0;overflow:hidden;width:100%;height:100%;background:#000}img{width:100%;height:100%;object-fit:fill;display:block}</style></head><body><img id=\"i\" src=\"" + src + "\"><script>window.__tick=function(){var el=document.getElementById(\"i\");var s=el.getAttribute(\"src\");el.removeAttribute(\"src\");el.setAttribute(\"src\",s);};</script></body></html>";
}

const Modes: Record<string, string> = {
    flashing: HTML_FLASHING,
    white: HTML_WHITE,
    colors: HTML_COLORS,
    static: HTML_STATIC
};

const TICK_INTERVALS: Record<string, number> = {
    flashing: 120,
    colors: 200,
    static: 130,
    image: 2500
};

try {
    app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");
} catch { }

let crashedWindow: BrowserWindow | null = null;
let cachedSourceId: string | null = null;
let activeMode: string | null = null;
let creating = false;
let blockerId: number | null = null;
let tickTimer: NodeJS.Timeout | null = null;

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

function startTicking(mode: string) {
    stopTicking();
    const interval = TICK_INTERVALS[mode];
    if (!interval) return;
    tickTimer = setInterval(() => {
        if (isWindowAlive()) crashedWindow!.webContents.executeJavaScript("window.__tick&&window.__tick();").catch(() => {});
    }, interval);
}

function stopTicking() {
    if (tickTimer) { clearInterval(tickTimer); tickTimer = null; }
}

function resetState() {
    crashedWindow = null;
    cachedSourceId = null;
    activeMode = null;
    stopTicking();
    stopBlocker();
}

const AssetsURL = "https://raw.githubusercontent.com/Discord-Velocity/PluginAssets/main/StreamCrasher";
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

async function buildModeHtml(mode: string): Promise<{ html: string; needsFile: boolean; tickKey: string; }> {
    if (mode === "image") {
        const url = getImageUrl();
        if (!url) return { html: HTML_FLASHING, needsFile: false, tickKey: "flashing" };
        if (isLocalPath(url)) {
            return { html: imageHtml(normaliseLocalPath(url)), needsFile: true, tickKey: "image" };
        }
        const dataUri = await fetchAsDataUri(url);
        return { html: imageHtml(dataUri ?? url), needsFile: false, tickKey: "image" };
    }
    if (mode === "bsod") {
        const dataUri = await fetchAsDataUri(bsodUrl);
        return { html: imageHtml(dataUri ?? bsodUrl), needsFile: false, tickKey: "" };
    }
    return { html: Modes[mode] ?? HTML_FLASHING, needsFile: false, tickKey: mode in TICK_INTERVALS ? mode : "" };
}

function loadCrashContent(html: string, needsFile: boolean) {
    if (needsFile) {
        try {
            writeFileSync(TEMP_HTML_PATH, html, "utf-8");
            crashedWindow?.loadFile(TEMP_HTML_PATH);
        } catch { }
    } else {
        crashedWindow?.loadURL(`data:text/html,${encodeURIComponent(html)}`);
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
    const mode = getMode();

    if (mode === "freeze") {
        if (isWindowAlive()) crashedWindow!.hide();
        stopTicking();
        stopBlocker();
        return "-1";
    }

    const { html, needsFile, tickKey } = await buildModeHtml(mode);
    const modeKey = mode === "image" ? `image:${getImageUrl()}` : mode;

    if (isWindowAlive()) {
        if (activeMode !== modeKey) {
            activeMode = modeKey;
            loadCrashContent(html, needsFile);
        }
        crashedWindow!.showInactive();
        startBlocker();
        startTicking(tickKey);
        return cachedSourceId;
    }

    if (creating) return cachedSourceId;
    creating = true;

    activeMode = modeKey;
    crashedWindow = new BrowserWindow({
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

    crashedWindow.webContents.setBackgroundThrottling(false);
    crashedWindow.webContents.on("render-process-gone", () => resetState());
    crashedWindow.once("closed", () => resetState());

    await new Promise<void>(resolve => {
        crashedWindow?.once("ready-to-show", resolve);
        if (needsFile) {
            try { writeFileSync(TEMP_HTML_PATH, html, "utf-8"); } catch { }
            crashedWindow?.loadFile(TEMP_HTML_PATH);
        } else {
            crashedWindow?.loadURL(`data:text/html,${encodeURIComponent(html)}`);
        }
    });

    await new Promise(r => setTimeout(r, 150));
    crashedWindow.showInactive();
    cachedSourceId = await findSourceId();
    creating = false;
    startBlocker();
    startTicking(tickKey);
    return cachedSourceId;
}

export async function updateCrashMode(_e: IpcMainInvokeEvent) {
    const mode = getMode();

    if (mode === "freeze") {
        if (isWindowAlive()) crashedWindow!.hide();
        stopTicking();
        stopBlocker();
        return;
    }

    if (!isWindowAlive()) return;

    const { html, needsFile, tickKey } = await buildModeHtml(mode);
    activeMode = mode === "image" ? `image:${getImageUrl()}` : mode;
    loadCrashContent(html, needsFile);
    crashedWindow?.showInactive();
    startBlocker();
    startTicking(tickKey);
}

export function stopCrashSource(_e: IpcMainInvokeEvent) {
    stopTicking();
    stopBlocker();
    if (!isWindowAlive()) return;
    crashedWindow?.hide();
}

let registeredAccelerator: string | null = null;
let pendingAccelerator: string | null = null;
let retryTimer: NodeJS.Timeout | null = null;
let lastSignalMtime = 0;
let signalWatcher: ReturnType<typeof watch> | null = null;

let keyDownActive = false;
let keyUpTimer: NodeJS.Timeout | null = null;
let keybindPendingCount = 0;

const keybindResolvers: Array<() => void> = [];

function notifyRenderers() {
    if (keybindResolvers.length > 0) {
        const rs = keybindResolvers.splice(0);
        for (const r of rs) r();
    } else if (keybindPendingCount < 1) {
        keybindPendingCount++;
    }
}

function fireSignal() {
    try { writeFileSync(KEYBIND_SIGNAL_PATH, "1"); } catch {}
}

function stopSignalWatch() {
    if (signalWatcher) { try { signalWatcher.close(); } catch {} signalWatcher = null; }
}

function startSignalWatch() {
    stopSignalWatch();
    try {
        if (!existsSync(KEYBIND_SIGNAL_PATH)) writeFileSync(KEYBIND_SIGNAL_PATH, "0");
        lastSignalMtime = statSync(KEYBIND_SIGNAL_PATH).mtimeMs;
        signalWatcher = watch(KEYBIND_SIGNAL_PATH, () => {
            if (registeredAccelerator) return;
            try {
                const mtime = statSync(KEYBIND_SIGNAL_PATH).mtimeMs;
                if (mtime > lastSignalMtime) { lastSignalMtime = mtime; notifyRenderers(); }
            } catch {}
        });
    } catch {}
}

function stopRetry() {
    if (retryTimer) { clearInterval(retryTimer); retryTimer = null; }
}

function attemptRegister(accelerator: string): boolean {
    try {
        const ok = globalShortcut.register(accelerator, () => {
            if (keyUpTimer) clearTimeout(keyUpTimer);
            keyUpTimer = setTimeout(() => { keyDownActive = false; keyUpTimer = null; }, 100);
            if (keyDownActive) return;
            keyDownActive = true;
            notifyRenderers();
            fireSignal();
        });
        if (ok) { registeredAccelerator = accelerator; pendingAccelerator = null; stopRetry(); stopSignalWatch(); }
        return ok;
    } catch { return false; }
}

function startRetry(accelerator: string) {
    stopRetry();
    pendingAccelerator = accelerator;
    retryTimer = setInterval(() => {
        if (!pendingAccelerator) { stopRetry(); return; }
        attemptRegister(pendingAccelerator);
    }, 2000);
}

try {
    app.on("browser-window-focus", () => {
        if (pendingAccelerator && !registeredAccelerator) attemptRegister(pendingAccelerator);
    });
} catch { }

export function registerGlobalKeybind(_e: IpcMainInvokeEvent, accelerator: string): boolean {
    unregisterGlobalKeybind();
    if (!accelerator) return false;
    const ok = attemptRegister(accelerator);
    if (!ok) { startSignalWatch(); startRetry(accelerator); }
    return ok;
}

export function unregisterGlobalKeybind(_e?: IpcMainInvokeEvent) {
    stopRetry();
    stopSignalWatch();
    pendingAccelerator = null;
    if (registeredAccelerator) {
        globalShortcut.unregister(registeredAccelerator);
        registeredAccelerator = null;
    }
    keybindPendingCount = 0;
    if (keybindResolvers.length > 0) {
        const rs = keybindResolvers.splice(0);
        for (const r of rs) r();
    }
}

export function waitForKeybind(_e: IpcMainInvokeEvent): Promise<void> {
    if (keybindPendingCount > 0) { keybindPendingCount--; return Promise.resolve(); }
    return new Promise(resolve => { keybindResolvers.push(resolve); });
}

export function cancelKeybindWait(_e: IpcMainInvokeEvent): void {
    keybindPendingCount = 0;
    if (keybindResolvers.length > 0) {
        const rs = keybindResolvers.splice(0);
        for (const r of rs) r();
    }
}