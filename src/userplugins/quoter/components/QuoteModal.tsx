import { Button } from "@components/Button";
import { FormSwitch } from "@components/FormSwitch";
import { Heading } from "@components/Heading";
import { Paragraph } from "@components/Paragraph";
import { classNameFactory } from "@utils/css";
import { getCurrentChannel } from "@utils/discord";
import { ModalCloseButton, ModalContent, ModalFooter, ModalHeader, type ModalProps, ModalRoot, ModalSize } from "@utils/modal";
import { saveFile } from "@utils/web";
import type { Message } from "@vencord/discord-types";
import { IconUtils, PermissionsBits, PermissionStore, Select, TextInput, UploadHandler, useEffect, useRef, useState } from "@webpack/common";

import { settings } from "..";
import { type QuoteImageOptions, QuoteAvatarSize, QuoteFontWeight } from "../types";
import { clearQuoteCache, createQuoteImage, generateFileNamePreview, getFileExtension, getMimeType } from "../utils";

const cl = classNameFactory("vc-quoter-");

const SETTING_KEYS: (keyof typeof settings.store)[] = [
    "grayscale", "showWatermark", "saveAsGif", "watermark", "quoteFont",
    "fontWeight", "alignment", "textColor", "showAvatar", "avatarOnRight",
    "avatarSize", "authorFormat", "showQuotationMarks"
];

export function QuoteModal({ message, ...props }: ModalProps & { message: Message; }) {
    const {
        grayscale, showWatermark, saveAsGif, watermark, quoteFont,
        fontWeight, alignment, textColor, showAvatar, avatarOnRight,
        avatarSize, authorFormat, showQuotationMarks
    } = settings.use(SETTING_KEYS);

    const [previewUrl, setPreviewUrl] = useState<string | null>(null);
    const blobRef = useRef<Blob | null>(null);
    const prevUrlRef = useRef<string | null>(null);
    const aliveRef = useRef(true);
    const busyRef = useRef(false);
    const dirtyRef = useRef(false);
    const optionsRef = useRef<QuoteImageOptions | null>(null);

    function buildOptions(gif: boolean): QuoteImageOptions {
        return {
            avatarUrl: IconUtils.getUserAvatarURL(message.author, true, 512),
            quote: message.content,
            grayScale: grayscale,
            author: message.author,
            watermark,
            showWatermark,
            saveAsGif: gif,
            quoteFont,
            fontWeight,
            alignment,
            textColor,
            showAvatar,
            avatarOnRight,
            avatarSize,
            authorFormat,
            showQuotationMarks
        };
    }

    function run() {
        if (busyRef.current) {
            dirtyRef.current = true;
            return;
        }
        const options = optionsRef.current;
        if (!options) return;

        busyRef.current = true;
        createQuoteImage(options).then(blob => {
            if (!aliveRef.current) return;
            blobRef.current = blob;
            const url = URL.createObjectURL(blob);
            if (prevUrlRef.current) URL.revokeObjectURL(prevUrlRef.current);
            prevUrlRef.current = url;
            setPreviewUrl(url);
        }).catch(() => { }).finally(() => {
            busyRef.current = false;
            if (dirtyRef.current && aliveRef.current) {
                dirtyRef.current = false;
                run();
            }
        });
    }

    useEffect(() => {
        aliveRef.current = true;
        return () => {
            aliveRef.current = false;
            if (prevUrlRef.current) URL.revokeObjectURL(prevUrlRef.current);
            clearQuoteCache();
        };
    }, []);

    useEffect(() => {
        optionsRef.current = buildOptions(false);
        run();
    }, [grayscale, showWatermark, watermark, quoteFont, fontWeight, alignment, textColor, showAvatar, avatarOnRight, avatarSize, authorFormat, showQuotationMarks]);

    async function buildFile(): Promise<File | null> {
        const blob = saveAsGif ? await createQuoteImage(buildOptions(true)) : blobRef.current;
        if (!blob) return null;
        const ext = getFileExtension(saveAsGif);
        const name = `${generateFileNamePreview(message.content)} - ${message.author.username}.${ext}`;
        return new File([blob], name, { type: getMimeType(saveAsGif) });
    }

    const channel = getCurrentChannel();
    const canSend = !!channel && (channel.isPrivate() || PermissionStore.can(PermissionsBits.ATTACH_FILES, channel));

    return (
        <ModalRoot {...props} size={ModalSize.LARGE}>
            <ModalHeader>
                <Heading tag="h2" style={{ flexGrow: 1, margin: 0 }}>Quote Message</Heading>
                <ModalCloseButton onClick={props.onClose} />
            </ModalHeader>

            <ModalContent>
                {previewUrl
                    ? <img src={previewUrl} alt="Quote preview" className={cl("preview")} />
                    : <div className={cl("loading")}>
                        <Paragraph>Loading...</Paragraph>
                    </div>
                }

                <div className={cl("controls")}>
                    <section>
                        <Heading tag="h2">Image</Heading>
                        <FormSwitch
                            title="Grayscale"
                            value={grayscale}
                            onChange={v => settings.store.grayscale = v}
                        />
                        <FormSwitch
                            title="Bold text"
                            description="Toggles between bold and light weight (use plugin settings for more options)"
                            value={fontWeight === QuoteFontWeight.Bold}
                            onChange={v => settings.store.fontWeight = v ? QuoteFontWeight.Bold : QuoteFontWeight.Light}
                        />
                        <FormSwitch
                            title="Decorative quotation marks"
                            value={showQuotationMarks}
                            onChange={v => settings.store.showQuotationMarks = v}
                        />
                    </section>

                    <section>
                        <Heading tag="h2">Avatar</Heading>
                        <FormSwitch
                            title="Show avatar"
                            value={showAvatar}
                            onChange={v => settings.store.showAvatar = v}
                        />
                        {showAvatar && (<>
                            <FormSwitch
                                title="Avatar on right"
                                value={avatarOnRight}
                                onChange={v => settings.store.avatarOnRight = v}
                            />
                            <div style={{ marginBottom: 20 }}>
                                <Heading tag="h5">Size</Heading>
                                <Paragraph>Size of the avatar horizontally</Paragraph>
                                <Select
                                    options={[
                                        { label: "Full", value: QuoteAvatarSize.Full },
                                        { label: "Large", value: QuoteAvatarSize.Large }
                                    ]}
                                    isSelected={v => v === avatarSize}
                                    select={v => settings.store.avatarSize = v}
                                    serialize={v => String(v)}
                                />
                            </div>
                        </>)}
                    </section>

                    <section>
                        <Heading tag="h2">Export</Heading>
                        <FormSwitch
                            title="Save as GIF"
                            description="Saves and sends as GIF instead of PNG"
                            value={saveAsGif}
                            onChange={v => settings.store.saveAsGif = v}
                        />
                        <FormSwitch
                            title="Show watermark"
                            value={showWatermark}
                            onChange={v => settings.store.showWatermark = v}
                        />
                        {showWatermark && (
                            <TextInput
                                value={watermark}
                                onChange={v => settings.store.watermark = v}
                                placeholder="Watermark text (max 32 characters)"
                                maxLength={32}
                            />
                        )}
                    </section>
                </div>
            </ModalContent>

            <ModalFooter>
                <Button
                    disabled={!canSend}
                    onClick={async () => {
                        if (!canSend) return;
                        try {
                            const file = await buildFile();
                            if (!file) return;
                            UploadHandler.promptToUpload([file], channel!, 0);
                            props.onClose();
                        } catch { }
                    }}
                >
                    Send
                </Button>
                <Button
                    variant="secondary"
                    onClick={async () => {
                        try {
                            const file = await buildFile();
                            if (file) saveFile(file);
                        } catch { }
                    }}
                    style={{ marginRight: 8 }}
                >
                    Export
                </Button>
            </ModalFooter>
        </ModalRoot>
    );
}
