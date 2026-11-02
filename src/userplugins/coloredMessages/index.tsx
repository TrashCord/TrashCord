/*
 * TrashCord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { addChatBarButton, removeChatBarButton } from "@api/ChatButtons";
import { Heading } from "@components/Heading";
import { Devs } from "@utils/constants";
import { insertTextIntoChatInputBox } from "@utils/discord";
import { closeModal, ModalCloseButton, ModalContent, ModalFooter, ModalHeader, ModalProps, ModalRoot, openModal } from "@utils/modal";
import definePlugin from "@utils/types";
import { Tooltip, useState } from "@webpack/common";

const ESC = "\u001b";
const FENCE = "```";
const STYLE_ID = "tccm-style";

type Mode = "ansi" | "markdown" | "highlight";

interface ColorOption {
    label: string;
    value: number;
    hex: string | null;
}

interface State {
    mode: Mode;
    tf: number;
    bold: boolean;
    italic: boolean;
    underline: boolean;
    strike: boolean;
    spoiler: boolean;
    code: boolean;
    rainbow: boolean;
    fg: number;
    bg: number;
    header: number;
    block: number;
    hl: number;
    divStyle: number;
    divPos: number;
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
    { label: "UPPER", fn: t => t.toUpperCase() },
    { label: "lower", fn: t => t.toLowerCase() },
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
const DividerLabels = ["None", "Line", "Thick", "Dots", "Stars"];
const Dividers = ["", "──────────────", "▬▬▬▬▬▬▬▬▬▬▬▬▬▬", "• • • • • • • • • • •", "✦ ✦ ✦ ✦ ✦ ✦ ✦"];
const DividerPosLabels = ["Above", "Below", "Both"];
const RainbowCodes = [31, 33, 32, 36, 34, 35];

const defaults = (): State => ({
    mode: "ansi",
    tf: 0,
    bold: false,
    italic: false,
    underline: false,
    strike: false,
    spoiler: false,
    code: false,
    rainbow: false,
    fg: 0,
    bg: 0,
    header: 0,
    block: 0,
    hl: 0,
    divStyle: 0,
    divPos: 2
});

const saved: State = defaults();

const s = (c: string) => `html:root body .${c}.${c}`;

const CSS = [
    `${s("tccm-btn")}{display:flex!important;align-items:center;justify-content:center;flex:0 0 auto;width:32px;height:32px;cursor:pointer;color:var(--interactive-normal);visibility:visible!important;opacity:1!important;pointer-events:auto!important}`,
    `${s("tccm-btn")}:hover{color:var(--interactive-hover)}`,
    `${s("tccm-row")}{display:flex!important;flex-wrap:wrap;gap:6px;margin:4px 0 14px}`,
    `${s("tccm-sw")}{display:flex!important;align-items:center;justify-content:center;width:26px;height:26px;box-sizing:border-box;border-radius:4px;border:2px solid transparent;cursor:pointer;color:var(--text-normal);font-size:14px;line-height:1;background:var(--background-tertiary)}`,
    `${s("tccm-sw")}[data-on="1"]{border-color:var(--text-normal)}`,
    `${s("tccm-chip")}{display:flex!important;align-items:center;padding:6px 12px;border-radius:4px;cursor:pointer;color:var(--text-normal);background:var(--background-modifier-hover);user-select:none}`,
    `${s("tccm-chip")}[data-on="1"]{background:var(--brand-500);color:#fff}`,
    `${s("tccm-input")}{box-sizing:border-box;width:100%;padding:8px 10px;margin:4px 0 14px;border-radius:4px;color:var(--text-normal);font-size:16px;font-family:inherit;line-height:1.3;resize:none;appearance:none!important;background:var(--background-secondary)!important;border:1px solid var(--background-tertiary)!important}`,
    `${s("tccm-insert")}{display:flex!important;align-items:center;padding:8px 22px;border-radius:4px;cursor:pointer;font-weight:600;color:#fff;background:var(--brand-500);user-select:none}`,
    `${s("tccm-insert")}[aria-disabled="true"]{opacity:.5;cursor:not-allowed}`,
    `${s("tccm-pre")}{margin:4px 0 0;padding:10px;min-height:20px;border-radius:4px;white-space:pre-wrap;word-break:break-word;background:var(--background-secondary);border:1px solid var(--background-tertiary);font-family:var(--font-code);color:var(--text-normal)}`,
    `${s("tccm-count")}{font-size:12px;text-align:right;margin-top:4px;color:var(--text-muted)}`,
    `${s("tccm-count")}[data-over="1"]{color:var(--status-danger)}`
].join("");

function buildAnsi(text: string, st: State) {
    const safe = text.replace(/```/g, "`\u200b``");
    const base: number[] = [];
    if (st.bold) base.push(1);
    if (st.underline) base.push(4);
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
    return text.split("\n").map((line, i) => {
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
        else if (st.block === 2) prefix = i === 0 ? ">>> " : "";
        else if (st.block === 3) prefix = "- ";
        else if (st.block === 4) prefix = `${++n}. `;

        return prefix + HeaderPrefix[st.header] + t;
    }).join("\n");
}

function build(value: string, st: State, url: string) {
    const text = Transforms[st.tf].fn(value);
    const out = st.mode === "ansi" ? buildAnsi(text, st)
        : st.mode === "highlight" ? buildHighlight(text, st.hl)
            : buildMarkdown(text, st, url);

    const d = Dividers[st.divStyle];
    if (!d) return out;
    return (st.divPos !== 1 ? `${d}\n` : "") + out + (st.divPos !== 0 ? `\n${d}` : "");
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
        <div className="tccm-chip" role="checkbox" aria-checked={on} tabIndex={0} data-on={on ? "1" : "0"} {...press(onPick)}>
            {label}
        </div>
    );
}

function Radios({ labels, value, onPick }: { labels: string[]; value: number; onPick(v: number): void; }) {
    return (
        <div className="tccm-row">
            {labels.map((label, i) => (
                <div key={label} className="tccm-chip" role="radio" aria-checked={i === value} tabIndex={0} data-on={i === value ? "1" : "0"} {...press(() => onPick(i))}>
                    {label}
                </div>
            ))}
        </div>
    );
}

function Swatches({ list, value, onPick }: { list: ColorOption[]; value: number; onPick(v: number): void; }) {
    return (
        <div className="tccm-row">
            {list.map(c => (
                <div
                    key={c.value}
                    className="tccm-sw"
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
        fontWeight: st.bold ? 700 : 400,
        textDecoration: st.underline ? "underline" : "none"
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
    const [url, setUrl] = useState("");
    const [st, setSt] = useState<State>({ ...saved });

    const patch = (p: Partial<State>) => {
        Object.assign(saved, p);
        setSt(prev => ({ ...prev, ...p }));
    };

    const reset = () => patch(defaults());

    const out = value ? build(value, st, st.mode === "markdown" ? url.trim() : "") : "";

    const insert = () => {
        if (!out) return;
        insertTextIntoChatInputBox(out);
        close();
    };

    const shown = Transforms[st.tf].fn(value);
    const md = st.mode === "markdown";

    return (
        <ModalRoot {...rootProps}>
            <ModalHeader>
                <Heading tag="h2">
                    Insert Formatted Text
                </Heading>

                <ModalCloseButton onClick={close} />
            </ModalHeader>

            <ModalContent>
                <Heading>Text</Heading>
                <textarea
                    className="tccm-input"
                    rows={2}
                    value={value}
                    autoFocus
                    spellCheck={false}
                    onChange={e => setValue(e.currentTarget.value)}
                    onKeyDown={e => {
                        if (e.key === "Enter" && !e.shiftKey) {
                            e.preventDefault();
                            insert();
                        }
                    }}
                />

                <Heading>Mode</Heading>
                <Radios labels={ModeLabels} value={Modes.indexOf(st.mode)} onPick={i => patch({ mode: Modes[i] })} />

                <Heading>Transform</Heading>
                <Radios labels={Transforms.map(t => t.label)} value={st.tf} onPick={tf => patch({ tf })} />

                {st.mode === "ansi" && (
                    <>
                        <Heading>Format</Heading>
                        <div className="tccm-row">
                            <Chip label="Bold" on={st.bold} onPick={() => patch({ bold: !st.bold })} />
                            <Chip label="Underline" on={st.underline} onPick={() => patch({ underline: !st.underline })} />
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

                {md && (
                    <>
                        <Heading>Style</Heading>
                        <div className="tccm-row">
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
                        <Radios labels={BlockLabels} value={st.block} onPick={block => patch({ block })} />

                        <Heading>Link (optional)</Heading>
                        <input
                            className="tccm-input"
                            type="text"
                            value={url}
                            placeholder="https://"
                            spellCheck={false}
                            onChange={e => setUrl(e.currentTarget.value)}
                        />
                    </>
                )}

                {st.mode === "highlight" && (
                    <>
                        <Heading>Color</Heading>
                        <Radios labels={Highlights.map(h => h.label)} value={st.hl} onPick={hl => patch({ hl })} />
                    </>
                )}

                <Heading>Divider</Heading>
                <Radios labels={DividerLabels} value={st.divStyle} onPick={divStyle => patch({ divStyle })} />
                {st.divStyle > 0 && <Radios labels={DividerPosLabels} value={st.divPos} onPick={divPos => patch({ divPos })} />}

                <Heading>Preview</Heading>
                <div className="tccm-pre">
                    {st.divStyle > 0 && st.divPos !== 1 && <div>{Dividers[st.divStyle]}</div>}
                    {!value ? "..." : st.mode === "ansi" ? <AnsiPreview text={shown} st={st} />
                        : st.mode === "highlight" ? <HighlightPreview text={shown} st={st} />
                            : <MarkdownPreview text={shown} st={st} link={!!url.trim()} />}
                    {st.divStyle > 0 && st.divPos !== 0 && <div>{Dividers[st.divStyle]}</div>}
                </div>
                <div className="tccm-count" data-over={out.length > 2000 ? "1" : "0"}>{out.length} / 2000</div>
            </ModalContent>

            <ModalFooter>
                <div className="tccm-insert" role="button" tabIndex={0} aria-disabled={!value} {...press(insert)}>Insert</div>
                <div className="tccm-chip" role="button" tabIndex={0} {...press(reset)}>Reset</div>
            </ModalFooter>
        </ModalRoot>
    );
}

const ChatBarIcon = ({ isMainChat }: { isMainChat: boolean; }) => {
    if (!isMainChat) return null;

    const open = () => {
        const key = openModal(props => (
            <PickerModal
                rootProps={props}
                close={() => closeModal(key)}
            />
        ));
    };

    return (
        <Tooltip text="Insert Formatted Text">
            {tip => (
                <div
                    {...tip}
                    className="tccm-btn"
                    role="button"
                    aria-label="Insert Formatted Text"
                    aria-haspopup="dialog"
                    tabIndex={0}
                    {...press(open)}
                >
                    <svg width="24px" height="24px" viewBox="0 0 24 24" version="1.1">
                        <g id="surface1">
                            <path fill="currentColor" d="M 7.050781 9.378906 L 14.660156 16.988281 " />
                            <path fill="currentColor" d="M 9.78125 17.152344 L 6.816406 20.117188 " />
                            <path fill="currentColor" d="M 7.015625 14.375 L 4.046875 17.339844 " />
                            <path fill="currentColor" d="M 13.199219 8.207031 L 18.421875 2.386719 C 19.3125 1.496094 20.761719 1.496094 21.652344 2.386719 C 22.546875 3.277344 22.546875 4.726562 21.652344 5.621094 L 15.832031 10.84375 C 15.679688 10.980469 15.585938 11.179688 15.582031 11.386719 C 15.574219 11.59375 15.660156 11.796875 15.804688 11.945312 L 16.679688 12.820312 C 17.265625 13.414062 17.265625 14.371094 16.679688 14.96875 L 9.386719 22.261719 L 1.777344 14.65625 L 9.074219 7.359375 C 9.667969 6.773438 10.625 6.773438 11.21875 7.359375 L 12.097656 8.234375 C 12.242188 8.382812 12.445312 8.464844 12.65625 8.457031 C 12.859375 8.453125 13.058594 8.363281 13.199219 8.207031 Z M 13.199219 8.207031 " />
                        </g>
                    </svg>
                </div>
            )}
        </Tooltip>
    );
};

export default definePlugin({
    name: "ColoredMessages",
    description: "Adds a new button to the message bar that allows you to insert colored and formatted messages (ANSI, markdown, highlight blocks)!",
    authors: [Devs.Knocklive, { name: "zfrancesck1", id: 456195985404592149n }],
    tags: ["Chat", "Appearance", "Customisation"],
    enabledByDefault: false,
    dependencies: ["ChatInputButtonAPI"],

    start() {
        if (!document.getElementById(STYLE_ID)) {
            const el = document.createElement("style");
            el.id = STYLE_ID;
            el.textContent = CSS;
            document.head.append(el);
        }
        addChatBarButton("ColoredMessages", ChatBarIcon);
    },

    stop() {
        removeChatBarButton("ColoredMessages");
        document.getElementById(STYLE_ID)?.remove();
    },
});