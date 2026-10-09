/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { globalPatches, navPatches } from "@api/ContextMenu";
import { isPluginEnabled, plugins as Plugins } from "@api/PluginManager";
import { definePluginSettings } from "@api/Settings";
import definePlugin, { OptionType } from "@utils/types";
import { FluxDispatcher } from "@webpack/common";

type FluxHandler = (event: any) => void;

const settings = definePluginSettings({
    fluxBus: {
        type: OptionType.BOOLEAN,
        description: "Coalesce duplicate Flux event subscriptions into a single dispatch. Reduces event-loop overhead when many plugins listen to the same events.",
        default: true,
    },
    contextMenuHardening: {
        type: OptionType.BOOLEAN,
        description: "Wrap context menu patches so a patch that repeatedly throws is auto-disabled instead of taxing every menu open.",
        default: true,
    },
});

let originalSubscribe: typeof FluxDispatcher.subscribe | null = null;
let originalUnsubscribe: typeof FluxDispatcher.unsubscribe | null = null;
const fluxSubscribers = new Map<string, Set<FluxHandler>>();
const fluxFans = new Map<string, FluxHandler>();
let fluxBusActive = false;

function fluxFan(actionType: string): FluxHandler {
    return event => {
        const set = fluxSubscribers.get(actionType);
        if (!set) return;
        for (const handler of set) {
            try {
                handler(event);
            } catch {}
        }
    };
}

function wrappedSubscribe(this: typeof FluxDispatcher, actionType: any, handler: FluxHandler) {
    if (!fluxBusActive || !originalSubscribe) {
        return originalSubscribe!.call(FluxDispatcher, actionType, handler);
    }
    let set = fluxSubscribers.get(actionType);
    if (!set) {
        set = new Set();
        fluxSubscribers.set(actionType, set);
    }
    set.add(handler);
    if (set.size === 1) {
        const fan = fluxFan(actionType);
        fluxFans.set(actionType, fan);
        originalSubscribe.call(FluxDispatcher, actionType, fan);
    }
    return handler;
}

function wrappedUnsubscribe(this: typeof FluxDispatcher, actionType: any, handler: FluxHandler) {
    if (!fluxBusActive || !originalUnsubscribe) {
        return originalUnsubscribe!.call(FluxDispatcher, actionType, handler);
    }
    const set = fluxSubscribers.get(actionType);
    if (!set || !set.has(handler)) {
        originalUnsubscribe.call(FluxDispatcher, actionType, handler);
        return;
    }
    set.delete(handler);
    if (set.size === 0) {
        const fan = fluxFans.get(actionType);
        if (fan) {
            originalUnsubscribe.call(FluxDispatcher, actionType, fan);
            fluxFans.delete(actionType);
        }
        fluxSubscribers.delete(actionType);
    }
}

function startFluxBus() {
    if (fluxBusActive) return;
    originalSubscribe = FluxDispatcher.subscribe.bind(FluxDispatcher) as typeof FluxDispatcher.subscribe;
    originalUnsubscribe = FluxDispatcher.unsubscribe.bind(FluxDispatcher) as typeof FluxDispatcher.unsubscribe;
    fluxBusActive = true;
    (FluxDispatcher as any).subscribe = wrappedSubscribe;
    (FluxDispatcher as any).unsubscribe = wrappedUnsubscribe;

    for (const name in Plugins) {
        const p = Plugins[name];
        if (!p?.flux || !isPluginEnabled(name)) continue;
        for (const event of Object.keys(p.flux)) {
            const handler = p.flux[event] as FluxHandler | undefined;
            if (!handler) continue;
            try {
                originalUnsubscribe.call(FluxDispatcher, event, handler);
            } catch {}
            wrappedSubscribe.call(FluxDispatcher, event, handler);
        }
    }
}

function stopFluxBus() {
    if (!fluxBusActive || !originalSubscribe || !originalUnsubscribe) return;
    fluxBusActive = false;
    (FluxDispatcher as any).subscribe = originalSubscribe;
    (FluxDispatcher as any).unsubscribe = originalUnsubscribe;

    for (const [actionType, set] of fluxSubscribers) {
        const fan = fluxFans.get(actionType);
        if (fan) {
            try {
                originalUnsubscribe.call(FluxDispatcher, actionType, fan);
            } catch {}
        }
        for (const handler of set) {
            try {
                originalSubscribe.call(FluxDispatcher, actionType, handler);
            } catch {}
        }
    }
    fluxSubscribers.clear();
    fluxFans.clear();
    originalSubscribe = null;
    originalUnsubscribe = null;
}

const FAIL_LIMIT = 5;

let hardeningActive = false;
const wrappedToOriginal = new Map<Function, Function>();
let failCounts = new WeakMap<Function, number>();
let disabledPatches = new WeakSet<Function>();

type NavPatch = (children: Array<any>, ...args: Array<any>) => void;
type GlobalPatch = (navId: string, children: Array<any>, ...args: Array<any>) => void;

function makeHardenedNav(fn: NavPatch) {
    const wrapped = function (children: Array<any>, ...args: Array<any>) {
        if (disabledPatches.has(fn)) return;
        if (!hardeningActive) {
            return fn(children, ...args);
        }
        try {
            fn(children, ...args);
            if (failCounts.has(fn)) failCounts.delete(fn);
        } catch {
            const count = (failCounts.get(fn) ?? 0) + 1;
            failCounts.set(fn, count);
            if (count >= FAIL_LIMIT) {
                disabledPatches.add(fn);
            }
        }
    };
    wrappedToOriginal.set(wrapped, fn);
    return wrapped;
}

function makeHardenedGlobal(fn: GlobalPatch) {
    const wrapped = function (navId: string, children: Array<any>, ...args: Array<any>) {
        if (disabledPatches.has(fn)) return;
        if (!hardeningActive) {
            return fn(navId, children, ...args);
        }
        try {
            fn(navId, children, ...args);
            if (failCounts.has(fn)) failCounts.delete(fn);
        } catch {
            const count = (failCounts.get(fn) ?? 0) + 1;
            failCounts.set(fn, count);
            if (count >= FAIL_LIMIT) {
                disabledPatches.add(fn);
            }
        }
    };
    wrappedToOriginal.set(wrapped, fn);
    return wrapped;
}

function startContextMenuHardening() {
    if (hardeningActive) return;
    hardeningActive = true;
    for (const set of navPatches.values()) {
        const originals = [...set];
        for (const fn of originals) {
            if (typeof fn !== "function" || wrappedToOriginal.has(fn)) continue;
            set.delete(fn);
            set.add(makeHardenedNav(fn as NavPatch));
        }
    }
    const globals = [...globalPatches];
    for (const fn of globals) {
        if (typeof fn !== "function" || wrappedToOriginal.has(fn)) continue;
        globalPatches.delete(fn);
        globalPatches.add(makeHardenedGlobal(fn as GlobalPatch));
    }
}

function stopContextMenuHardening() {
    if (!hardeningActive) return;
    hardeningActive = false;
    for (const set of navPatches.values()) {
        const wrappers = [...set];
        for (const fn of wrappers) {
            const original = wrappedToOriginal.get(fn);
            if (!original) continue;
            set.delete(fn);
            set.add(original as NavPatch);
        }
    }
    const globals = [...globalPatches];
    for (const fn of globals) {
        const original = wrappedToOriginal.get(fn);
        if (!original) continue;
        globalPatches.delete(fn);
        globalPatches.add(original as GlobalPatch);
    }
    wrappedToOriginal.clear();
    failCounts = new WeakMap();
    disabledPatches = new WeakSet();
}

export default definePlugin({
    name: "OrchestratorAPI",
    description: "Transparent performance orchestrator. Coalesces duplicate Flux subscriptions and hardens context menu patches so the client stays smooth under heavy plugin load.",
    authors: [Devs.x2b, { id: 456195985404592149n, name: "zfrancesck1" }],
    tags: ["Utility", "Developers"],
    enabledByDefault: true,
    required: true,
    settings,

    start() {
        try {
            if (settings.store.fluxBus) startFluxBus();
        } catch {}
        try {
            if (settings.store.contextMenuHardening) startContextMenuHardening();
        } catch {}
    },

    stop() {
        try {
            stopContextMenuHardening();
        } catch {}
        try {
            stopFluxBus();
        } catch {}
    },
});