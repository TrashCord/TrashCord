/*
 * TrashCord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { CheckedTextInput } from "@components/CheckedTextInput";
import { Card } from "@components/Card";
import { Margins } from "@utils/margins";
import { identity } from "@utils/misc";
import { findByCodeLazy } from "@webpack";
import { FormSwitch } from "@components/FormSwitch";
import { Heading } from "@components/Heading";
import { Paragraph } from "@components/Paragraph";
import { React, Select, SnowflakeUtils } from "@webpack/common";

import { makeEmptyAppId } from ".";
import { ActivityType, RpcApp, SettingsProps } from "./types";


const fetchApplicationsRPC = findByCodeLazy("APPLICATION_RPC(", "Client ID");

const cachedApps: any = {};
async function lookupApp(appId: string): Promise<RpcApp | null> {
    if (cachedApps[appId]) return cachedApps[appId];
    const socket: any = {};
    try {
        await fetchApplicationsRPC(socket, appId);
        console.log(`Lookup finished for ${socket.application.name}`);
        cachedApps[appId] = socket.application;
        return socket.application;
    } catch {
        console.log(`Lookup failed for ${appId}`);
        return null;
    }
}

function isValidSnowflake(v: string) {
    const regex = /^\d{17,20}$/;
    return regex.test(v) && !Number.isNaN(SnowflakeUtils.extractTimestamp(v));
}

export function ReplaceTutorial() {
    return (
        <>
            <Heading tag="h3">How to get an Application ID</Heading>
            <Paragraph>
                The method of getting an app's id will differ depending on what app it is. If the source code is available you can most likely find it inside the app's repository.
            </Paragraph>
            <Paragraph>
                Another method is to start the app in question, then open Discord's console and look for a log from RPCServer saying something like
                <code>"cmd: 'SET_ACTIVITY'"</code> with your app's name somewhere inside
            </Paragraph>

            <Heading tag="h3" style={{ color: "var(--text-danger)", textAlign: "center" }}>
                Note: ActivityTypes other than Playing will only show timestamps on Mobile. It's a Discord issue.
            </Heading>
        </>
    );
}

export function ReplaceSettings({ appIds, update, save }: SettingsProps) {
    async function onChange(val: string | boolean, index: number, key: string) {
        if (index === appIds.length - 1)
            appIds.push(makeEmptyAppId());

        appIds[index][key] = val;

        if (val && key === "appId") {
            const tempApp = await lookupApp(val.toString());
            appIds[index].appName = tempApp?.name || "Unknown";
        }

        if (appIds[index].appId === "" && index !== appIds.length - 1)
            appIds.splice(index, 1);

        save();
        update();
    }

    return (
        <>
            {
                appIds.map((setting, i) =>
                    <Card style={{ padding: "1em 1em 0" }}>
                        <FormSwitch
                            value={setting.enabled}
                            onChange={value => {
                                onChange(value, i, "enabled");
                            }}
                            className={Margins.bottom16}
                            hideBorder={true} title={<>{setting.appName}</>} />
                        <Heading>Application ID</Heading>
                        <CheckedTextInput
                            value={setting.appId}
                            onChange={async v => {
                                onChange(v, i, "appId");
                            }}
                            validate={v =>
                                !v || isValidSnowflake(v) || "Invalid appId, must be a snowflake"
                            }
                        />
                        {setting.activityType === ActivityType.STREAMING &&
                            <>
                                <Heading>Stream URL</Heading>
                                <CheckedTextInput
                                    value={setting.streamUrl}
                                    onChange={async v => {
                                        onChange(v, i, "streamUrl");
                                    }}
                                    validate={st => !/https?:\/\/(www\.)?(twitch\.tv|youtube\.com)\/\w+/.test(st) && "Only Twitch and Youtube urls will work." || true}
                                />
                            </>}
                        <Heading>New activity type</Heading>
                        <Select
                            options={[
                                { label: "Playing", value: ActivityType.PLAYING },
                                { label: "Watching", value: ActivityType.WATCHING },
                                { label: "Listening", value: ActivityType.LISTENING },
                                { label: "Competing", value: ActivityType.COMPETING },
                                { label: "Streaming", value: ActivityType.STREAMING }
                            ]}
                            select={value => {
                                onChange(value, i, "activityType");
                            }}
                            className={Margins.bottom16}
                            isSelected={value => setting.activityType === value}
                            serialize={identity}
                        />
                        <FormSwitch
                            value={setting.swapNameAndDetails}
                            onChange={value => {
                                onChange(value, i, "swapNameAndDetails");
                            }}
                            className={Margins.bottom16}
                            hideBorder={true} title="Swap presence name and details" />
                    </Card>
                )
            }
        </>
    );
}