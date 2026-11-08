/*
 * TrashCord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { React, useEffect, useRef, useState } from "@webpack/common";
import type { ReactNode } from "react";

import { clearCustomSound, customSoundName, playCustomSound, saveCustomSound, type SaveProblem, subscribeToCustomSound } from "./customSound";
import { T } from "./i18n";
import { previewJoinAlert } from "./joinAlert";
import { getJoinSoundVolume } from "./settings";
import { toast, ToastVariant } from "./toast";

/** React is filled in after plugins load, so it is read on each call. */
const h = (type: any, props?: any, ...children: any[]) => React.createElement(type, props, ...children);

const PROBLEM_TEXT: Record<SaveProblem, () => string> = {
    "too-big": () => T.customSoundTooBig,
    "not-audio": () => T.customSoundNotAudio,
    failed: () => T.customSoundFailed
};

function SettingRow({ title, hint, children }: { title: string; hint: string; children?: ReactNode; }) {
    return h("div", { className: "vr-setting" },
        h("div", { className: "vr-setting-title" }, title),
        h("div", { className: "vr-setting-hint" }, hint),
        h("div", { className: "vr-setting-controls" }, children)
    );
}

function button(label: string, onClick: () => void) {
    return h("button", { type: "button", className: "vr-chip", onClick }, label);
}

function CustomSoundPicker() {
    const [, setTick] = useState(0);
    const input = useRef<HTMLInputElement | null>(null);

    useEffect(() => subscribeToCustomSound(() => setTick(tick => tick + 1)), []);

    const onFile = async (file: File | undefined) => {
        if (!file) return;

        const problem = await saveCustomSound(file);
        if (problem) {
            toast(PROBLEM_TEXT[problem](), ToastVariant.FAILURE);
            return;
        }

        playCustomSound(getJoinSoundVolume());
    };

    const onRemove = async () => {
        await clearCustomSound();
    };

    const name = customSoundName();

    return h(SettingRow, { title: T.customSoundTitle, hint: T.customSoundHint },
        h("span", { className: name ? "vr-setting-file" : "vr-setting-file vr-setting-file-empty", title: name ?? undefined }, name ?? T.customSoundNone),
        button(T.customSoundPick, () => input.current?.click()),
        name && button(T.customSoundRemove, () => void onRemove()),
        h("input", {
            ref: input,
            type: "file",
            accept: "audio/*,.mp3,.ogg,.opus,.wav,.m4a,.aac,.flac,.webm",
            hidden: true,
            onChange: (event: any) => {
                void onFile(event.currentTarget.files?.[0]);
                event.currentTarget.value = "";
            }
        })
    );
}

function JoinTest() {
    return h(SettingRow, { title: T.joinTestTitle, hint: T.joinTestHint },
        button(T.joinTestButton, previewJoinAlert)
    );
}

export function renderCustomSoundPicker() {
    return h(CustomSoundPicker);
}

export function renderJoinTest() {
    return h(JoinTest);
}
