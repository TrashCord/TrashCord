/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

<<<<<<< HEAD
import { RenderInfoEntry } from "@song-spotlight/api/handlers";
=======
>>>>>>> 89b0fd2a5 (Update index.tsx)
import { useEffect, useMemo, useState } from "@webpack/common";
import { JSX, RefObject } from "react";

interface ProgressCircleProps extends SvgProps {
    border: number;
    audioRef: RefObject<HTMLAudioElement | undefined>;
<<<<<<< HEAD
    playingRef: RefObject<RenderInfoEntry | undefined>;
}
type SvgProps = JSX.IntrinsicElements["svg"];

const SIZE = 50;

export default function ProgressCircle({ border, audioRef, playingRef, ...props }: ProgressCircleProps) {
    const { radius, stroke, circumference } = useMemo(() => {
        const radius = SIZE - border * 2;
=======
}
type SvgProps = JSX.IntrinsicElements["svg"];

export default function ProgressCircle({ border, audioRef, ...props }: ProgressCircleProps) {
    const { radius, stroke, circumference } = useMemo(() => {
        const radius = 50 - border * 2;
>>>>>>> 89b0fd2a5 (Update index.tsx)
        return {
            radius,
            stroke: border * 2,
            circumference: Math.PI * 2 * radius,
        };
    }, [border]);
    const [progress, setProgress] = useState(0);

    useEffect(() => {
        let handle = requestAnimationFrame(function update() {
<<<<<<< HEAD
            const audio = audioRef.current, playing = playingRef.current?.audio;
            if (audio && playing && !Number.isNaN(audio.duration) && !audio.paused) {
                let start = 0, slice = audio.duration;
                if (playing.previewStart !== undefined && playing.previewSlice) {
                    start = playing.previewStart / 1000;
                    slice = playing.previewSlice / 1000;
                }
                setProgress(Math.min(Math.max((audio.currentTime - start) / slice, 0), 1));
=======
            const audio = audioRef.current;
            if (audio && !Number.isNaN(audio.duration) && !audio.paused) {
                setProgress(audio.currentTime / audio.duration);
>>>>>>> 89b0fd2a5 (Update index.tsx)
            } else {
                setProgress(0);
            }

            handle = requestAnimationFrame(update);
        });

        return () => cancelAnimationFrame(handle);
    }, [audioRef]);

    return (
        <svg
            {...props}
<<<<<<< HEAD
            viewBox={`0 0 ${SIZE * 2} ${SIZE * 2}`}
        >
            <circle
                cx={SIZE}
                cy={SIZE}
=======
            viewBox="0 0 100 100"
        >
            <circle
                cx={50}
                cy={50}
>>>>>>> 89b0fd2a5 (Update index.tsx)
                r={radius}
                fill="none"
                stroke="currentColor"
                strokeWidth={stroke}
                strokeDasharray={circumference}
                strokeDashoffset={circumference * (1 - progress)}
                strokeLinecap="round"
<<<<<<< HEAD
                transform={`rotate(-90 ${SIZE} ${SIZE})`}
=======
                transform="rotate(-90 50 50)"
>>>>>>> 89b0fd2a5 (Update index.tsx)
                data-empty={progress === 0}
            />
        </svg>
    );
}
