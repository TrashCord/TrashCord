import {
    SelectedChannelStore,
    useEffect,
    useState,
    useStateFromStores
} from "@webpack/common";

import type { RecordingStatusSnapshot } from "../session/RecordingSession";
import { sessionStore, type SessionState } from "../stores/sessionStore";
import { formatDuration } from "../utils";
import { openRecordingInfoModal } from "./RecordingInfoModal";

function RecordIcon({ recording, color }: { recording: boolean; color: string }) {
    return (
        <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="12" cy="12" r="6" fill={recording ? color : "none"} stroke={color} strokeWidth="2" />
        </svg>
    );
}

export interface RecordingPanelButtonProps {
    nameplate?: any;
}

export interface RecordingButtonHooks {
    start: (channelId: string) => void;
    stop: () => void;
    promote: () => void;
    getStatus: () => RecordingStatusSnapshot | null;
}

let hooks: RecordingButtonHooks | null = null;
export function registerRecordingButtonHooks(h: RecordingButtonHooks) { hooks = h; }

function useSessionState(): SessionState {
    const [state, setState] = useState<SessionState>(() => sessionStore.get());
    useEffect(() => sessionStore.subscribe(setState), []);
    return state;
}

const BTN_STYLE = {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: 32,
    height: 32,
    padding: 0,
    margin: "0 2px",
    background: "transparent",
    border: "none",
    borderRadius: 4,
    cursor: "pointer",
    color: "var(--interactive-normal, #b9bbbe)",
    // Flex parent (account panel) has limited space; keep button compact.
    flex: "0 0 auto"
} as const;

export function RecordingPanelButton(_props: RecordingPanelButtonProps) {
    const state = useSessionState();

    const voiceChannelId = useStateFromStores(
        [SelectedChannelStore],
        () => (SelectedChannelStore as any).getVoiceChannelId?.() ?? null
    ) as string | null;

    const recording = state.state === "recording";
    const conditional = state.state === "recording" && state.conditional;
    const inVC = !!voiceChannelId;
    const disabled = !recording && !inVC;

    const now = useTick(recording);
    const elapsedMs = recording && state.state === "recording" ? now - state.startedAt : 0;

    const RED = "var(--status-danger)";
    const YELLOW = "var(--status-warning, #faa61a)";
    const MUTED = "var(--interactive-muted)";
    const color = disabled ? MUTED : recording ? (conditional ? YELLOW : RED) : RED;

    let tooltip: string;
    if (conditional) tooltip = `Auto-recording (${formatDuration(elapsedMs)}) — click to make permanent · right-click for details`;
    else if (recording) tooltip = `Stop recording (${formatDuration(elapsedMs)}) · right-click for details`;
    else if (inVC) tooltip = "Start recording this call · right-click for details";
    else tooltip = "Join a voice channel to record · right-click for details";

    const onClick = () => {
        if (!hooks) return;
        if (conditional) hooks.promote();
        else if (recording) hooks.stop();
        else if (inVC && voiceChannelId) hooks.start(voiceChannelId);
    };

    const onContextMenu = (e: any) => {
        e.preventDefault();
        if (hooks) openRecordingInfoModal(hooks);
    };

    return (
        <button
            type="button"
            onClick={onClick}
            onContextMenu={onContextMenu}
            aria-label={tooltip}
            title={tooltip}
            aria-disabled={disabled}
            style={{
                ...BTN_STYLE,
                cursor: disabled ? "default" : "pointer",
                opacity: disabled ? 0.5 : 1,
                boxShadow: recording ? `0 0 8px ${color}` : "none"
            }}
        >
            <RecordIcon recording={recording} color={color} />
        </button>
    );
}

function useTick(active: boolean): number {
    const [ts, setTs] = useState(() => Date.now());
    useEffect(() => {
        if (!active) return;
        const id = setInterval(() => setTs(Date.now()), 1000);
        return () => clearInterval(id);
    }, [active]);
    return ts;
}
