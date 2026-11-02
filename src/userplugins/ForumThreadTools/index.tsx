/*
 * TrashCord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import definePlugin from "@utils/types";
import { ChannelStore, GuildMemberStore, React, UserStore } from "@webpack/common";

type SortMode = "native" | "newest" | "oldest" | "active";
type StatusMode = "all" | "open" | "locked";

interface ThreadFilters {
    sort: SortMode;
    status: StatusMode;
    author: string;
    query: string;
    tags: string[];
    tagMode: "or" | "and";
}

interface Suggestion {
    value: string;
    count: number;
}

const DEFAULT_FILTERS: ThreadFilters = { sort: "native", status: "all", author: "", query: "", tags: [], tagMode: "or" };
const SORTS: [SortMode, string][] = [["native", "Default"], ["newest", "Newest"], ["oldest", "Oldest"], ["active", "Recently active"]];

let state: ThreadFilters = DEFAULT_FILTERS;
let countsVersion = 0;
let loadMore: (() => void) | null = null;

const listeners = new Set<() => void>();
const countListeners = new Set<() => void>();
const counts = { raw: [0, 0, 0], shown: [0, 0, 0] };

const getState = () => state;
const getVersion = () => countsVersion;

function setLoader(fn: any) {
    loadMore = typeof fn === "function" ? fn : null;
    return fn;
}

function setFilters(changes: Partial<ThreadFilters>) {
    const next = { ...state, ...changes };
    if ((Object.keys(next) as (keyof ThreadFilters)[]).every(k => next[k] === state[k])) return;
    state = next;
    listeners.forEach(l => l());
}

function subscribe(listener: () => void) {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
}

function subscribeCounts(listener: () => void) {
    countListeners.add(listener);
    return () => { countListeners.delete(listener); };
}

function useFilters(): ThreadFilters {
    return (React as any).useSyncExternalStore(subscribe, getState);
}

function snowflakeTime(id?: string | null): number {
    if (!id) return 0;
    try {
        return Number((BigInt(id) >> 22n) + 1420070400000n);
    } catch {
        return 0;
    }
}

function isDefaultFilters(f: ThreadFilters) {
    return f.sort === "native" && f.status === "all" && !f.author.trim() && !f.query.trim() && !f.tags.length;
}

function makePredicate(f: ThreadFilters) {
    const q = f.query.trim().toLowerCase();
    const a = f.author.trim().toLowerCase();
    const me = a === "me" || a === "@me" ? UserStore.getCurrentUser()?.id : null;
    const all = f.tagMode === "and";

    return (id: string): boolean => {
        const t: any = ChannelStore.getChannel(id);
        if (!t) return false;

        if (f.status !== "all" && (t.threadMetadata?.locked === true) !== (f.status === "locked")) return false;
        if (q && !String(t.name ?? "").toLowerCase().includes(q)) return false;

        if (f.tags.length) {
            const applied: string[] = t.appliedTags ?? [];
            if (!(all ? f.tags.every(x => applied.includes(x)) : f.tags.some(x => applied.includes(x)))) return false;
        }

        if (a) {
            const owner = String(t.ownerId ?? t.owner_id ?? "");
            if (!owner) return false;
            if (me) return owner === me;
            if (!owner.includes(a)) {
                const u: any = UserStore.getUser(owner);
                const gid = String(t.guild_id ?? t.guildId ?? "");
                const m: any = gid ? (GuildMemberStore as any).getMember?.(gid, owner) : null;
                if (![u?.username, u?.globalName, m?.nick].some(v => String(v ?? "").toLowerCase().includes(a))) return false;
            }
        }

        return true;
    };
}

function processList(list: any[], f: ThreadFilters): any[] {
    if (isDefaultFilters(f)) return list;

    const ok = makePredicate(f);
    const out = list.filter(id => typeof id !== "string" || ok(id));
    if (f.sort === "native") return out;

    const keyed = out.map(id => {
        const c: any = typeof id === "string" ? ChannelStore.getChannel(id) : null;
        return {
            id,
            pin: ((c?.flags ?? 0) & 2) !== 0,
            time: snowflakeTime(f.sort === "active" ? c?.lastMessageId ?? id : id)
        };
    });

    const dir = f.sort === "oldest" ? 1 : -1;
    keyed.sort((x, y) => x.pin !== y.pin ? (x.pin ? -1 : 1) : (x.time - y.time) * dir);
    return keyed.map(k => k.id);
}

function useFiltered(list: any, slot: number) {
    const f = useFilters();
    const out: any = React.useMemo(() => Array.isArray(list) ? processList(list, f) : list, [list, f]);
    const rawLen = Array.isArray(list) ? list.length : -1;
    const shownLen = Array.isArray(out) ? out.length : -1;

    React.useEffect(() => {
        if (rawLen < 0) return;
        if (counts.raw[slot] === rawLen && counts.shown[slot] === shownLen) return;
        counts.raw[slot] = rawLen;
        counts.shown[slot] = shownLen;
        countsVersion++;
        countListeners.forEach(l => l());
    }, [rawLen, shownLen, slot]);

    return out;
}

function getSuggestions(channelId: string, kind: "author" | "title", query: string): Suggestion[] {
    const term = query.trim().toLowerCase();
    if (term.length < 2) return [];

    const threads: any[] = (ChannelStore as any).getAllThreadsForParent?.(channelId) ?? [];
    const entries = new Map<string, number>();

    for (const thread of threads) {
        if (!thread) continue;

        let value: string;
        if (kind === "title") {
            value = String(thread.name ?? "").trim();
        } else {
            const id = String(thread.ownerId ?? "");
            const user: any = id ? UserStore.getUser(id) : null;
            value = String(user?.username ?? user?.globalName ?? id).trim();
        }
        if (!value) continue;

        const key = value.toLowerCase();
        if (key.includes(term)) entries.set(key, (entries.get(key) ?? 0) + 1);
    }

    return [...entries.entries()]
        .sort((a, b) => {
            const aStarts = a[0].startsWith(term);
            const bStarts = b[0].startsWith(term);
            if (aStarts !== bStarts) return aStarts ? -1 : 1;
            return b[1] - a[1] || a[0].localeCompare(b[0]);
        })
        .slice(0, 5)
        .map(([value, count]) => ({ value, count }));
}

const CSS = `
.ftt-root{position:sticky;top:0;z-index:20;max-height:60vh;overflow-y:auto;background:var(--background-base-lowest,#121214);border:1px solid rgba(255,255,255,.08);border-radius:16px;margin:8px 0 14px;color:#f2f3f5}
.ftt-head{display:flex;align-items:center;gap:10px;padding:12px 16px;cursor:pointer;user-select:none}
.ftt-head:hover{background:rgba(255,255,255,.04)}
.ftt-title{font-weight:700;font-size:15px}
.ftt-badge{background:#5865f2;color:#fff;border-radius:10px;padding:1px 8px;font-size:12px;font-weight:700}
.ftt-summary{margin-left:auto;display:inline-flex;align-items:center;color:#b5bac1;font-size:13px;font-variant-numeric:tabular-nums}
.ftt-summary.busy{color:#dbdee1}
.ftt-dot{width:7px;height:7px;border-radius:50%;background:#5865f2;margin-right:7px}
.ftt-chev{display:flex;color:#b5bac1}
.ftt-chev.closed{transform:rotate(-90deg)}
.ftt-progress{height:2px;background:linear-gradient(90deg,transparent,#5865f2,transparent)}
.ftt-body{padding:4px 16px 16px;display:flex;flex-direction:column;gap:12px}
.ftt-row{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.ftt-label{display:flex;align-items:center;gap:6px;color:#b5bac1;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.03em;min-width:64px}
.ftt-input{flex:1 1 200px;display:flex;align-items:center;gap:8px;background:rgba(0,0,0,.35);border:1px solid rgba(255,255,255,.08);border-radius:10px;padding:0 10px;height:38px;color:#b5bac1}
.ftt-input:focus-within{border-color:#5865f2;color:#fff;background:rgba(0,0,0,.5)}
.ftt-input input{flex:1;min-width:0;background:transparent;border:none;outline:none;color:#f2f3f5;font-size:14px;height:100%}
.ftt-input input::placeholder{color:#80848e}
.ftt-x{display:flex;color:#b5bac1;cursor:pointer;border-radius:50%;padding:3px}
.ftt-x:hover{background:rgba(255,255,255,.12);color:#fff}
.ftt-btn{display:inline-flex;align-items:center;gap:6px;background:rgba(255,255,255,.07);color:#f2f3f5;border:1px solid rgba(255,255,255,.06);border-radius:999px;padding:5px 13px;font-size:14px;font-weight:500;cursor:pointer;white-space:nowrap;user-select:none}
.ftt-btn:hover{background:rgba(255,255,255,.14)}
.ftt-btn.on,.ftt-btn.primary{background:#5865f2;border-color:#5865f2;color:#fff}
.ftt-btn.on:hover,.ftt-btn.primary:hover{background:#4752c4}
.ftt-btn.danger:hover{background:rgba(218,55,60,.85)}
.ftt-tagimg{width:16px;height:16px;border-radius:3px;object-fit:contain}
.ftt-autocomplete{flex:0 1 240px;width:240px;min-width:180px;max-width:240px;box-sizing:border-box;display:flex;flex-direction:column}
.ftt-autocomplete>.ftt-input{flex:none;width:100%;box-sizing:border-box}
.ftt-suggestions{width:100%;box-sizing:border-box;max-height:132px;overflow-y:auto;overscroll-behavior:contain;margin-top:4px;padding:2px 0;border-top:1px solid rgba(255,255,255,.08);scrollbar-width:thin}
.ftt-suggestion{display:flex;align-items:center;justify-content:space-between;gap:8px;width:100%;padding:4px 8px;border-radius:5px;color:#b5bac1;cursor:pointer;font-size:12px;line-height:16px;box-sizing:border-box}
.ftt-suggestion.active{background:rgba(255,255,255,.07);color:#fff}
.ftt-suggestion-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ftt-suggestion-count{flex-shrink:0;color:#80848e;font-size:10px}
`;

function Icon({ children, size = 16 }: { children: React.ReactNode; size?: number; }) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
            {children}
        </svg>
    );
}

const SearchIcon = () => <Icon><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></Icon>;
const UserIcon = () => <Icon><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4 4-6 8-6s8 2 8 6" /></Icon>;
const TagIcon = () => <Icon><path d="M20.6 13.4l-7.2 7.2a2 2 0 01-2.8 0L3 13V3h10l7.6 7.6a2 2 0 010 2.8z" /><circle cx="7.5" cy="7.5" r="1.2" /></Icon>;
const SortIcon = () => <Icon><path d="M7 4v16M7 20l-3-3M7 20l3-3M17 20V4M17 4l-3 3M17 4l3 3" /></Icon>;
const LockIcon = () => <Icon><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 018 0v4" /></Icon>;
const UnlockIcon = () => <Icon><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 017.5-2" /></Icon>;
const XIcon = () => <Icon size={14}><path d="M6 6l12 12M18 6L6 18" /></Icon>;
const ChevIcon = () => <Icon size={18}><path d="M6 9l6 6 6-6" /></Icon>;
const FilterIcon = () => <Icon size={18}><path d="M3 5h18l-7 8v6l-4 2v-8z" /></Icon>;
const DownloadIcon = () => <Icon><path d="M12 3v12M7 10l5 5 5-5M5 21h14" /></Icon>;
const LoaderIcon = () => <Icon><path d="M21 12a9 9 0 11-6.2-8.6" /></Icon>;

function press(onClick: () => void) {
    return (e: React.KeyboardEvent) => {
        if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onClick();
        }
    };
}

function Btn({ active, onClick, className = "", children }: { active?: boolean; onClick: () => void; className?: string; children: React.ReactNode; }) {
    return (
        <div role="button" tabIndex={0} className={"ftt-btn " + (active ? "on " : "") + className} onClick={onClick} onKeyDown={press(onClick)}>
            {children}
        </div>
    );
}

function Field({ icon, value, placeholder, label, channelId, kind, raw, onChange }: {
    icon: React.ReactNode;
    value: string;
    placeholder: string;
    label: string;
    channelId: string;
    kind: "author" | "title";
    raw: number;
    onChange: (v: string) => void;
}) {
    const [open, setOpen] = React.useState(false);
    const [active, setActive] = React.useState(0);

    const choose = (item: Suggestion) => {
        onChange(item.value);
        setOpen(false);
        setActive(0);
    };

    const suggestions = React.useMemo(() => open ? getSuggestions(channelId, kind, value) : [], [open, channelId, kind, value, raw]);
    const visible = open && suggestions.length > 0 && !(suggestions.length === 1 && suggestions[0].value === value.trim().toLowerCase());

    const onKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === "ArrowDown" && suggestions.length) {
            e.preventDefault();
            setOpen(true);
            setActive(n => (n + 1) % suggestions.length);
        } else if (e.key === "ArrowUp" && suggestions.length) {
            e.preventDefault();
            setOpen(true);
            setActive(n => (n - 1 + suggestions.length) % suggestions.length);
        } else if (e.key === "Enter" && visible) {
            e.preventDefault();
            choose(suggestions[active] ?? suggestions[0]);
        } else if (e.key === "Escape") {
            setOpen(false);
        }
    };

    return (
        <div className="ftt-autocomplete" onMouseLeave={() => setOpen(false)}>
            <label className="ftt-input">
                {icon}
                <input
                    aria-label={label}
                    aria-autocomplete="list"
                    aria-expanded={visible}
                    placeholder={placeholder}
                    value={value}
                    onFocus={() => setOpen(true)}
                    onChange={e => {
                        onChange(e.currentTarget.value);
                        setActive(0);
                        setOpen(true);
                    }}
                    onKeyDown={onKeyDown}
                />
                {value && (
                    <div role="button" tabIndex={0} className="ftt-x" aria-label="Clear"
                        onClick={() => onChange("")}
                        onKeyDown={press(() => onChange(""))}>
                        <XIcon />
                    </div>
                )}
            </label>

            {visible && (
                <div className="ftt-suggestions" role="listbox">
                    {suggestions.map((item, index) => (
                        <div
                            role="option"
                            aria-selected={index === active}
                            className={"ftt-suggestion" + (index === active ? " active" : "")}
                            key={item.value}
                            onMouseEnter={() => setActive(index)}
                            onClick={() => choose(item)}
                        >
                            <span className="ftt-suggestion-name">{item.value}</span>
                            <span className="ftt-suggestion-count">{item.count}</span>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

function ToolbarBody({ channelId }: { channelId: string; }) {
    const f = useFilters();
    (React as any).useSyncExternalStore(subscribeCounts, getVersion);

    const [open, setOpen] = React.useState(false);
    const [loading, setLoading] = React.useState(false);
    const [done, setDone] = React.useState(false);

    const channel: any = ChannelStore.getChannel(channelId);
    const availableTags: any[] = channel?.availableTags ?? [];
    const raw = counts.raw[0] + counts.raw[1];
    const shown = counts.shown[0] + counts.shown[1];

    React.useEffect(() => {
        if (!loading) return;
        if (!loadMore) {
            setLoading(false);
            return;
        }

        const timer = setTimeout(() => {
            setDone(true);
            setLoading(false);
        }, 2500);

        try {
            loadMore();
        } catch {
            clearTimeout(timer);
            setLoading(false);
        }

        return () => clearTimeout(timer);
    }, [loading, raw]);

    const activeCount =
        (f.query.trim() ? 1 : 0) + (f.author.trim() ? 1 : 0) + f.tags.length +
        (f.sort !== "native" ? 1 : 0) + (f.status !== "all" ? 1 : 0);

    const toggleTag = (id: string) => setFilters({
        tags: f.tags.includes(id) ? f.tags.filter(t => t !== id) : [...f.tags, id]
    });

    return (
        <div className="ftt-root">
            <style>{CSS}</style>

            <div className="ftt-head" onClick={() => setOpen(!open)}>
                <FilterIcon />
                <span className="ftt-title">Thread tools</span>
                {activeCount > 0 && <span className="ftt-badge">{activeCount}</span>}
                <span className={"ftt-summary" + (loading ? " busy" : "")}>
                    {loading && <span className="ftt-dot" />}
                    {loading ? "Loading · " : done ? "✓ All loaded · " : ""}
                    {shown === raw ? `${raw} loaded` : `${shown} matching · ${raw} loaded`}
                </span>
                <span className={"ftt-chev" + (open ? "" : " closed")}><ChevIcon /></span>
            </div>

            {loading && <div className="ftt-progress" />}

            {open && (
                <div className="ftt-body">
                    <div className="ftt-row">
                        <Field icon={<SearchIcon />} label="Search thread titles" placeholder="Search titles" value={f.query} channelId={channelId} kind="title" raw={raw} onChange={v => setFilters({ query: v })} />
                        <Field icon={<UserIcon />} label="Filter by author" placeholder="Author name or user ID" value={f.author} channelId={channelId} kind="author" raw={raw} onChange={v => setFilters({ author: v })} />
                    </div>

                    <div className="ftt-row">
                        <span className="ftt-label"><SortIcon /> Sort</span>
                        {SORTS.map(([mode, text]) => (
                            <Btn key={mode} active={f.sort === mode} onClick={() => setFilters({ sort: mode })}>{text}</Btn>
                        ))}
                    </div>

                    <div className="ftt-row">
                        <span className="ftt-label"><LockIcon /> Status</span>
                        <Btn active={f.status === "all"} onClick={() => setFilters({ status: "all" })}>All</Btn>
                        <Btn active={f.status === "open"} onClick={() => setFilters({ status: "open" })}><UnlockIcon /> Unlocked</Btn>
                        <Btn active={f.status === "locked"} onClick={() => setFilters({ status: "locked" })}><LockIcon /> Locked</Btn>
                    </div>

                    {availableTags.length > 0 && (
                        <div className="ftt-row">
                            <span className="ftt-label"><TagIcon /> Tags</span>
                            {availableTags.map(tag => (
                                <Btn key={tag.id} active={f.tags.includes(tag.id)} onClick={() => toggleTag(tag.id)}>
                                    {tag.emojiId
                                        ? <img className="ftt-tagimg" src={`https://cdn.discordapp.com/emojis/${tag.emojiId}.webp?size=32`} alt="" />
                                        : tag.emojiName ? <span>{tag.emojiName}</span> : null}
                                    {tag.name}
                                </Btn>
                            ))}
                            <span className="ftt-label" style={{ minWidth: 0, marginLeft: 8 }}>Match</span>
                            <Btn active={f.tagMode === "or"} onClick={() => setFilters({ tagMode: "or" })}>Any</Btn>
                            <Btn active={f.tagMode === "and"} onClick={() => setFilters({ tagMode: "and" })}>All</Btn>
                        </div>
                    )}

                    <div className="ftt-row">
                        <Btn className="primary" onClick={() => { setDone(false); setLoading(!loading); }}>
                            {loading ? <><LoaderIcon /> Stop loading</> : <><DownloadIcon /> Load all posts</>}
                        </Btn>
                        <Btn className="danger" onClick={() => setFilters(DEFAULT_FILTERS)}><XIcon /> Clear all</Btn>
                    </div>
                </div>
            )}
        </div>
    );
}

function Toolbar({ channelId }: { channelId: string; }) {
    return <ToolbarBody key={channelId} channelId={channelId} />;
}

export default definePlugin({
    name: "ForumThreadTools",
    description: "Local sorting, author filtering, tag filtering, status filtering and title search for forum channels.",
    authors: [{ name: "Bakhishov", id: 386421496463097857n }, { name: "zfrancesck1", id: 456195985404592149n }],
    tags: ["Servers", "Organisation", "Utility"],
    enabledByDefault: false,
    patches: [
        {
            find: "threadIdsBySection",
            replacement: [
                {
                    match: /(\i)=(\i)\.useMemo\((\(\)=>\{if\(\i\)if\(!\i&&\i\)return\[1,0\];[\s\S]+?\},\[\i,\i,(\i)\.length,(\i)\.length,\i,\i,\i,(\i),\i,\i,\i,\i,\i\])\),(\i)=\2\.useMemo\((\(\)=>!\i&&\i\?\[\[\],\[\]\]:[\s\S]+?\])\),/,
                    replace: "vcFJ=$self.useFiltered($4,0),vcFB=$self.useFiltered($5,1),vcFE=$self.useFiltered($6,2),$1=(($4,$5,$6)=>$2.useMemo($3))(vcFJ,vcFB,vcFE),$7=(($4,$5,$6)=>$2.useMemo($8))(vcFJ,vcFB,vcFE),"
                },
                {
                    match: /children:(!\i)&&\(0,(\i)\.jsx\)\((\i),\{channel:(\i),hasAnyThread:(\i),hasActiveThreads:(\i)\},\4\.id\)/,
                    replace: "children:(0,$2.jsxs)($2.Fragment,{children:[(0,$2.jsx)($self.Toolbar,{channelId:$4.id}),$1&&(0,$2.jsx)($3,{channel:$4,hasAnyThread:$5,hasActiveThreads:$6},$4.id)]})"
                }
            ]
        },
        {
            find: "threadIdsBySection",
            replacement: {
                match: /(&&(\i)\(\)\},\[\i,\i,\i\.guild_id,\i\.id,\i,\2\]\)),/,
                replace: "$1,vcLoadMore=$self.setLoader($2),"
            }
        }
    ],

    useFiltered,
    setLoader,
    Toolbar
});