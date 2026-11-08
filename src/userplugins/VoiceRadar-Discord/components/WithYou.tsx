/*
 * TrashCord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { useEffect, UserStore, useState } from "@webpack/common";

import { channelLabel, getChannelInfo, getMyChannelId, getPeopleWithMe, voiceStateForUser } from "../channels";
import { T } from "../i18n";
import { DEFAULT_AVATAR_URL, getAvatarUrl, getStoredName, getUserDisplayName } from "../names";
import { getPresenceInfo } from "../presence";
import { getTrackedUser } from "../store";
import { disconnectFromVoice, isLocallyMuted, toggleLocalMute, toggleServerDeaf, toggleServerMute, type VoiceRights, voiceRightsIn, watchLocalMutes } from "../voiceControls";
import { ActionButton, cl, StatusDot } from "./common";
import { CameraIcon, DeafIcon, LeaveIcon, MicOffIcon, SpeakerOffIcon, StreamIcon } from "./icons";
import { AutoJoinButton, MagnetButton, NotifyButton, PinButton } from "./PersonButtons";
import { personActions, SpeakingAvatar } from "./VoicePeople";

const STATE_ICON_SIZE = 16;

function VoiceIcons({ userId }: { userId: string; }) {
    const state = voiceStateForUser(userId);
    const deaf = state?.selfDeaf || state?.deaf;
    const muted = state?.selfMute || state?.mute;

    return (
        <span className={cl("with-you-state")}>
            {state?.selfStream && <StreamIcon size={STATE_ICON_SIZE} className={cl("state-icon")} />}
            {state?.selfVideo && <CameraIcon size={STATE_ICON_SIZE} className={cl("state-icon")} />}
            {deaf
                ? <DeafIcon size={STATE_ICON_SIZE} className={cl("state-icon")} />
                : muted && <MicOffIcon size={STATE_ICON_SIZE} className={cl("state-icon")} />}
        </span>
    );
}

function VoiceButtons({ userId, rights }: { userId: string; rights: VoiceRights; }) {
    const [mutedForMe, setMutedForMe] = useState(() => isLocallyMuted(userId));
    const state = voiceStateForUser(userId);

    useEffect(() => {
        const update = () => setMutedForMe(isLocallyMuted(userId));
        update();
        return watchLocalMutes(update);
    }, [userId]);

    return (
        <span className={cl("with-you-group")}>
            <ActionButton
                icon={<SpeakerOffIcon />}
                tooltip={mutedForMe ? T.withYouUnmuteForMe : T.withYouMuteForMe}
                onClick={() => toggleLocalMute(userId)}
                active={mutedForMe}
                danger
            />
            {rights.mute && (
                <ActionButton
                    icon={<MicOffIcon />}
                    tooltip={state?.mute ? T.withYouServerUnmute : T.withYouServerMute}
                    onClick={() => void toggleServerMute(userId)}
                    active={!!state?.mute}
                    danger
                />
            )}
            {rights.deafen && (
                <ActionButton
                    icon={<DeafIcon />}
                    tooltip={state?.deaf ? T.withYouServerUndeafen : T.withYouServerDeafen}
                    onClick={() => void toggleServerDeaf(userId)}
                    active={!!state?.deaf}
                    danger
                />
            )}
            {rights.disconnect && (
                <ActionButton
                    icon={<LeaveIcon />}
                    tooltip={T.withYouDisconnect}
                    onClick={() => void disconnectFromVoice(userId)}
                    danger
                />
            )}
        </span>
    );
}

function Person({ userId, rights }: { userId: string; rights: VoiceRights; }) {
    const presence = getPresenceInfo(userId);
    const name = getUserDisplayName(userId);
    const tracked = getTrackedUser(userId);
    const buttonProps = { userId, storedName: tracked?.name ?? getStoredName(userId), tracked };

    return (
        <div {...personActions(userId)} className={cl("with-you-person")}>
            <span className={cl("avatar-wrap")}>
                <SpeakingAvatar userId={userId} src={getAvatarUrl(userId) ?? DEFAULT_AVATAR_URL} alt={name} />
                <StatusDot status={presence.status} mobile={presence.isMobile} known={presence.known} />
            </span>
            <span className={cl("with-you-text")}>
                <span className={cl("with-you-line")}>
                    <span className={cl("with-you-name")}>{name}</span>
                    <VoiceIcons userId={userId} />
                </span>
                {presence.activity && <span className={cl("with-you-activity")}>{presence.activity}</span>}
            </span>
            <span className={cl("with-you-buttons")}>
                <VoiceButtons userId={userId} rights={rights} />
                <span className={cl("with-you-group")}>
                    <MagnetButton {...buttonProps} />
                    <PinButton {...buttonProps} />
                    <NotifyButton {...buttonProps} />
                    <AutoJoinButton {...buttonProps} />
                </span>
            </span>
        </div>
    );
}

/** Everybody in your channel beside the list, so the list itself can stay as it is. */
export function WithYou() {
    const people = getPeopleWithMe(UserStore.getCurrentUser()?.id);
    const channelId = getMyChannelId();
    if (!channelId || !people.length) return null;

    const rights = voiceRightsIn(channelId);

    return (
        <aside className={cl("with-you")}>
            <div className={cl("with-you-title")}>{T.withYouTitle(people.length)}</div>
            <div className={cl("with-you-people")}>
                {people.map(userId => <Person key={userId} userId={userId} rights={rights} />)}
            </div>
            <div className={cl("with-you-place")}>{channelLabel(getChannelInfo(channelId))}</div>
        </aside>
    );
}
