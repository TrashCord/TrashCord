/*
* Vencord, a Discord client mod
* Copyright (c) 2026 Vendicated and contributors*
* SPDX-License-Identifier: GPL-3.0-or-later
*/

import { ChatBarButton, ChatBarButtonFactory } from "@api/ChatButtons";
import { IconComponent } from "@utils/types";
import { Clickable, ComponentDispatch, TextInput, Tooltip, useState, useEffect, ScrollerThin, ExpressionPickerStore, ChannelStore, DraftType, SelectedChannelStore } from "@webpack/common";
import { ExpressionPickerPanelComponent } from "./ExpressionPickerTabs";
import { classNameFactory } from "@utils/css";
import { Divider } from "@components/Divider";
import { stv } from "./api";
import { ParsedEmote, ParsedEmoteSet } from "./interfaces/data";
import { JSX } from "react";
import { DownArrow, PlusIcon, RightArrow } from "@components/Icons";
import { DataStore } from "@api/index";
import { isObjectEmpty } from "@utils/misc";
import { settings } from "./settings";
import { insertTextIntoChatInputBox } from "@utils/discord";
import { logger } from "./logger";
import { Card } from "@components/Card";
import { Paragraph } from "@components/Paragraph";

const cl = classNameFactory("vc-stv-");

const stvIdPattern = new RegExp(/^(?=(?:.{24}|.{26})$)[0-9a-hjkmnp-tv-zA-HJKMNP-TV-Z]*$/i);

let globalSetId: string | undefined;
let emoteSets: Record<string, ParsedEmoteSet> = {};


export const SevenTVIcon: IconComponent = ({ height = 20, width = 20, className }) => {
    return (
        <svg
            height={height}
            width={width}
            viewBox="-3 0 250 250"
            className={className}
            fill="currentColor"
        >
            <polygon points="17 33, 111 33, 139 82, 65 211, 30 211, 19 192, 82 82, 12 82, 0 62" />
            <polygon points="134 33, 193 33, 204 52, 187 82, 162 82" />
            <polygon points="151 102, 174 142, 199 101, 232 101, 244 121, 192 211, 157 211, 123 150" />
        </svg>
    );
};


export const SevenTVChatBarIcon: ChatBarButtonFactory = ({ isMainChat }) => {
    if (!isMainChat) return null;

    let button = (
        <ChatBarButton
            tooltip="7TV Emotes"
            onClick={(e) => {
                ComponentDispatch.dispatch("OPEN_EXPRESSION_PICKER", { activeView: "SevenTVEmotes" });
            }}
        >
            <SevenTVIcon></SevenTVIcon>
        </ChatBarButton>
    );

    return button;
};


export const GlobalIcon: IconComponent = ({ height, width, className }) => {
    return (
        <svg
            height={height}
            width={width}
            viewBox="0 0 128 128"
            className={className}
            fill="currentColor"
        >
            <mask id="globe-lines-mask">
                <rect height="100%" width="100%" fill="white" />

                <line
                    x1="64" y1="0"
                    x2="64" y2="128"
                    stroke="black" stroke-width="8"
                />
                <ellipse
                    cx="64" cy="64"
                    rx="36" ry="68"
                    stroke="black" stroke-width="8"
                    fill="none"
                />
                <ellipse
                    cx="64" cy="36"
                    rx="90" ry="32"
                    stroke="black" stroke-width="8"
                    stroke-dasharray="140,1000" stroke-dashoffset="-30"
                    fill="none"
                />
                <ellipse
                    cx="64" cy="64"
                    rx="80" ry="40"
                    stroke="black" stroke-width="8"
                    fill="none"

                />
            </mask>

            <circle
                cx="64" cy="64"
                r="64"
                stroke="none"
                fill="currentColor"
                mask="url(#globe-lines-mask)"
            />
        </svg>
    );
};



export const WarningCard: JSX.Element = ({ warning, dismissable = true }) => {
    const [dismissed, setDismissed] = useState(null);

    return (
        <div className={cl("picker-section-wrapper")}
            style={dismissed ? { display: "none" } : {}}
        >
            <Card variant="warning"
                className={cl("warning-card")}
                defaultPadding
            >
                <Paragraph>{warning}</Paragraph>
                <div className={cl("clickable-icon")}
                    onClick={() => { dismissable && setDismissed(!dismissed); }}
                >
                    <PlusIcon height="16"
                        width="16"
                        style={{ transform: "rotate(45deg)" }}
                    />
                </div>
            </Card>
        </div>
    );
};


export const SevenTVExpressionPicker: ExpressionPickerPanelComponent = () => {
    const [emoteSetsData, setEmoteSetsData] = useState(null);
    const [emoteDisplayData, setEmoteDisplayData] = useState(null);
    const [previewData, setPreviewData] = useState(null);


    function updatePreview(e) {
        let emoteEl: Element = e.target;

        if (!emoteEl) { return; }

        if (emoteEl.tagName == "IMG") {
            if (!emoteEl.parentElement) { return; }
            emoteEl = emoteEl.parentElement;
        }

        let inspectorContent: EmoteInspectorPreviewState = {
            setId: emoteEl.attributes["stv-set-id"].value,
            emoteName: emoteEl.attributes["stv-emote-name"].value,
            emoteSrc: emoteEl.attributes["stv-emote-inspector-url"].value,
        };

        setPreviewData(inspectorContent);
    }


    useEffect(() => {
        async function getEmoteSets() {
            let warnings: string[] = [];
            let sets: ParsedEmoteSet[] = [];

            if (!settings.store.globalEmoteSet && globalSetId) {
                delete emoteSets[globalSetId];
                globalSetId = undefined;
            }

            if (settings.store.globalEmoteSet && !globalSetId) {
                let globalSetData = await stv.getGlobals();
                globalSetId = globalSetData?.id;
                globalSetData
                    ? sets.push(globalSetData)
                    : warnings.push("Failed to load global emote set");
            }

            let setIds: string[] = (settings.store.emoteSetIds ?? "").replaceAll(" ", "").split(",");
            let validSetIds: string[] = [], invalidSetIds: string[] = [];

            setIds.forEach((setId) => {
                if (emoteSets[setId]) { return; }

                (stvIdPattern.test(setId) ? validSetIds : invalidSetIds).push(setId);
            });

            if (validSetIds.length) {
                let setsData = await stv.getEmoteSets(validSetIds);
                if (setsData) {
                    sets = sets.concat(setsData);
                } else {
                    warnings.push(`Failed to load ${validSetIds.length} emote set(s)`);
                };
            }

            if (invalidSetIds.length) {
                warnings.push(`${invalidSetIds.length} invalid set id(s): ${invalidSetIds.join(", ")}`);
            }

            if (sets.length || warnings.length) {
                setEmoteSetsData({
                    sets: sets,
                    warnings: warnings
                });
            };
        }

        getEmoteSets();
    }, []);


    let setIcons: JSX.Element[] = [];
    let emoteSections: JSX.Element[] = [];


    if (emoteSetsData) {
        emoteSetsData.warnings.length && emoteSetsData.warnings.forEach((warning) => {
            emoteSections.push(
                <WarningCard warning={warning} />
            );
        });

        for (let i = 0; i < emoteSetsData.sets.length; i++) {
            let emoteSet = emoteSetsData.sets[i];
            emoteSets[emoteSet.id] = emoteSet;
        }
    }


    for (let emoteSet of Object.values(emoteSets)) {
        setIcons.push(SevenTVSetIcon(emoteSet.id, emoteSet.name, emoteSet.avatarUrl));

        if (!emoteDisplayData) {
            emoteSections.push(<EmoteSection setData={emoteSet} updatePreview={updatePreview} />);
        }
    }

    return (
        <div className={cl("picker")}>
            <div className={cl("picker-search-wrapper")}>
                <TextInput
                    placeholder="Search 7TV Emotes"
                    onChange={e => searchEmotes(setEmoteDisplayData, updatePreview, e)}
                />
            </div>

            <Divider className={cl("picker-divider")} />

            <div className={cl("picker-results-wrapper")}>
                <div className={cl("picker-sidebar")}>
                    <div className={cl("picker-sidebar-sets")}>
                        {setIcons}
                    </div>

                    <div className={cl("picker-global-button-wrapper")}>
                        <Tooltip text="Global Emotes">
                            {({ onMouseEnter, onMouseLeave }) => (
                                <Clickable
                                    onMouseEnter={onMouseEnter}
                                    onMouseLeave={onMouseLeave}
                                    className={cl("clickable-icon")}
                                >
                                    <GlobalIcon className={cl("picker-global-button-icon")}></GlobalIcon>
                                </Clickable>
                            )}
                        </Tooltip>
                    </div>
                </div>

                <ScrollerThin>
                    <div className={cl("picker-emotes")}>
                        <div className={cl("picker-emote-sections-wrapper")}>
                            {emoteDisplayData ?? emoteSections}
                        </div>
                    </div>
                </ScrollerThin>

                <div className={cl("picker-inspector")}>
                    <EmoteInspectorPreview data={previewData} />
                </div>
            </div>
        </div>
    );
};


function SevenTVSetIcon(setId: string, setName: string, avatarUrl: { static: string, animated: string; }): JSX.Element {
    return (
        <div className={cl("picker-set-icon-wrapper")}
            style={setId === globalSetId ? { order: "-1" } : {}}
        >
            <div className={cl("picker-set-icon")}>
                <Tooltip text={setName} position="right">
                    {({ onMouseEnter, onMouseLeave }) => (
                        <div
                            onMouseEnter={onMouseEnter}
                            onMouseLeave={onMouseLeave}
                            className={cl("picker-set-img-wrapper", "clickable-button")}
                            onClick={(e) => {
                                window.location.hash = "";
                                window.location.hash = "#" + cl(`emote-section-${e.currentTarget.attributes["stv-set-id"].value}`);
                            }}
                            stv-set-id={setId}
                        >
                            <img
                                className={cl("picker-set-img")}
                                src={avatarUrl.static}
                            />
                            <img
                                className={cl("picker-set-img")}
                                stv-animated="true"
                                src={avatarUrl.animated}
                            />
                        </div>
                    )}
                </Tooltip>
            </div>
        </div>
    );
}


type EmoteSectionProps = { setData: ParsedEmoteSet, updatePreview?: Function; };

function EmoteSection(props: EmoteSectionProps): JSX.Element {
    let setData: ParsedEmoteSet = props.setData;

    const dataStoreKey = `SevenTVEmotes_expanded_${setData.id}`;
    const [expanded, setExpanded] = useState(null);

    if (expanded === null) {
        DataStore.get(dataStoreKey).then(value => setExpanded(value ?? true));
        return; // prevents collapsed menus from being expanded before `setExpanded` is called
    }

    return (
        <div
            className={cl("picker-section-wrapper")}
            id={cl(`emote-section-${setData.id}`)}
            style={setData.id == globalSetId ? { order: "-1" } : {}}
        >
            <Clickable
                className={cl("picker-section-expandable")}
                tabIndex="-1"
                onClick={() => {
                    setExpanded((c: boolean) => {
                        c = !c;
                        c ? DataStore.del(dataStoreKey) : DataStore.set(dataStoreKey, c);
                        return c;
                    });
                }}
            >
                <img
                    className={cl("picker-section-img")}
                    src={setData.avatarUrl.static}
                />
                <div>{setData.name}</div>
                {expanded
                    ? <DownArrow className={cl("picker-section-arrow")} />
                    : <RightArrow className={cl("picker-section-arrow")} />}
            </Clickable>

            {expanded
                ? <div className={cl("picker-section-content")}>
                    {setData.emotes.map(emote => <EmoteButton setId={setData.id} emoteData={emote} updatePreview={props.updatePreview} />)}
                </div>
                : null
            }
        </div>
    );
}


type EmoteButtonProps = { setId: string, emoteData: ParsedEmote, updatePreview?: Function; };

function EmoteButton(props: EmoteButtonProps): JSX.Element {
    let emote = props.emoteData;
    let loadEmoteScale = settings.store.loadEmoteScale;
    let sendEmoteScale = settings.store.sendEmoteScale;

    let pickerUrls = settings.store.animatedPickerEmotes ? emote.urls.animated : emote.urls.static;
    let inspectorUrls = settings.store.animatedInspectorEmotes ? emote.urls.animated : emote.urls.static;
    let sendUrls = settings.store.sendAnimatedEmotes ? emote.urls.animated : emote.urls.static;

    return (
        <div
            className={cl("picker-emote-wrapper", "clickable-button")}
            stv-set-id={props.setId}
            stv-emote-name={emote.alias}
            stv-emote-send-url={sendUrls[sendEmoteScale]}
            stv-emote-inspector-url={inspectorUrls[loadEmoteScale]}
            onMouseEnter={props.updatePreview}
            onClick={insertEmoteIntoChatInput}
        >
            <img
                className={cl("picker-emote-img")}
                src={pickerUrls[loadEmoteScale]}
                width={emote.urls.width}
            />
        </div>
    );
}


type EmoteInspectorPreviewState = { setId: string, emoteName: string, emoteSrc: string; };
type EmoteInspectorPreviewProps = { data: EmoteInspectorPreviewState; };

function EmoteInspectorPreview(props: EmoteInspectorPreviewProps): JSX.Element {
    let content = props.data ?? {};

    if (!content.setId || !content.emoteName || !content.emoteSrc) {
        return (<div></div>);
    }

    let setData = emoteSets[content.setId];

    return (
        <div className={cl("inspector-wrapper")}>
            <div className={cl("inspector-emote-preview")}>
                <img src={content.emoteSrc} />
            </div>
            <div className={cl("inspector-emote-info")}>
                <div className={cl("inspector-emote-info-name")}>:{content.emoteName}:</div>
                <div className={cl("inspector-emote-info-origin")}>
                    from
                    <strong> {setData.name}</strong>
                </div>
            </div>
            <div className={cl("inspector-set-icon")}>
                <img src={setData.avatarUrl.animated} />
            </div>
        </div>
    );
}



function searchEmotes(setEmoteDisplayData: Function, updatePreview: Function, query: string = "", global: boolean = false) {
    // TODO: add global check here

    query = query.trim().toLowerCase();

    let result: JSX.Element[] = [];

    if (query) {
        for (let [setId, setData] of Object.entries(emoteSets)) {
            setData.emotes.forEach(emote => {
                if (emote.alias.toLowerCase().includes(query)) {
                    result.push(<EmoteButton setId={setId} emoteData={emote} updatePreview={updatePreview} />);
                }
            });
        }
    } else {
        for (let [setId, setData] of Object.entries(emoteSets)) {
            result.push(<EmoteSection setData={setData} updatePreview={updatePreview} />);
        }
    }

    setEmoteDisplayData(result);
}


function insertEmoteIntoChatInput(e) {
    let targetEl: Element = e.target;

    if (targetEl.tagName == "IMG") {
        if (!targetEl.parentElement) {
            logger.error("Failed to get clicked emote: img tag does not have a parent");
            return;
        }
        targetEl = targetEl.parentElement;
    }

    let url = targetEl.attributes["stv-emote-send-url"].value;
    let emoteName = targetEl.attributes["stv-emote-name"].value ?? "emote";

    settings.store.sendAttachments
        ? uploadEmote(url, emoteName)
        : insertTextIntoChatInputBox(url + " ");

    if (!e.shiftKey) {
        ExpressionPickerStore.closeExpressionPicker();
    }
}


async function uploadEmote(url: string, name: string = "emote") {
    let channelId = SelectedChannelStore.getChannelId();
    let channel = ChannelStore.getChannel(channelId);

    let filename = url.split("/").pop();
    filename = filename ? [name, filename].join("_") : name;

    fetch(url)
        .then(r => r.blob())
        .then(image => new File([image], filename, { type: image.type }))
        .then(file => Vencord.Webpack.Common.UploadHandler.promptToUpload([file], channel, DraftType.ChannelMessage));
}
