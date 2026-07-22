import { ModalContent, ModalFooter, ModalHeader, ModalRoot, ModalSize, openModal } from "@utils/modal";
import { Button, SelectedChannelStore, Text, useEffect, useState } from "@webpack/common";

import type { RecordingStatusSnapshot } from "../session/RecordingSession";
import { settings } from "../settings";
import { parseCsvIds } from "../stores/whitelistStore";
import { sessionStore, type SessionState } from "../stores/sessionStore";
import { formatDuration } from "../utils";
import type { RecordingButtonHooks } from "./RecordingButton";
import { describeStopCondition, joinNames, formatCaptureFps } from "./statusText";

function Row({ label, value }: { label: string; value: string }) {
    return (
        <div style={{ display: "flex", justifyContent: "space-between", gap: 16, padding: "3px 0" }}>
            <Text variant="text-sm/semibold" style={{ color: "var(--header-secondary)" }}>{label}</Text>
            <Text variant="text-sm/normal" style={{ textAlign: "right", wordBreak: "break-word" }}>{value}</Text>
        </div>
    );
}

function RecordingInfoModal({ modalProps, hooks }: { modalProps: any; hooks: RecordingButtonHooks }) {
    const [state, setState] = useState<SessionState>(() => sessionStore.get());
    useEffect(() => sessionStore.subscribe(setState), []);

    const [status, setStatus] = useState<RecordingStatusSnapshot | null>(() => hooks.getStatus());
    const [, setTick] = useState(0);
    useEffect(() => {
        const id = setInterval(() => { setStatus(hooks.getStatus()); setTick(t => t + 1); }, 1000);
        return () => clearInterval(id);
    }, []);

    const recording = state.state === "recording";
    const inVoice = !!(SelectedChannelStore as any).getVoiceChannelId?.();

    return (
        <ModalRoot {...modalProps} size={ModalSize.SMALL}>
            <ModalHeader>
                <Text variant="heading-lg/semibold">Stream Archiver</Text>
            </ModalHeader>
            <ModalContent>
                <div style={{ padding: "12px 0" }}>
                    {recording && status ? (
                        <>
                            <Text variant="text-md/semibold" style={{ marginBottom: 8 }}>
                                {status.conditional ? "🟡 Auto-recording" : "🔴 Recording"}
                            </Text>
                            {status.conditionNames.length > 0 && (
                                <Text variant="text-md/semibold" style={{ marginBottom: 6, color: "var(--status-warning, #faa61a)" }}>
                                    {`Recording because of: ${joinNames(status.conditionNames)}`}
                                </Text>
                            )}
                            <Text variant="text-sm/normal" style={{ marginBottom: 12, color: "var(--text-muted)" }}>
                                {describeStopCondition({
                                    trigger: status.trigger,
                                    continueAfterStreamEnds: status.continueAfterStreamEnds,
                                    conditionNames: status.conditionNames,
                                    channelName: status.channelName,
                                    absenceTimeoutSeconds: Number(settings.store.absenceTimeoutSeconds ?? 0)
                                })}
                            </Text>
                            <Row label="Channel" value={status.channelName} />
                            <Row label="Elapsed" value={formatDuration(Date.now() - status.startedAt)} />
                            <Row label="Participants" value={String(status.participantCount)} />
                            <Row label="Active streams" value={String(status.activeStreamCount)} />
                            <Row label="Chat" value={status.chatBaked ? `baked · ${status.chatMessagesLogged} logged` : `${status.chatMessagesLogged} logged`} />
                            <Row label="Audio" value={status.audioMode} />
                            <Row label="Capture FPS" value={formatCaptureFps(status)} />
                            <Row label="Folder" value={status.outputDir || "(OS default)"} />
                        </>
                    ) : (
                        <>
                            <Text variant="text-md/semibold" style={{ marginBottom: 8 }}>⚪ Not recording</Text>
                            <Row label="In a voice channel" value={inVoice ? "yes" : "no"} />
                            <Row label="Auto-record on join" value={settings.store.autoRecordOnJoin ? "on" : "off"} />
                            <Row label="Auto-record when you stream" value={settings.store.autoRecordOnSelfStream ? "on" : "off"} />
                            <Row label="Flagged streamers" value={String(parseCsvIds(settings.store.autoRecordStreamerUsers).length)} />
                        </>
                    )}
                </div>
            </ModalContent>
            <ModalFooter>
                {recording && status?.conditional && (
                    <Button color={Button.Colors.GREEN} onClick={() => hooks.promote()}>Make permanent</Button>
                )}
                {recording && (
                    <Button color={Button.Colors.RED} onClick={() => hooks.stop()}>Stop</Button>
                )}
                {!recording && inVoice && (
                    <Button color={Button.Colors.BRAND} onClick={() => {
                        const cid = (SelectedChannelStore as any).getVoiceChannelId?.();
                        if (cid) hooks.start(cid);
                    }}>Start</Button>
                )}
            </ModalFooter>
        </ModalRoot>
    );
}

export function openRecordingInfoModal(hooks: RecordingButtonHooks): void {
    openModal(modalProps => <RecordingInfoModal modalProps={modalProps} hooks={hooks} />);
}
