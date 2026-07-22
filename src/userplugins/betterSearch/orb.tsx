/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Scanning orb: a tiny radar-sweep WebGL shader borrowed from the
// thinking-animations "echo" variant, rendered grayscale to match the
// grey/white/black style used elsewhere (see RS automated livechat v2).
//
// One orb = one WebGL context. That's wasteful at large counts, but
// BetterSearch shows at most one orb at a time so it's the simplest
// self-contained component we can write. Animation stops when unmounted.
//
// Lazy-ref safety: React/useRef/useEffect are lazy webpack bindings from
// @webpack/common, so we never touch them at module top level. Everything
// runs inside the component body or inside the effect callback.

import { useEffect, useRef } from "@webpack/common";

const VS = `
attribute vec2 a_position;
void main() { gl_Position = vec4(a_position, 0.0, 1.0); }
`;

const FS = `
precision highp float;
uniform float u_time;
uniform float u_seed;
uniform vec2  u_resolution;
const float TWO_PI = 6.28318530718;
const float PI     = 3.14159265359;

float hash(float x, float y, float seed) {
    float n = sin(x * 127.1 + y * 311.7 + seed * 113.3) * 43758.5453;
    return fract(n);
}

vec3 hsl2rgb(float h, float s, float l) {
    h = mod(h, 360.0) / 360.0;
    float c = (1.0 - abs(2.0 * l - 1.0)) * s;
    float x = c * (1.0 - abs(mod(h * 6.0, 2.0) - 1.0));
    float m = l - c / 2.0;
    vec3 rgb;
    float hue6 = h * 6.0;
    if (hue6 < 1.0) rgb = vec3(c, x, 0.0);
    else if (hue6 < 2.0) rgb = vec3(x, c, 0.0);
    else if (hue6 < 3.0) rgb = vec3(0.0, c, x);
    else if (hue6 < 4.0) rgb = vec3(0.0, x, c);
    else if (hue6 < 5.0) rgb = vec3(x, 0.0, c);
    else rgb = vec3(c, 0.0, x);
    return rgb + m;
}

void main() {
    vec2 fragCoord = vec2(gl_FragCoord.x, u_resolution.y - gl_FragCoord.y);
    float gridN = 12.0;
    float cellSizePx = u_resolution.x / gridN;
    vec2 cellCoord = floor(fragCoord / cellSizePx);
    float x = cellCoord.x, y = cellCoord.y;
    float nx = (x + 0.5) / gridN, ny = (y + 0.5) / gridN;
    float t = u_time;

    vec2 p = vec2(nx, ny) - 0.5;
    float r = length(p);
    float angle = atan(p.y, p.x);

    float sweepAngle = mod(t * 1.35 + u_seed * 0.5, TWO_PI) - PI;
    float ad = mod(angle - sweepAngle + PI * 3.0, TWO_PI) - PI;

    float sweep = 0.0;
    if (ad <= 0.05 && ad > -PI * 0.85) {
        sweep = exp(ad * 2.2);
    }
    float leading = exp(-abs(ad) * 30.0) * 0.7;

    float ringPhase = fract(r * 2.2 - t * 0.5 + u_seed * 0.2);
    float ring = pow(1.0 - abs(ringPhase - 0.5) * 2.0, 10.0) * 0.18;

    float targetHash = hash(x * 1.7, y * 2.3, u_seed);
    float target = 0.0;
    if (targetHash > 0.76) {
        float cAngle = atan((ny - 0.5) + 0.0001, (nx - 0.5) + 0.0001);
        float cad = mod(cAngle - sweepAngle + PI * 3.0, TWO_PI) - PI;
        if (cad <= 0.0 && cad > -1.8) {
            target = exp(cad * 1.6) * 0.85;
        }
        float fH = hash(x, y, floor(t * 18.0));
        target *= 0.7 + 0.3 * (fH > 0.5 ? 1.0 : 0.0);
    }

    float centerDot = exp(-r * r * 140.0) * 0.55;

    float cross = 0.0;
    if (abs(nx - 0.5) < 0.03 || abs(ny - 0.5) < 0.03) cross = 0.09;

    float outer = smoothstep(0.46, 0.44, r) * smoothstep(0.40, 0.42, r) * 0.18;

    float stH = hash(x, y, floor(t * 6.0));
    float noise = stH > 0.90 ? 0.08 : 0.0;

    float bright = 0.07 + sweep * 0.45 + leading + ring + target + centerDot + cross + outer + noise * sweep;
    bright = clamp(bright, 0.05, 0.95);

    // Source palette hue; the CSS grayscale filter on the wrapper will
    // desaturate this to grey/white/black.
    float hue = 40.0 + target * 25.0 + leading * 10.0;
    vec3 col = hsl2rgb(hue, 0.88, bright);
    gl_FragColor = vec4(col, 1.0);
}
`;

interface ScanningOrbProps {
    size?: number;
}

export function ScanningOrb({ size = 14 }: ScanningOrbProps) {
    const canvasRef = useRef<HTMLCanvasElement | null>(null);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        // Over-sample the render surface so the 12x12 radar grid is crisp
        // even when the CSS box is only 14px.
        const dpr = window.devicePixelRatio || 1;
        const pxSize = Math.max(96, Math.round(size * dpr * 6));
        canvas.width = pxSize;
        canvas.height = pxSize;

        const gl = canvas.getContext("webgl", {
            antialias: false,
            alpha: false,
            preserveDrawingBuffer: false,
        });
        if (!gl) return;

        const compile = (type: number, src: string): WebGLShader | null => {
            const sh = gl.createShader(type);
            if (!sh) return null;
            gl.shaderSource(sh, src);
            gl.compileShader(sh);
            if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
                console.error("[BetterSearch orb] shader compile:", gl.getShaderInfoLog(sh));
                gl.deleteShader(sh);
                return null;
            }
            return sh;
        };

        const vs = compile(gl.VERTEX_SHADER, VS);
        const fs = compile(gl.FRAGMENT_SHADER, FS);
        if (!vs || !fs) return;

        const prog = gl.createProgram();
        if (!prog) return;
        gl.attachShader(prog, vs);
        gl.attachShader(prog, fs);
        gl.linkProgram(prog);
        if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
            console.error("[BetterSearch orb] link:", gl.getProgramInfoLog(prog));
            return;
        }

        const buf = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buf);
        gl.bufferData(
            gl.ARRAY_BUFFER,
            new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
            gl.STATIC_DRAW,
        );

        const locPos = gl.getAttribLocation(prog, "a_position");
        const uTime = gl.getUniformLocation(prog, "u_time");
        const uSeed = gl.getUniformLocation(prog, "u_seed");
        const uRes = gl.getUniformLocation(prog, "u_resolution");

        gl.useProgram(prog);
        gl.enableVertexAttribArray(locPos);
        gl.vertexAttribPointer(locPos, 2, gl.FLOAT, false, 0, 0);
        gl.viewport(0, 0, pxSize, pxSize);
        gl.uniform2f(uRes, pxSize, pxSize);
        gl.uniform1f(uSeed, 2);

        let rafId = 0;
        let startTs = 0;
        const animate = !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
        const frame = (ts: number) => {
            if (!startTs) startTs = ts;
            gl.uniform1f(uTime, (ts - startTs) / 1000);
            gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
            if (animate) rafId = requestAnimationFrame(frame);
        };
        if (animate) rafId = requestAnimationFrame(frame);
        else frame(performance.now());

        return () => {
            if (rafId) cancelAnimationFrame(rafId);
            try {
                gl.deleteProgram(prog);
                gl.deleteShader(vs);
                gl.deleteShader(fs);
                gl.deleteBuffer(buf);
                const lose = gl.getExtension("WEBGL_lose_context");
                lose?.loseContext();
            } catch { /* teardown is best-effort */ }
        };
    }, [size]);

    return (
        <span
            className="vc-bettersearch-orb"
            style={{ width: size, height: size }}
            aria-hidden="true"
        >
            <canvas ref={canvasRef} />
        </span>
    );
}
