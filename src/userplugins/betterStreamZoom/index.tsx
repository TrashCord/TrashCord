/*
 * TrashCord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { NavContextMenuPatchCallback } from "@api/ContextMenu";
import { definePluginSettings } from "@api/Settings";
import definePlugin, { OptionType } from "@utils/types";
import { Stream } from "@vencord/discord-types";
import { Menu, useEffect, useState } from "@webpack/common";
import type { CSSProperties, RefObject } from "react";

interface Point {
    x: number;
    y: number;
}

interface Size {
    width: number;
    height: number;
}

const CROP_OPTIONS = [
    { label: "Off", value: 0 },
    { label: "16:9", value: 16 / 9 },
    { label: "21:9", value: 21 / 9 },
    { label: "4:3", value: 4 / 3 }
];

const settings = definePluginSettings({
    fillOnZoom: {
        type: OptionType.BOOLEAN,
        description: "Skip the zoom levels where black bars are still visible",
        default: false
    },
    crops: {
        type: OptionType.CUSTOM,
        default: {} as Record<string, number>
    }
});

// Size of something with the given aspect ratio inside a w*h box, like object-fit: contain
function fitSize(w: number, h: number, aspect: number): Size {
    return w / h > aspect
        ? { width: h * aspect, height: h }
        : { width: w, height: w / aspect };
}

function setCrop(userId: string, crop: number) {
    const { [userId]: _, ...crops } = settings.store.crops;
    if (crop) crops[userId] = crop;
    settings.store.crops = crops;
}

const streamContextPatch: NavContextMenuPatchCallback = (children, { stream }: { stream?: Stream; }) => {
    if (!stream) return;

    const current = settings.store.crops[stream.ownerId] ?? 0;

    children.push(
        <Menu.MenuItem id="vc-stream-crop" label="Crop Stream">
            {CROP_OPTIONS.map(({ label, value }) => (
                <Menu.MenuRadioItem
                    key={label}
                    id={"vc-stream-crop-" + label}
                    group="vc-stream-crop"
                    label={label}
                    checked={current === value}
                    action={() => setCrop(stream.ownerId, value)}
                />
            ))}
        </Menu.MenuItem>
    );
};

export default definePlugin({
    name: "BetterStreamZoom",
    description: "Crop streams to a different aspect ratio (e.g. a 16:9 video streamed from an ultrawide monitor) and make zoom fill your screen",
    authors: [{ name: "hexlux", id: 544511948956368927n }],
    tags: ["Media", "Voice", "Utility"],
    enabledByDefault: false,
    settings,
    contextMenus: {
        "stream-context": streamContextPatch
    },

    patches: [
        {
            // Focused stream layout, sizes the tile to the aspect ratio of the video
            find: "REMEASURE_TARGET),onRest:",
            replacement: [
                {
                    match: /(?<=(\i)\.type===\i\.\i\.ACTIVITY.{0,400}?;)(?=let \i=\i\.useMemo\(\(\)=>)/,
                    replace: "let vcCrop=$self.useCrop($1.id);"
                },
                {
                    match: /(\i)\.width\/\1\.height:(\i),\[/,
                    replace: "vcCrop||$1.width/$1.height:$2,[vcCrop,"
                }
            ]
        },
        {
            // Zoom state provider
            find: ".VIDEO_STREAM_ZOOM_CHANGED,{",
            replacement: [
                {
                    match: /(?<=streamKey:(\i).{0,200}?\[(\i),\i\]=\i\.useState\(16\/9\))/,
                    replace: ",vcCrop=$self.useCrop($1),vcContentAspect=vcCrop||$2"
                },
                {
                    // Pan limits are based on the container size, so you can pan into the black bars
                    match: /(\i)=(\i)\*\((\i)-1\)\/2,(\i)=(\i)\*\(\3-1\)\/2(.{0,120}?\},\[\i)\]/,
                    replace: "[$1,$4]=$self.getPanLimits($2,$5,$3,vcContentAspect)$6,vcContentAspect]"
                },
                {
                    match: /(?<=(\i)\.current\.clientWidth.{0,250}?let (\i)=)\(0,\i\.clamp\)\(\i,(\i),\i\)(?=;if\(null==\i\|\|\2===(\i)\))/,
                    replace: "$self.adjustZoom($&,$4,$3,$1.current,vcContentAspect)"
                },
                {
                    match: /(?<=\(\)=>\(\{)(?=enabled:!0,)(.{0,400}?clampPanOffset:\i\}\),\[)/,
                    replace: "vcCrop,$1vcCrop,"
                }
            ]
        },
        {
            // Zoomable video wrapper
            find: '"--custom-zoom-scale":',
            replacement: [
                {
                    match: /(?<=\{)(?=enabled:\i,minZoom:\i,isDragging:)/,
                    replace: "vcCrop,videoAspectRatio:vcAspect,"
                },
                {
                    match: /(?<=wrapperRef:(\i).{0,80}?\}=\i\.useContext\(\i\.\i\),)/,
                    replace: "vcSize=$self.useElementSize($1),"
                },
                {
                    match: /return(\{"--custom-zoom-scale":.{0,200}?"transform [^"]+"\})\},\[([^\]]+)\]/,
                    replace: "return $self.getWrapperStyle($1,vcSize,vcAspect,vcCrop)},[$2,vcSize,vcAspect,vcCrop]"
                },
                {
                    match: /(?<=\("div",\{ref:\i,)(?=className:)/,
                    replace: 'style:vcCrop?{overflow:"hidden"}:void 0,'
                }
            ]
        },
        {
            // Viewport rectangle on the minimap
            find: "--custom-zoom-indicator-left",
            replacement: [
                {
                    match: /(?=videoAspectRatio:)/,
                    replace: "vcCrop,videoAspectRatio:vcAspect,"
                },
                {
                    match: /(\i)=1\/(\i),(\i)=1\/\2,(\i)=\.5-(\i)\.x\/\((\i)\*\2\),(\i)=\.5-\5\.y\/\((\i)\*\2\)/,
                    replace: "[$1,$3,$4,$7]=$self.getIndicator($6,$8,$2,$5,vcAspect,vcCrop)"
                },
                {
                    match: /(?<=height 0\.1s ease-out"\}\},\[[^\]]*)\]/,
                    replace: ",vcAspect,vcCrop]"
                }
            ]
        }
    ],

    // Stream keys look like "guild:<guildId>:<channelId>:<userId>" or "call:<channelId>:<userId>"
    useCrop(streamKey: string | undefined): number | undefined {
        const { crops } = settings.use(["crops"]);
        if (!streamKey?.includes(":")) return;

        return crops[streamKey.split(":").at(-1)!];
    },

    useElementSize(ref: RefObject<HTMLElement | null>) {
        const [size, setSize] = useState<Size | null>(null);

        useEffect(() => {
            const el = ref.current;
            if (!el) return;

            const measure = () => setSize({ width: el.clientWidth, height: el.clientHeight });
            measure();

            const observer = new ResizeObserver(measure);
            observer.observe(el);
            return () => observer.disconnect();
        }, [ref]);

        return size;
    },

    getPanLimits(w: number, h: number, zoom: number, aspect: number) {
        const content = fitSize(w, h, aspect);
        return [
            Math.max(0, (content.width * zoom - w) / 2),
            Math.max(0, (content.height * zoom - h) / 2)
        ];
    },

    adjustZoom(next: number, current: number, min: number, wrapper: HTMLElement | null, aspect: number) {
        if (!settings.store.fillOnZoom || wrapper == null || next <= min) return next;

        const { clientWidth: w, clientHeight: h } = wrapper;
        const content = fitSize(w, h, aspect);
        const fill = Math.max(w / content.width, h / content.height);

        if (next >= fill) return next;
        return next > current ? fill : min;
    },

    getWrapperStyle(style: CSSProperties, size: Size | null, aspect: number, crop: number | undefined): CSSProperties {
        if (!crop || !size?.width || !size.height) return style;

        // Scale the video so the cropped part fills the space it would get as a standalone video
        const video = fitSize(size.width, size.height, aspect);
        const region = fitSize(video.width, video.height, crop);
        const box = fitSize(size.width, size.height, crop);

        return {
            ...style,
            "--custom-zoom-scale": style["--custom-zoom-scale"] * (box.width / region.width),
            transform: "translate(var(--custom-pan-x), var(--custom-pan-y)) scale(var(--custom-zoom-scale))"
        } as CSSProperties;
    },

    getIndicator(w: number, h: number, zoom: number, pan: Point, aspect: number, crop: number | undefined) {
        const content = fitSize(w, h, crop || aspect);
        const width = content.width * zoom;
        const height = content.height * zoom;

        let rect = [
            Math.min(1, w / width),
            Math.min(1, h / height),
            0.5 - pan.x / width,
            0.5 - pan.y / height
        ];

        if (crop) {
            // The minimap shows the whole stream, the rectangle is relative to the cropped part
            const video = fitSize(w, h, aspect);
            const region = fitSize(video.width, video.height, crop);
            const sx = region.width / video.width;
            const sy = region.height / video.height;
            rect = [rect[0] * sx, rect[1] * sy, 0.5 + (rect[2] - 0.5) * sx, 0.5 + (rect[3] - 0.5) * sy];
        }

        return rect;
    }
});
