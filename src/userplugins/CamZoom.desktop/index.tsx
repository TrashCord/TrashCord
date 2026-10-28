/*
 * TrashCord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import definePlugin, { OptionType } from "@utils/types";

const STYLE_ID = "vc-camzoom-style";
const P = "vc-camzoom";
const HIDE_DELAY = 2000;
const TILE_SEL = "[data-selenium-video-tile]";
const DRAG_THRESH = 5;
const EPS = 1.001;

const settings = definePluginSettings({
    maxZoom: {
        type: OptionType.SLIDER,
        description: "Maximum zoom level",
        default: 5,
        markers: [2, 3, 4, 5, 8, 10],
    },
    zoomSpeed: {
        type: OptionType.SLIDER,
        description: "Scroll wheel sensitivity",
        default: 0.3,
        markers: [0.05, 0.1, 0.15, 0.3, 0.5],
    },
    minimapWidth: {
        type: OptionType.SLIDER,
        description: "Minimap width (px)",
        default: 200,
        markers: [100, 130, 160, 200, 240],
    },
    autoMobileCamView: {
        type: OptionType.BOOLEAN,
        description: "Automatically adapt minimap shape for portrait (mobile) cameras",
        default: true,
    },
    forceMirror: {
        type: OptionType.BOOLEAN,
        description: "Force camera to be mirrored. Leave OFF if NoMirroredCamera is enabled.",
        default: false,
    },
    doubleClickReset: {
        type: OptionType.BOOLEAN,
        description: "Double-click on video to reset zoom",
        default: false,
    },
    middleClickReset: {
        type: OptionType.BOOLEAN,
        description: "Middle-click to reset zoom",
        default: false,
    },
    smoothTransition: {
        type: OptionType.BOOLEAN,
        description: "Animate zoom transitions",
        default: false,
    },
    invertScroll: {
        type: OptionType.BOOLEAN,
        description: "Invert scroll direction",
        default: false,
    },
});

interface TileEntry {
    kill: () => void;
    isValid: () => boolean;
}

interface Panel {
    el: HTMLDivElement;
    minimap: HTMLDivElement;
    mmVid: HTMLVideoElement;
    ind: HTMLDivElement;
    btnMinus: HTMLButtonElement;
    btnPlus: HTMLButtonElement;
    fill: HTMLDivElement;
    grab: HTMLDivElement;
    tip: HTMLDivElement;
}

const tiles = new WeakMap<HTMLElement, TileEntry>();
const active = new Set<HTMLElement>();

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

const mk = (cls: string) => {
    const d = document.createElement("div");
    d.className = cls;
    return d;
};

function computeMirror(vid: HTMLElement): boolean {
    if (settings.store.forceMirror) return true;
    if (document.getElementById("no-mirrored-camera-fix")) return false;
    return /(^|\s)mirror/.test(vid.className);
}

function isScreenshare(tile: HTMLElement): boolean {
    if (tile.querySelector('[class*="liveIndicator"]')) return true;
    const ft = tile.querySelector('[class*="focusTarget"]');
    return !!ft?.getAttribute("aria-label")?.toLowerCase().includes("streaming");
}

function findVid(tile: HTMLElement): { wrapper: HTMLElement; vid: HTMLElement; src: HTMLVideoElement; } | null {
    for (const wrapper of tile.querySelectorAll<HTMLElement>('[class*="videoWrapper"]')) {
        const vid = wrapper.querySelector<HTMLElement>('[class*="media-engine-video"]');
        const src = vid?.querySelector<HTMLVideoElement>("video");
        if (vid && src) return { wrapper, vid, src };
    }
    return null;
}

function isMobileCam(src: HTMLVideoElement): boolean {
    if (!settings.store.autoMobileCamView) return false;
    return src.videoWidth > 0 && src.videoHeight > 0 && src.videoHeight > src.videoWidth;
}

function isInPiP(tile: HTMLElement): boolean {
    return !!tile.closest('[class*="pictureInPicture"], [class*="container__2aff1"]');
}

function isInHiddenPanel(tile: HTMLElement): boolean {
    const p = tile.closest<HTMLElement>('[class*="participantsWrapperAnimated"]');
    return !!p && p.style.visibility === "hidden";
}

const SVG_IN = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="none" viewBox="0 0 24 24"><path fill="currentColor" fill-rule="evenodd" d="M15.62 17.03a9 9 0 1 1 1.41-1.41l4.68 4.67a1 1 0 0 1-1.42 1.42l-4.67-4.68ZM17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0Z" clip-rule="evenodd"/><path fill="currentColor" d="M11 7a1 1 0 1 0-2 0v2H7a1 1 0 1 0 0 2h2v2a1 1 0 1 0 2 0v-2h2a1 1 0 1 0 0-2h-2V7Z"/></svg>`;
const SVG_OUT = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="none" viewBox="0 0 24 24"><path fill="currentColor" fill-rule="evenodd" d="M15.62 17.03a9 9 0 1 1 1.41-1.41l4.68 4.67a1 1 0 0 1-1.42 1.42l-4.67-4.68ZM17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0Z" clip-rule="evenodd"/><path fill="currentColor" d="M6 10a1 1 0 0 1 1-1h6a1 1 0 1 1 0 2H7a1 1 0 0 1-1-1Z"/></svg>`;

function initTile(tile: HTMLElement) {
    const found = findVid(tile);
    if (!found) return;
    const { wrapper, vid, src } = found;

    let dead = false;
    let scale = 1, panX = 0, panY = 0;
    let w = 0, h = 0;
    let zoomed = false;
    let mirror = false;
    let mobile = isMobileCam(src);
    let raf = 0;
    let ro: ResizeObserver | null = null;
    let curTransition = "";
    let wheelDY = 0, wheelX = 0, wheelY = 0;

    let panel: Panel | null = null;
    let panelShown = false;
    let hovering = false, sliding = false, mmDragging = false;
    let lastAct = 0, timer = 0;
    let mmW = 0, mmH = 0, indScale = 0;

    let dragging = false, lastX = 0, lastY = 0, dragDist = 0;

    const prevOverflow = wrapper.style.overflow;
    const prevWrapperPos = wrapper.style.position;
    const prevTilePos = tile.style.position;
    if (getComputedStyle(wrapper).position === "static") wrapper.style.position = "relative";
    if (getComputedStyle(tile).position === "static") tile.style.position = "relative";
    wrapper.style.overflow = "hidden";
    wrapper.classList.add(`${P}-host`);

    const schedule = () => { if (!raf && !dead) raf = requestAnimationFrame(flush); };

    const lockCursor = (on: boolean) => {
        const id = `${P}-cursor-lock`;
        const ex = document.getElementById(id);
        if (!on) { ex?.remove(); return; }
        if (ex) return;
        const st = document.createElement("style");
        st.id = id;
        st.textContent = "* { cursor: ew-resize !important; }";
        document.head.appendChild(st);
    };

    const syncStream = () => {
        if (!panel || !panelShown) return;
        const so = src.srcObject;
        if (so && panel.mmVid.srcObject !== so) {
            panel.mmVid.srcObject = so;
            panel.mmVid.play().catch(() => { });
        }
    };

    const sizeMinimap = () => {
        if (!panel) return;
        const base = settings.store.minimapWidth;
        mmW = mobile ? Math.round(base * 9 / 16) : base;
        mmH = mobile ? base : Math.round(base * 9 / 16);
        panel.minimap.style.width = `${mmW}px`;
        panel.minimap.style.height = `${mmH}px`;
        indScale = 0;
    };

    const adjustBottom = () => {
        if (!panel) return;
        let bottom = 10;
        const bc = document.querySelector<HTMLElement>('[class*="bottomControls"]');
        if (bc) {
            const overlap = wrapper.getBoundingClientRect().bottom - bc.getBoundingClientRect().top;
            if (overlap > 4) bottom = Math.round(overlap) + 10;
        }
        panel.el.style.bottom = `${bottom}px`;
    };

    const updatePanel = () => {
        const p = panel;
        if (!p || !panelShown) return;
        const m = settings.store.maxZoom;
        const pcs = `${m > 1 ? clamp(((scale - 1) / (m - 1)) * 100, 0, 100) : 0}%`;
        p.fill.style.width = pcs;
        p.grab.style.left = pcs;
        p.tip.style.left = pcs;
        const label = `${Math.round(scale * 100)}%`;
        if (p.tip.textContent !== label) p.tip.textContent = label;
        p.btnMinus.disabled = scale <= EPS;
        p.btnPlus.disabled = scale >= m - 0.001;

        if (scale <= EPS || !w || !h || !mmW || !mmH) {
            if (indScale !== 1) {
                p.ind.style.width = `${mmW}px`;
                p.ind.style.height = `${mmH}px`;
                indScale = 1;
            }
            p.ind.style.transform = "translate(0px,0px)";
            return;
        }
        const iW = mmW / scale, iH = mmH / scale;
        if (indScale !== scale) {
            p.ind.style.width = `${iW}px`;
            p.ind.style.height = `${iH}px`;
            indScale = scale;
        }
        const left = clamp(mmW / 2 - iW / 2 - panX * mmW / (w * scale), 0, mmW - iW);
        const top = clamp(mmH / 2 - iH / 2 - panY * mmH / (h * scale), 0, mmH - iH);
        p.ind.style.transform = `translate(${left}px,${top}px)`;
    };

    const beginZoom = () => {
        zoomed = true;
        w = wrapper.offsetWidth;
        h = wrapper.offsetHeight;
        mirror = computeMirror(vid);
        vid.style.transformOrigin = "center center";
        vid.style.willChange = "transform";
        wrapper.classList.add(`${P}-zoomed`);
        ro = new ResizeObserver(entries => {
            const r = entries[0]?.contentRect;
            if (!r || (r.width === w && r.height === h)) return;
            w = r.width; h = r.height;
            schedule();
        });
        ro.observe(wrapper);
        showPanel();
    };

    const endZoom = () => {
        zoomed = false;
        dragging = false;
        ro?.disconnect();
        ro = null;
        vid.style.transform = settings.store.forceMirror ? "scaleX(-1)" : "";
        vid.style.transition = "";
        vid.style.willChange = "";
        vid.style.transformOrigin = "";
        curTransition = "";
        wrapper.classList.remove(`${P}-zoomed`, `${P}-dragging`);
    };

    const flush = () => {
        raf = 0;
        if (dead) return;
        const m = settings.store.maxZoom;

        if (wheelDY !== 0) {
            const dir = settings.store.invertScroll ? 1 : -1;
            const delta = dir * wheelDY * settings.store.zoomSpeed * 0.01;
            wheelDY = 0;
            const next = clamp(scale * (1 + delta), 1, m);
            if (next !== scale) {
                if (!zoomed) beginZoom();
                const r = wrapper.getBoundingClientRect();
                const ratio = next / scale;
                panX = (wheelX - r.left - r.width / 2) * (1 - ratio) + panX * ratio;
                panY = (wheelY - r.top - r.height / 2) * (1 - ratio) + panY * ratio;
                scale = next;
            }
        }

        if (scale > m) scale = m;

        if (scale <= EPS) {
            scale = 1; panX = 0; panY = 0;
            if (zoomed) { endZoom(); if (!panelShown) destroyPanel(); }
        } else {
            if (!zoomed) beginZoom();
            const ex = w * (scale - 1) / 2;
            const ey = h * (scale - 1) / 2;
            panX = clamp(panX, -ex, ex);
            panY = clamp(panY, -ey, ey);
            const tr = settings.store.smoothTransition ? "transform 0.1s ease-out" : "none";
            if (tr !== curTransition) { vid.style.transition = tr; curTransition = tr; }
            vid.style.transform = `translate(${panX}px,${panY}px) scale(${scale})${mirror ? " scaleX(-1)" : ""}`;
        }
        updatePanel();
    };

    const arm = (ms: number) => {
        timer = window.setTimeout(() => {
            timer = 0;
            if (dead) return;
            if (!tile.isConnected) { kill(); return; }
            if (hovering || sliding || mmDragging) { arm(HIDE_DELAY); return; }
            const left = HIDE_DELAY - (performance.now() - lastAct);
            if (left > 20) arm(left); else hidePanel();
        }, ms);
    };

    const showPanel = () => {
        lastAct = performance.now();
        if (!panel) panel = buildPanel();
        if (!panelShown) {
            panelShown = true;
            mobile = isMobileCam(src);
            sizeMinimap();
            const mm = computeMirror(vid);
            if (zoomed && mm !== mirror) { mirror = mm; schedule(); }
            panel.mmVid.style.transform = mm ? "scaleX(-1)" : "";
            syncStream();
            adjustBottom();
            panel.el.style.opacity = "0.999";
            panel.el.style.pointerEvents = "auto";
            updatePanel();
        }
        if (!timer) arm(HIDE_DELAY);
    };

    const hidePanel = () => {
        if (!panel) return;
        panelShown = false;
        panel.el.style.opacity = "0";
        panel.el.style.pointerEvents = "none";
        panel.mmVid.srcObject = null;
    };

    const destroyPanel = () => {
        if (timer) { clearTimeout(timer); timer = 0; }
        lockCursor(false);
        if (!panel) return;
        panel.mmVid.srcObject = null;
        panel.el.remove();
        panel = null;
        panelShown = false;
        hovering = sliding = mmDragging = false;
    };

    const touch = () => {
        if (!zoomed && !panel) return;
        lastAct = performance.now();
        if (!panelShown) showPanel();
        else if (!timer) arm(HIDE_DELAY);
    };

    function buildPanel(): Panel {
        const el = mk(`${P}-panel`) as HTMLDivElement;
        const minimap = mk(`${P}-minimap`) as HTMLDivElement;
        const ind = mk(`${P}-ind`) as HTMLDivElement;

        const mmVid = document.createElement("video");
        mmVid.muted = true;
        mmVid.autoplay = true;
        mmVid.playsInline = true;
        mmVid.style.cssText = "display:block;width:100%;height:100%;object-fit:cover;";
        minimap.append(mmVid, ind);

        const mkBtn = (svg: string, label: string) => {
            const b = document.createElement("button");
            b.type = "button";
            b.className = `${P}-btn`;
            b.setAttribute("aria-label", label);
            b.innerHTML = `<div class="${P}-btn-inner">${svg}</div>`;
            return b;
        };
        const btnMinus = mkBtn(SVG_OUT, "Zoom out");
        const btnPlus = mkBtn(SVG_IN, "Zoom in");

        const sliderWrap = mk(`${P}-slider-wrap`);
        const track = mk(`${P}-slider-track`);
        const fill = mk(`${P}-slider-fill`) as HTMLDivElement;
        const grab = mk(`${P}-slider-grab`) as HTMLDivElement;
        const tip = mk(`${P}-tooltip`) as HTMLDivElement;
        tip.textContent = "100%";
        track.append(fill, grab, tip);
        sliderWrap.appendChild(track);

        const row = mk(`${P}-row`);
        row.append(btnMinus, sliderWrap, btnPlus);
        el.append(minimap, row);

        const p: Panel = { el, minimap, mmVid, ind, btnMinus, btnPlus, fill, grab, tip };

        el.addEventListener("click", e => e.stopImmediatePropagation(), true);
        el.addEventListener("pointerenter", () => { hovering = true; });
        el.addEventListener("pointerleave", () => { hovering = false; touch(); });
        el.addEventListener("transitionend", e => {
            if (e.target === el && !panelShown && !zoomed) destroyPanel();
        });

        let mmLastX = 0, mmLastY = 0;
        minimap.addEventListener("pointerdown", e => {
            e.preventDefault(); e.stopPropagation();
            if (scale <= 1) return;
            const ir = ind.getBoundingClientRect();
            const tol = Math.max(6, Math.min(ir.width, ir.height) * 0.25);
            if (e.clientX < ir.left - tol || e.clientX > ir.right + tol ||
                e.clientY < ir.top - tol || e.clientY > ir.bottom + tol) return;
            try { minimap.setPointerCapture(e.pointerId); } catch {}
            mmDragging = true; mmLastX = e.clientX; mmLastY = e.clientY;
            minimap.classList.add(`${P}-mm-dragging`);
        });
        minimap.addEventListener("pointermove", e => {
            if (!mmDragging || !mmW || !mmH) return;
            panX -= (e.clientX - mmLastX) * (w * scale) / mmW;
            panY -= (e.clientY - mmLastY) * (h * scale) / mmH;
            mmLastX = e.clientX; mmLastY = e.clientY;
            schedule();
        });
        const stopMm = (e: PointerEvent) => {
            if (!mmDragging) return;
            mmDragging = false;
            minimap.classList.remove(`${P}-mm-dragging`);
            try { if (minimap.hasPointerCapture(e.pointerId)) minimap.releasePointerCapture(e.pointerId); } catch {}
        };
        minimap.addEventListener("pointerup", stopMm);
        minimap.addEventListener("pointercancel", stopMm);
        minimap.addEventListener("lostpointercapture", stopMm);

        let trackRect: DOMRect | null = null;
        const setFromPtr = (e: PointerEvent) => {
            if (!trackRect || !trackRect.width) return;
            const m = settings.store.maxZoom;
            scale = clamp(1 + ((e.clientX - trackRect.left) / trackRect.width) * (m - 1), 1, m);
            if (scale <= 1) { panX = 0; panY = 0; }
            schedule();
        };
        const endSlide = () => {
            if (!sliding) return;
            sliding = false;
            trackRect = null;
            sliderWrap.classList.remove(`${P}-sliding`);
            lockCursor(false);
        };
        track.addEventListener("pointerdown", e => {
            e.preventDefault(); e.stopPropagation();
            try { track.setPointerCapture(e.pointerId); } catch {}
            trackRect = track.getBoundingClientRect();
            sliding = true;
            sliderWrap.classList.add(`${P}-sliding`);
            lockCursor(true);
            setFromPtr(e);
        });
        track.addEventListener("pointermove", e => { if (sliding) setFromPtr(e); });
        track.addEventListener("pointerup", endSlide);
        track.addEventListener("pointercancel", endSlide);
        track.addEventListener("lostpointercapture", endSlide);

        const step = () => (settings.store.maxZoom - 1) / 8;
        btnMinus.addEventListener("pointerdown", e => {
            e.preventDefault(); e.stopPropagation();
            scale = clamp(scale - step(), 1, settings.store.maxZoom);
            if (scale <= 1) { panX = 0; panY = 0; }
            schedule();
        });
        btnPlus.addEventListener("pointerdown", e => {
            e.preventDefault(); e.stopPropagation();
            scale = clamp(scale + step(), 1, settings.store.maxZoom);
            schedule();
        });

        el.style.opacity = "0";
        el.style.pointerEvents = "none";
        tile.appendChild(el);
        return p;
    }

    const reset = () => { scale = 1; panX = 0; panY = 0; schedule(); };

    const onWheel = (e: WheelEvent) => {
        e.preventDefault();
        wheelDY += e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * 100 : e.deltaY;
        wheelX = e.clientX; wheelY = e.clientY;
        schedule();
        if (zoomed) touch();
    };

    const onPointerDown = (e: PointerEvent) => {
        if (e.button === 1 && settings.store.middleClickReset) {
            e.preventDefault();
            reset();
            return;
        }
        if (e.button !== 0 || scale <= 1) return;
        e.preventDefault();
        dragDist = 0;
        try { wrapper.setPointerCapture(e.pointerId); } catch {}
        dragging = true; lastX = e.clientX; lastY = e.clientY;
        wrapper.classList.add(`${P}-dragging`);
    };

    const onPointerMove = (e: PointerEvent) => {
        if (!dragging) return;
        const dx = e.clientX - lastX, dy = e.clientY - lastY;
        lastX = e.clientX; lastY = e.clientY;
        dragDist += Math.hypot(dx, dy);
        panX += dx; panY += dy;
        schedule();
        touch();
    };

    const onPointerUp = (e: PointerEvent) => {
        if (!dragging) return;
        dragging = false;
        wrapper.classList.remove(`${P}-dragging`);
        try { if (wrapper.hasPointerCapture(e.pointerId)) wrapper.releasePointerCapture(e.pointerId); } catch {}
    };

    const onClick = (e: MouseEvent) => {
        if (dragDist > DRAG_THRESH) { e.stopImmediatePropagation(); dragDist = 0; }
    };

    const onDblClick = () => {
        if (dragDist > DRAG_THRESH) { dragDist = 0; return; }
        if (settings.store.doubleClickReset) reset();
    };

    const onTileMove = () => { if (zoomed) touch(); };

    const onSrcMeta = () => {
        const m = isMobileCam(src);
        if (m !== mobile) {
            mobile = m;
            if (panel && panelShown) { sizeMinimap(); updatePanel(); }
        }
        syncStream();
    };

    wrapper.addEventListener("wheel", onWheel, { passive: false });
    wrapper.addEventListener("pointerdown", onPointerDown);
    wrapper.addEventListener("pointermove", onPointerMove);
    wrapper.addEventListener("pointerup", onPointerUp);
    wrapper.addEventListener("pointercancel", onPointerUp);
    wrapper.addEventListener("click", onClick, true);
    wrapper.addEventListener("dblclick", onDblClick);
    tile.addEventListener("pointermove", onTileMove);
    src.addEventListener("loadedmetadata", onSrcMeta);
    src.addEventListener("resize", onSrcMeta);

    const kill = () => {
        if (dead) return;
        dead = true;
        if (raf) { cancelAnimationFrame(raf); raf = 0; }
        ro?.disconnect(); ro = null;
        destroyPanel();
        wrapper.removeEventListener("wheel", onWheel);
        wrapper.removeEventListener("pointerdown", onPointerDown);
        wrapper.removeEventListener("pointermove", onPointerMove);
        wrapper.removeEventListener("pointerup", onPointerUp);
        wrapper.removeEventListener("pointercancel", onPointerUp);
        wrapper.removeEventListener("click", onClick, true);
        wrapper.removeEventListener("dblclick", onDblClick);
        tile.removeEventListener("pointermove", onTileMove);
        src.removeEventListener("loadedmetadata", onSrcMeta);
        src.removeEventListener("resize", onSrcMeta);
        wrapper.classList.remove(`${P}-host`, `${P}-zoomed`, `${P}-dragging`);
        vid.style.transform = "";
        vid.style.transition = "";
        vid.style.transformOrigin = "";
        vid.style.willChange = "";
        wrapper.style.overflow = prevOverflow;
        wrapper.style.position = prevWrapperPos;
        tile.style.position = prevTilePos;
        tiles.delete(tile);
        active.delete(tile);
    };

    tiles.set(tile, {
        kill,
        isValid: () => src.isConnected && vid.isConnected && wrapper.isConnected,
    });
    active.add(tile);
}

function prune() {
    for (const old of active) if (!old.isConnected) tiles.get(old)?.kill();
}

function onGlobalWheel(e: WheelEvent) {
    const t = e.target;
    if (!(t instanceof Element)) return;
    const tile = t.closest<HTMLElement>(TILE_SEL);
    if (!tile) return;

    const entry = tiles.get(tile);
    if (entry) {
        if (entry.isValid()) return;
        entry.kill();
    }
    if (isInPiP(tile) || isInHiddenPanel(tile) || isScreenshare(tile)) return;

    prune();

    initTile(tile);
}

const CSS = `
.${P}-host { user-select: none; cursor: default; }
.${P}-host.${P}-dragging { cursor: grabbing !important; }

.${P}-panel {
    position: absolute;
    bottom: 10px; right: 10px;
    display: flex;
    flex-direction: column;
    align-items: stretch;
    border-radius: 6px;
    overflow: visible;
    box-shadow: 0 4px 20px rgba(0,0,0,0.5);
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.3s ease;
    z-index: 9999;
}

.${P}-minimap {
    position: relative;
    background: #000;
    border-radius: 6px 6px 0 0;
    overflow: hidden;
    flex-shrink: 0;
    cursor: default;
    contain: layout paint;
    border: 1px solid rgba(255,255,255,0.15);
    border-bottom: none;
}
.${P}-minimap.${P}-mm-dragging { cursor: grabbing; }

.${P}-ind {
    position: absolute;
    left: 0; top: 0;
    width: 100%; height: 100%;
    border: 2px solid #5865F2;
    background: rgba(88,101,242,0.15);
    box-sizing: border-box;
    border-radius: 2px;
    cursor: grab;
    pointer-events: auto;
    will-change: transform;
}
.${P}-mm-dragging .${P}-ind { cursor: grabbing; }

.${P}-row {
    display: flex;
    align-items: center;
    gap: 8px;
    background: rgba(0,0,0,0.82);
    padding: 7px 10px;
    border-radius: 0 0 6px 6px;
    cursor: default;
}

.${P}-btn {
    background: rgba(255,255,255,0.1);
    border: 1px solid rgba(255,255,255,0.2);
    border-radius: 4px;
    color: #fff;
    width: 26px; height: 26px;
    padding: 0;
    display: flex; align-items: center; justify-content: center;
    cursor: pointer;
    flex-shrink: 0;
    transition: background 0.15s, opacity 0.15s;
}
.${P}-btn:hover:not(:disabled) { background: rgba(255,255,255,0.22); }
.${P}-btn:disabled { opacity: 0.3; cursor: default; pointer-events: none; }
.${P}-btn-inner { display: flex; align-items: center; justify-content: center; }
.${P}-btn svg   { pointer-events: none; display: block; }

.${P}-slider-wrap { flex: 1; position: relative; }

.${P}-slider-track {
    width: 100%;
    height: 4px;
    background: rgba(88,101,242,0.3);
    border-radius: 2px;
    position: relative;
    cursor: ew-resize;
    touch-action: none;
}

.${P}-slider-fill {
    height: 100%;
    background: #5865F2;
    border-radius: 2px;
    pointer-events: none;
}

.${P}-slider-grab {
    position: absolute;
    top: 50%; transform: translate(-50%, -50%);
    width: 12px; height: 12px;
    border-radius: 50%;
    background: #fff;
    border: 2px solid #5865F2;
    box-shadow: 0 0 0 3px rgba(88,101,242,0.25);
    pointer-events: none;
}

.${P}-tooltip {
    position: absolute;
    bottom: calc(100% + 15px);
    transform: translateX(-50%);
    background: #131416;
    color: #fff;
    font-size: 13px;
    letter-spacing: 0.02em;
    padding: 5px 10px;
    border-radius: 5px;
    white-space: nowrap;
    pointer-events: none;
    opacity: 0;
    transition: opacity 0.12s;
    font-family: var(--font-primary, sans-serif);
    box-shadow: 0 2px 10px rgba(0,0,0,0.8);
    z-index: 30;
}
.${P}-tooltip::after {
    content: "";
    position: absolute;
    top: 100%; left: 50%; transform: translateX(-50%);
    border: 6px solid transparent;
    border-top-color: #0d0d0d;
}
.${P}-slider-wrap.${P}-sliding .${P}-slider-track { cursor: grabbing; }
.${P}-slider-wrap.${P}-sliding { cursor: grabbing; }
.${P}-slider-wrap:hover .${P}-tooltip,
.${P}-slider-wrap.${P}-sliding .${P}-tooltip { opacity: 1; }
`;

export default definePlugin({
    name: "CamZoom",
    description: "Scroll-to-zoom & drag-to-pan on webcam tiles. Auto portrait minimap for mobile cameras. Compatible with NoMirroredCamera.",
    authors: [{ name: "zfrancesck1", id: 456195985404592149n }],
    tags: ["Voice", "Media"],
    enabledByDefault: true,
    settings,

    start() {
        const style = document.createElement("style");
        style.id = STYLE_ID;
        style.textContent = CSS;
        document.head.appendChild(style);

        document.addEventListener("wheel", onGlobalWheel, { capture: true, passive: true });
        document.addEventListener("pointerdown", prune, { capture: true, passive: true });
    },

    stop() {
        document.removeEventListener("wheel", onGlobalWheel, true);
        document.removeEventListener("pointerdown", prune, true);
        for (const tile of [...active]) tiles.get(tile)?.kill();
        active.clear();
        document.getElementById(`${P}-cursor-lock`)?.remove();
        document.getElementById(STYLE_ID)?.remove();
    },
});