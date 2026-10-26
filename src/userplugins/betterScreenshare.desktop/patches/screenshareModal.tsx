/*
 * TrashCord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Settings } from "@api/Settings";
import { Flex } from "@components/Flex";
import { React } from "@webpack/common";

import { AudioSourceSelect, OpenScreenshareSettingsButton } from "../../betterScreenshare.desktop/components";
import { PluginInfo } from "../../betterScreenshare.desktop/constants";
import Plugin from "../../betterScreenshare.desktop/index";
import { screenshareStore } from "../../betterScreenshare.desktop/stores";
import { SettingsModalCard, SettingsModalCardItem } from "../../philsPluginLibrary";

const ReplacedStreamSettings = () => {
    const { use } = screenshareStore;

    const { audioSourceEnabled, setAudioSourceEnabled } = use();

    const cardProps = { style: { border: "1px solid var(--primary-800)" } };

    return (
        <div style={{ margin: "1em", display: "flex", flexDirection: "column", gap: "1em" }}>
            <SettingsModalCard cardProps={cardProps} title="Stream Settings">
                <SettingsModalCardItem>
                    <Flex flexDirection="column">
                        <OpenScreenshareSettingsButton title="Advanced Settings" />
                    </Flex>
                </SettingsModalCardItem>
            </SettingsModalCard>
            <SettingsModalCard
                cardProps={cardProps}
                switchEnabled
                switchProps={{
                    checked: audioSourceEnabled ?? false,
                    onChange: status => setAudioSourceEnabled(status)
                }}
                title="Audio Source">
                <SettingsModalCardItem>
                    <AudioSourceSelect isDisabled={!audioSourceEnabled} />
                </SettingsModalCardItem>
            </SettingsModalCard>
        </div>
    );
};

export function replacedSubmitFunction(fn: (...args: unknown[]) => unknown) { // This is used to hook over the new OnSubmit function instead of implementing an OnClick function
    return (...args: unknown[]) => {
        const { screensharePatcher, screenshareAudioPatcher } = Plugin;
        const patchedArgs = args.map(arg => Plugin.patchStreamSubmitOptions(arg));

        if (screensharePatcher) {
            screensharePatcher.forceUpdateTransportationOptions();
            if (screensharePatcher.hasActiveDesktopSource()) {
                screensharePatcher.forceUpdateDesktopEncodingOptions();
                screensharePatcher.forceUpdateDesktopSourceOptions();
            }
        }

        if (screenshareAudioPatcher)
            screenshareAudioPatcher.forceUpdateTransportationOptions();
        return fn(...patchedArgs);
    };
}

export function GoLivePanelWrapper({ children }: { children: React.JSX.Element; }) {
    if (!children)
        return;

    const { hideDefaultSettings } = Settings.plugins[PluginInfo.PLUGIN_NAME];
    if (hideDefaultSettings)
        return <ReplacedStreamSettings />;

    children.props.children.push(<ReplacedStreamSettings />);

    return children;

}
