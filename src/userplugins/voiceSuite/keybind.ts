/*
 * TrashCord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export const SIDED_MOD = /^R(Control|Shift|Alt|Super)$/;
export const BASE_ID = 0x5D00;

const VK: Record<string, number> = {
    Control: 162, RControl: 163, Shift: 160, RShift: 161, Alt: 164, RAlt: 165, Super: 91, RSuper: 92,
    Space: 32, Return: 13, Tab: 9, Backspace: 8, Delete: 46, Insert: 45, Home: 36, End: 35,
    PageUp: 33, PageDown: 34, Left: 37, Up: 38, Right: 39, Down: 40, PrintScreen: 44,
    "-": 189, "=": 187, "[": 219, "]": 221, "\\": 220, ";": 186, "'": 222, ",": 188, ".": 190,
    numadd: 107, numsub: 109, nummult: 106, numdiv: 111, numdec: 110
};

const CODE_KEYS: Record<string, string> = {
    Space: "Space", Enter: "Return", Tab: "Tab", Backspace: "Backspace", Delete: "Delete",
    Insert: "Insert", Home: "Home", End: "End", PageUp: "PageUp", PageDown: "PageDown",
    ArrowUp: "Up", ArrowDown: "Down", ArrowLeft: "Left", ArrowRight: "Right", PrintScreen: "PrintScreen",
    Minus: "-", Equal: "=", BracketLeft: "[", BracketRight: "]", Backslash: "\\",
    Semicolon: ";", Quote: "'", Comma: ",", Period: "."
};

const NUMPAD: Record<string, string> = {
    Add: "numadd", Subtract: "numsub", Multiply: "nummult", Divide: "numdiv", Decimal: "numdec", Enter: "Return"
};

const MODS: Record<string, string> = {
    ControlLeft: "Control", ControlRight: "RControl", ShiftLeft: "Shift", ShiftRight: "RShift",
    AltLeft: "Alt", AltRight: "RAlt", MetaLeft: "Super", MetaRight: "RSuper"
};

const DEBOUNCE_MS = 300;

let nextId = BASE_ID;
let supported: boolean | null = null;
let recording = false;
let cancelFn: (() => void) | null = null;

const active = new Map<string, number>();

function codeToKey(code: string): string | null {
    if (code.startsWith("Key")) return code.slice(3);
    if (code.startsWith("Digit")) return code.slice(5);
    if (/^F\d{1,2}$/.test(code)) return code;
    if (code.startsWith("Numpad")) {
        const sub = code.slice(6);
        return /^\d$/.test(sub) ? `num${sub}` : NUMPAD[sub] ?? null;
    }
    return CODE_KEYS[code] ?? null;
}

function keyToVk(key: string): number | null {
    if (VK[key] != null) return VK[key];
    if (/^[A-Z]$/i.test(key)) return key.toUpperCase().charCodeAt(0);
    if (/^\d$/.test(key)) return key.charCodeAt(0);
    if (/^F\d{1,2}$/.test(key)) {
        const n = Number(key.slice(1));
        return n >= 1 && n <= 24 ? 111 + n : null;
    }
    if (/^num\d$/.test(key)) return 96 + Number(key.slice(3));
    return null;
}

function toKeys(accelerator: string): [number, number, string][] | null {
    const parts = accelerator.split("+");
    if (parts.length > 5) return null;
    const keys: [number, number, string][] = [];
    for (const part of parts) {
        const vk = keyToVk(part);
        if (vk == null) return null;
        keys.push([0, vk, "0:0"]);
    }
    return keys;
}

export function toElectron(accelerator: string): string {
    return accelerator.split("+").map(p => SIDED_MOD.test(p) ? p.slice(1) : p).join("+");
}

export function matchesAccel(saved: string, fired: string): boolean {
    if (saved === fired) return true;
    return toElectron(saved) === fired;
}

export function canUseNativeKeybinds(): boolean {
    if (supported !== null) return supported;
    try {
        const win = DiscordNative?.process?.platform === "win32" && !("VesktopNative" in window);
        const u = win ? DiscordNative.nativeModules.requireModule("discord_utils") : null;
        supported = typeof u?.inputEventRegister === "function" && typeof u?.inputEventUnregister === "function";
    } catch {
        supported = false;
    }
    return supported;
}

const utils = () => DiscordNative.nativeModules.requireModule("discord_utils");

function nativeUnregister(id: number) {
    try { utils().inputEventUnregister(id); } catch { }
}

function nativeRegister(id: number, accelerator: string, cb: () => void): boolean {
    const keys = toKeys(accelerator);
    if (!keys) return false;
    let last = 0;
    try {
        const u = utils();
        u.inputEventUnregister(id);
        u.inputEventRegister(id, keys, (down: boolean) => {
            if (!down) return;
            const now = Date.now();
            if (now - last < DEBOUNCE_MS) return;
            last = now;
            try { cb(); } catch { }
        }, { blurred: true, focused: true, keydown: true, keyup: false });
        return true;
    } catch {
        return false;
    }
}

export function tryNative(accelerator: string, cb: (accel: string) => void): boolean {
    const acc = accelerator.trim();
    if (!acc || acc.length > 64) return false;
    if (active.has(acc)) return true;
    if (!canUseNativeKeybinds()) return false;
    const id = nextId++;
    if (nativeRegister(id, acc, () => cb(acc))) {
        active.set(acc, id);
        return true;
    }
    return false;
}

export function hasNative(accelerator: string): boolean {
    return active.has(accelerator);
}

export function nativeAccels(): string[] {
    return [...active.keys()];
}

export function dropNative(accelerator: string): void {
    const id = active.get(accelerator);
    if (id === undefined) return;
    active.delete(accelerator);
    nativeUnregister(id);
}

export function dropAllNative(): void {
    for (const acc of nativeAccels()) dropNative(acc);
}

export function recordAccelerator(): Promise<string | null> {
    if (recording) return Promise.resolve(null);
    recording = true;
    return new Promise(resolve => {
        const held = new Set<string>();
        const finish = (value: string | null) => {
            window.removeEventListener("keydown", down, true);
            window.removeEventListener("keyup", up, true);
            recording = false;
            cancelFn = null;
            resolve(value);
        };
        cancelFn = () => finish(null);
        const down = (e: KeyboardEvent) => {
            e.preventDefault();
            e.stopImmediatePropagation();
            if (e.code === "Escape") return finish(null);
            if (MODS[e.code]) { held.add(e.code); return; }
            const key = codeToKey(e.code);
            if (!key) return;
            const mods = Object.keys(MODS).filter(c => held.has(c)).map(c => MODS[c]);
            finish([...mods, key].join("+"));
        };
        const up = (e: KeyboardEvent) => {
            e.preventDefault();
            e.stopImmediatePropagation();
            held.delete(e.code);
        };
        window.addEventListener("keydown", down, true);
        window.addEventListener("keyup", up, true);
    });
}

export function cancelRecording(): void {
    if (cancelFn) cancelFn();
}