/*
 * TrashCord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ChatBarButton, ChatBarButtonFactory } from "@api/ChatButtons";
import { Heading } from "@components/Heading";
import { Devs } from "@utils/constants";
import { classNameFactory } from "@utils/css";
import { insertTextIntoChatInputBox } from "@utils/discord";
import { closeModal, ModalCloseButton, ModalContent, ModalFooter, ModalHeader, ModalProps, ModalRoot, openModal } from "@utils/modal";
import definePlugin from "@utils/types";
import { useState } from "@webpack/common";

import managedStyle from "./style.css?managed";

const cl = classNameFactory("vc-tccm-");

const ESC = "\u001b";
const FENCE = "```";

type Mode = "ansi" | "markdown" | "highlight";

interface ColorOption {
    label: string;
    value: number;
    hex: string | null;
}

interface State {
    mode: Mode;
    tf: number;
    aBold: boolean;
    aUnder: boolean;
    rainbow: boolean;
    fg: number;
    bg: number;
    bold: boolean;
    italic: boolean;
    underline: boolean;
    strike: boolean;
    spoiler: boolean;
    code: boolean;
    header: number;
    block: number;
    hl: number;
    quote: boolean;
    caption: boolean;
    capPos: number;
}

interface Highlight {
    label: string;
    lang: string;
    hex: string;
    wrap(line: string): string;
}

const TextColors: ColorOption[] = [
    { label: "Default", value: 0, hex: null },
    { label: "Dark Gray", value: 30, hex: "#4f545c" },
    { label: "Red", value: 31, hex: "#dc322f" },
    { label: "Green", value: 32, hex: "#859900" },
    { label: "Yellow", value: 33, hex: "#b58900" },
    { label: "Blue", value: 34, hex: "#268bd2" },
    { label: "Pink", value: 35, hex: "#d33682" },
    { label: "Cyan", value: 36, hex: "#2aa198" },
    { label: "White", value: 37, hex: "#ffffff" }
];

const BackgroundColors: ColorOption[] = [
    { label: "Default", value: 0, hex: null },
    { label: "Firefly Dark Blue", value: 40, hex: "#002b36" },
    { label: "Orange", value: 41, hex: "#cb4b16" },
    { label: "Marigold", value: 42, hex: "#586e75" },
    { label: "Greyish Turquoise", value: 43, hex: "#657b83" },
    { label: "Gray", value: 44, hex: "#839496" },
    { label: "Indigo", value: 45, hex: "#6c71c4" },
    { label: "Light Gray", value: 46, hex: "#93a1a1" },
    { label: "White", value: 47, hex: "#fdf6e3" }
];

const Highlights: Highlight[] = [
    { label: "Red", lang: "diff", hex: "#e5534b", wrap: l => `- ${l}` },
    { label: "Green", lang: "diff", hex: "#57ab5a", wrap: l => `+ ${l}` },
    { label: "Yellow", lang: "fix", hex: "#c69026", wrap: l => l },
    { label: "Blue", lang: "ini", hex: "#539bf5", wrap: l => `[${l}]` },
    { label: "Orange", lang: "css", hex: "#e0823d", wrap: l => `[${l}]` }
];

const Transforms: { label: string; fn(t: string): string; }[] = [
    { label: "Normal", fn: t => t },
    { label: "S P A C E D", fn: t => t.split("\n").map(l => [...l].join(" ")).join("\n") },
    {
        label: "Ｗｉｄｅ",
        fn: t => [...t].map(c => {
            const k = c.charCodeAt(0);
            if (k === 32) return "\u3000";
            return k > 32 && k < 127 ? String.fromCharCode(k + 0xfee0) : c;
        }).join("")
    }
];

const Modes: Mode[] = ["ansi", "markdown", "highlight"];
const ModeLabels = ["ANSI", "Markdown", "Highlight"];
const HeaderLabels = ["None", "H1", "H2", "H3", "Subtext"];
const HeaderPrefix = ["", "# ", "## ", "### ", "-# "];
const BlockLabels = ["None", "Quote", "Quote all", "Bullet", "Numbered", "Code block"];
const CaptionPosLabels = ["Above", "Below"];
const CaptionBlockLabels = ["None", "Quote", "Bullet", "Numbered"];
const CaptionBlocks = [0, 1, 3, 4];
const RainbowCodes = [31, 33, 32, 36, 34, 35];

const defaults = (): State => ({
    mode: "ansi",
    tf: 0,
    aBold: false,
    aUnder: false,
    rainbow: false,
    fg: 0,
    bg: 0,
    bold: false,
    italic: false,
    underline: false,
    strike: false,
    spoiler: false,
    code: false,
    header: 0,
    block: 0,
    hl: 0,
    quote: false,
    caption: false,
    capPos: 0
});

const saved: State = defaults();

function buildAnsi(text: string, st: State) {
    const safe = text.replace(/```/g, "`\u200b``");
    const base: number[] = [];
    if (st.aBold) base.push(1);
    if (st.aUnder) base.push(4);
    if (st.bg) base.push(st.bg);

    let body: string;

    if (st.rainbow) {
        let i = 0;
        body = "";
        for (const ch of safe) {
            if (ch.trim() === "") body += ch;
            else body += `${ESC}[${[...base, RainbowCodes[i++ % RainbowCodes.length]].join(";")}m${ch}`;
        }
        if (i) body += `${ESC}[0m`;
    } else {
        const codes = st.fg ? [...base, st.fg] : base;
        body = codes.length ? `${ESC}[${codes.join(";")}m${safe}${ESC}[0m` : safe;
    }

    return `${FENCE}ansi\n${body}\n${FENCE}`;
}

function buildHighlight(text: string, index: number) {
    const hl = Highlights[index];
    const body = text
        .replace(/```/g, "`\u200b``")
        .split("\n")
        .filter(l => l.trim())
        .map(hl.wrap)
        .join("\n");
    return `${FENCE}${hl.lang}\n${body}\n${FENCE}`;
}

function buildMarkdown(text: string, st: State, url: string) {
    if (st.block === 5) return `${FENCE}\n${text.replace(/```/g, "`\u200b``")}\n${FENCE}`;

    let n = 0;
    let first = true;
    return text.split("\n").map(line => {
        if (!line.trim()) return "";

        let t = st.code ? `\`${line.replace(/`/g, "'")}\`` : line;
        if (url) t = `[${t}](${url})`;
        if (st.bold) t = `**${t}**`;
        if (st.italic) t = `*${t}*`;
        if (st.underline) t = `__${t}__`;
        if (st.strike) t = `~~${t}~~`;
        if (st.spoiler) t = `||${t}||`;

        let prefix = "";
        if (st.block === 1) prefix = "> ";
        else if (st.block === 2) prefix = first ? ">>> " : "";
        else if (st.block === 3) prefix = "- ";
        else if (st.block === 4) prefix = `${++n}. `;

        first = false;
        return prefix + HeaderPrefix[st.header] + t;
    }).join("\n");
}

function captionState(st: State): State {
    const block = st.block === 2 || st.block === 5 || (st.quote && st.block === 1) ? 0 : st.block;
    return block === st.block ? st : { ...st, block };
}

function build(value: string, cap: string, st: State, url: string) {
    const text = Transforms[st.tf].fn(value);
    let out: string;

    if (st.mode === "markdown") {
        out = buildMarkdown(text, st, url);
    } else {
        out = st.mode === "ansi" ? buildAnsi(text, st) : buildHighlight(text, st.hl);

        if (st.caption && cap.trim()) {
            const c = buildMarkdown(Transforms[st.tf].fn(cap), captionState(st), url);
            out = st.capPos === 0 ? `${c}\n${out}` : `${out}\n${c}`;
        }

        if (st.quote) out = `>>> ${out}`;
    }

    return out;
}

function findHex(list: ColorOption[], value: number) {
    for (const item of list) if (item.value === value) return item.hex;
    return null;
}

function press(fn: () => void) {
    return {
        onClick: fn,
        onKeyDown: (e: { key: string; preventDefault(): void; }) => {
            if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                fn();
            }
        }
    };
}

function Chip({ label, on, onPick }: { label: string; on: boolean; onPick(): void; }) {
    return (
        <div className={cl("chip")} role="checkbox" aria-checked={on} tabIndex={0} data-on={on ? "1" : "0"} {...press(onPick)}>
            {label}
        </div>
    );
}

function Radios({ labels, value, onPick }: { labels: string[]; value: number; onPick(v: number): void; }) {
    return (
        <div className={cl("row")}>
            {labels.map((label, i) => (
                <div key={label} className={cl("chip")} role="radio" aria-checked={i === value} tabIndex={0} data-on={i === value ? "1" : "0"} {...press(() => onPick(i))}>
                    {label}
                </div>
            ))}
        </div>
    );
}

function Swatches({ list, value, onPick }: { list: ColorOption[]; value: number; onPick(v: number): void; }) {
    return (
        <div className={cl("row")}>
            {list.map(c => (
                <div
                    key={c.value}
                    className={cl("sw")}
                    role="radio"
                    aria-checked={c.value === value}
                    aria-label={c.label}
                    title={c.label}
                    tabIndex={0}
                    data-on={c.value === value ? "1" : "0"}
                    style={c.hex ? { background: c.hex } : undefined}
                    {...press(() => onPick(c.value))}
                >
                    {c.hex ? null : "×"}
                </div>
            ))}
        </div>
    );
}

function AnsiPreview({ text, st }: { text: string; st: State; }) {
    const fg = findHex(TextColors, st.fg);
    const bg = findHex(BackgroundColors, st.bg);
    const common = {
        background: bg ?? "transparent",
        fontWeight: st.aBold ? 700 : 400,
        textDecoration: st.aUnder ? "underline" : "none"
    } as const;

    if (st.rainbow) {
        let i = 0;
        return (
            <>
                {[...text.slice(0, 300)].map((ch, idx) => {
                    if (ch.trim() === "") return ch;
                    const hex = findHex(TextColors, RainbowCodes[i++ % RainbowCodes.length]);
                    return <span key={idx} style={{ ...common, color: hex ?? undefined }}>{ch}</span>;
                })}
            </>
        );
    }

    return <span style={{ ...common, color: fg ?? "var(--text-normal)" }}>{text.slice(0, 300)}</span>;
}

function HighlightPreview({ text, st }: { text: string; st: State; }) {
    const hl = Highlights[st.hl];
    return (
        <>
            {text.slice(0, 300).split("\n").filter(l => l.trim()).map((l, i) => (
                <div key={i} style={{ color: hl.hex }}>{hl.wrap(l)}</div>
            ))}
        </>
    );
}

function MarkdownPreview({ text, st, link }: { text: string; st: State; link: boolean; }) {
    const shown = text.slice(0, 300);
    if (st.block === 5) return <>{shown}</>;

    const deco = [st.underline && "underline", st.strike && "line-through"].filter(Boolean).join(" ");
    const sizes = [undefined, 24, 20, 17, 11];
    const quoted = st.block === 1 || st.block === 2;
    let n = 0;

    return (
        <>
            {shown.split("\n").map((line, i) => {
                if (!line.trim()) return <div key={i}>&nbsp;</div>;
                const marker = st.block === 3 ? "• " : st.block === 4 ? `${++n}. ` : "";
                return (
                    <div
                        key={i}
                        style={{
                            borderLeft: quoted ? "4px solid var(--background-modifier-accent)" : undefined,
                            paddingLeft: quoted ? 8 : 0,
                            fontSize: sizes[st.header],
                            fontFamily: "var(--font-primary)",
                            color: st.header === 4 ? "var(--text-muted)" : undefined
                        }}
                    >
                        {marker}
                        <span
                            style={{
                                fontWeight: st.bold || (st.header > 0 && st.header < 4) ? 700 : 400,
                                fontStyle: st.italic ? "italic" : "normal",
                                textDecoration: deco || "none",
                                fontFamily: st.code ? "var(--font-code)" : undefined,
                                background: st.spoiler ? "var(--background-tertiary)" : undefined,
                                color: st.spoiler ? "var(--text-muted)" : link ? "var(--text-link)" : undefined
                            }}
                        >{line}</span>
                    </div>
                );
            })}
        </>
    );
}

function PickerModal({ rootProps, close }: { rootProps: ModalProps, close(): void; }) {
    const [value, setValue] = useState("");
    const [cap, setCap] = useState("");
    const [url, setUrl] = useState("");
    const [st, setSt] = useState<State>({ ...saved });

    const patch = (p: Partial<State>) => {
        Object.assign(saved, p);
        setSt(prev => ({ ...prev, ...p }));
    };

    const reset = () => patch(defaults());

    const md = st.mode === "markdown";
    const capOn = !md && st.caption;
    const showMd = md || capOn;
    const link = url.trim();

    const out = value ? build(value, cap, st, link) : "";

    const insert = () => {
        if (!out) return;
        insertTextIntoChatInputBox(out);
        close();
    };

    const onEnter = (e: { key: string; shiftKey: boolean; preventDefault(): void; }) => {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            insert();
        }
    };

    const shown = Transforms[st.tf].fn(value);
    const capShown = Transforms[st.tf].fn(cap);
    const capSt = captionState(st);
    const showCap = capOn && !!cap.trim();

    const captionPreview = showCap ? <MarkdownPreview text={capShown} st={capSt} link={!!link} /> : null;
    const bodyPreview = !value ? "..." : st.mode === "ansi" ? <AnsiPreview text={shown} st={st} />
        : st.mode === "highlight" ? <HighlightPreview text={shown} st={st} />
            : <MarkdownPreview text={shown} st={st} link={!!link} />;

    const message = (
        <>
            {showCap && st.capPos === 0 && captionPreview}
            {bodyPreview}
            {showCap && st.capPos === 1 && captionPreview}
        </>
    );

    return (
        <ModalRoot {...rootProps}>
            <ModalHeader>
                <Heading tag="h2">
                    Insert Formatted Text
                </Heading>

                <ModalCloseButton onClick={close} />
            </ModalHeader>

            <ModalContent>
                <div className={cl("card")} data-tone="msg">
                    <Heading>Message</Heading>
                    <textarea
                        className={cl("input")}
                        rows={2}
                        value={value}
                        autoFocus
                        spellCheck={false}
                        onChange={e => setValue(e.currentTarget.value)}
                        onKeyDown={onEnter}
                    />
                </div>

                <Heading>Mode</Heading>
                <Radios labels={ModeLabels} value={Modes.indexOf(st.mode)} onPick={i => patch({ mode: Modes[i] })} />

                <Heading>Transform</Heading>
                <Radios labels={Transforms.map(t => t.label)} value={st.tf} onPick={tf => patch({ tf })} />

                {st.mode === "ansi" && (
                    <>
                        <Heading>Format</Heading>
                        <div className={cl("row")}>
                            <Chip label="Bold" on={st.aBold} onPick={() => patch({ aBold: !st.aBold })} />
                            <Chip label="Underline" on={st.aUnder} onPick={() => patch({ aUnder: !st.aUnder })} />
                            <Chip label="Rainbow" on={st.rainbow} onPick={() => patch({ rainbow: !st.rainbow })} />
                        </div>

                        {!st.rainbow && (
                            <>
                                <Heading>Text Color</Heading>
                                <Swatches list={TextColors} value={st.fg} onPick={fg => patch({ fg })} />
                            </>
                        )}

                        <Heading>Background Color</Heading>
                        <Swatches list={BackgroundColors} value={st.bg} onPick={bg => patch({ bg })} />
                    </>
                )}

                {st.mode === "highlight" && (
                    <>
                        <Heading>Color</Heading>
                        <Radios labels={Highlights.map(h => h.label)} value={st.hl} onPick={hl => patch({ hl })} />
                    </>
                )}

                {!md && (
                    <>
                        <Heading>Combine with Markdown</Heading>
                        <div className={cl("row")}>
                            <Chip label="Quote whole message" on={st.quote} onPick={() => patch({ quote: !st.quote })} />
                            <Chip label="Caption" on={st.caption} onPick={() => patch({ caption: !st.caption })} />
                        </div>
                    </>
                )}

                {capOn && (
                    <>
                        <div className={cl("card")} data-tone="msg">
                            <Heading>Caption Text</Heading>
                            <textarea
                                className={cl("input")}
                                rows={1}
                                value={cap}
                                spellCheck={false}
                                onChange={e => setCap(e.currentTarget.value)}
                                onKeyDown={onEnter}
                            />
                        </div>
                        <Radios labels={CaptionPosLabels} value={st.capPos} onPick={capPos => patch({ capPos })} />
                    </>
                )}

                {showMd && (
                    <>
                        <Heading>{md ? "Style" : "Caption Style"}</Heading>
                        <div className={cl("row")}>
                            <Chip label="Bold" on={st.bold} onPick={() => patch({ bold: !st.bold })} />
                            <Chip label="Italic" on={st.italic} onPick={() => patch({ italic: !st.italic })} />
                            <Chip label="Underline" on={st.underline} onPick={() => patch({ underline: !st.underline })} />
                            <Chip label="Strike" on={st.strike} onPick={() => patch({ strike: !st.strike })} />
                            <Chip label="Spoiler" on={st.spoiler} onPick={() => patch({ spoiler: !st.spoiler })} />
                            <Chip label="Inline code" on={st.code} onPick={() => patch({ code: !st.code })} />
                        </div>

                        <Heading>Header</Heading>
                        <Radios labels={HeaderLabels} value={st.header} onPick={header => patch({ header })} />

                        <Heading>Block</Heading>
                        {md
                            ? <Radios labels={BlockLabels} value={st.block} onPick={block => patch({ block })} />
                            : <Radios labels={CaptionBlockLabels} value={Math.max(0, CaptionBlocks.indexOf(st.block))} onPick={i => patch({ block: CaptionBlocks[i] })} />}

                        <Heading>Link (optional)</Heading>
                        <input
                            className={cl("input")}
                            type="text"
                            value={url}
                            placeholder="https://"
                            spellCheck={false}
                            onChange={e => setUrl(e.currentTarget.value)}
                        />
                    </>
                )}

                <div className={cl("card")} data-tone="preview">
                    <Heading>Preview</Heading>
                    <div className={cl("pre")}>
                        {!md && st.quote
                            ? <div style={{ borderLeft: "4px solid var(--background-modifier-accent)", paddingLeft: 8 }}>{message}</div>
                            : message}
                    </div>
                    <div className={cl("count")} data-over={out.length > 2000 ? "1" : "0"}>{out.length} / 2000</div>
                </div>
            </ModalContent>

            <ModalFooter>
                <div className={cl("insert")} role="button" tabIndex={0} aria-disabled={!value} {...press(insert)}>Insert</div>
                <div className={cl("chip")} role="button" tabIndex={0} {...press(reset)}>Reset</div>
            </ModalFooter>
        </ModalRoot>
    );
}

function openPicker() {
    const key = openModal(props => (
        <PickerModal
            rootProps={props}
            close={() => closeModal(key)}
        />
    ));
}

function ColorIcon() {
    return (
        <svg width="24px" height="24px" viewBox="0 0 24 24" version="1.1" aria-hidden>
            <g id="surface1">
                <path fill="currentColor" d="M 7.050781 9.378906 L 14.660156 16.988281 " />
                <path fill="currentColor" d="M 9.78125 17.152344 L 6.816406 20.117188 " />
                <path fill="currentColor" d="M 7.015625 14.375 L 4.046875 17.339844 " />
                <path fill="currentColor" d="M 13.199219 8.207031 L 18.421875 2.386719 C 19.3125 1.496094 20.761719 1.496094 21.652344 2.386719 C 22.546875 3.277344 22.546875 4.726562 21.652344 5.621094 L 15.832031 10.84375 C 15.679688 10.980469 15.585938 11.179688 15.582031 11.386719 C 15.574219 11.59375 15.660156 11.796875 15.804688 11.945312 L 16.679688 12.820312 C 17.265625 13.414062 17.265625 14.371094 16.679688 14.96875 L 9.386719 22.261719 L 1.777344 14.65625 L 9.074219 7.359375 C 9.667969 6.773438 10.625 6.773438 11.21875 7.359375 L 12.097656 8.234375 C 12.242188 8.382812 12.445312 8.464844 12.65625 8.457031 C 12.859375 8.453125 13.058594 8.363281 13.199219 8.207031 Z M 13.199219 8.207031 " />
            </g>
        </svg>
    );
}

const ChatBarRender: ChatBarButtonFactory = ({ isMainChat }) => {
    if (!isMainChat) return null;

    return (
        <ChatBarButton
            tooltip="Insert Formatted Text"
            onClick={openPicker}
            buttonProps={{ "aria-haspopup": "dialog", "aria-label": "Insert formatted text" }}
        >
            <ColorIcon />
        </ChatBarButton>
    );
};

export default definePlugin({
    name: "ColoredMessages",
    description: "Adds a new button to the message bar that allows you to insert colored and formatted messages (ANSI, markdown, highlight blocks)!",
    authors: [Devs.Knocklive, { name: "zfrancesck1", id: 456195985404592149n }],
    tags: ["Chat", "Appearance", "Customisation"],
    enabledByDefault: false,
    managedStyle,

    chatBarButton: { icon: ColorIcon, render: ChatBarRender },
});