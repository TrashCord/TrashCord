import type { User } from "@vencord/discord-types";

export enum QuoteFont {
    MPlusRounded = "M PLUS Rounded 1c",
    OpenSans = "Open Sans",
    MomoSignature = "Momo Signature",
    Lora = "Lora",
    Merriweather = "Merriweather"
}

export enum QuoteFontWeight {
    Light = "300",
    Regular = "400",
    Semibold = "600",
    Bold = "700"
}

export enum QuoteAlignment {
    Left = "left",
    Center = "center",
    Right = "right"
}

export enum QuoteTextColor {
    White = "#ffffff",
    OffWhite = "#e0e0e0",
    Black = "#111111"
}

export enum QuoteAuthorFormat {
    Both = "both",
    NameOnly = "name",
    UsernameOnly = "username"
}

export enum QuoteAvatarSize {
    Full = "full",
    Large = "large"
}

export interface QuoteSourceMeta {
    author: User;
    avatarUrl: string;
    quote: string;
}

export interface QuoteRenderOptions {
    grayScale: boolean;
    quoteFont: QuoteFont;
    fontWeight: QuoteFontWeight;
    watermark: string;
    showWatermark: boolean;
    saveAsGif: boolean;
    alignment: QuoteAlignment;
    textColor: QuoteTextColor;
    showAvatar: boolean;
    avatarOnRight: boolean;
    avatarSize: QuoteAvatarSize;
    authorFormat: QuoteAuthorFormat;
    showQuotationMarks: boolean;
}

export type QuoteImageOptions = QuoteSourceMeta & QuoteRenderOptions;

export interface CanvasConfig {
    width: number;
    height: number;
    quoteAreaWidth: number;
    quoteAreaX: number;
    maxContentHeight: number;
}

export interface FontSizeCalculation {
    fontSize: number;
    lineHeight: number;
    authorFontSize: number;
    usernameFontSize: number;
    lines: string[];
    totalHeight: number;
}

export const CANVAS_CONFIG: CanvasConfig = {
    width: 1200,
    height: 600,
    quoteAreaWidth: 520,
    quoteAreaX: 640,
    maxContentHeight: 480
};

export const FONT_SIZES = {
    initial: 42,
    minimum: 18,
    decrement: 2,
    lineHeightMultiplier: 1.25,
    authorMultiplier: 0.60,
    usernameMultiplier: 0.45,
    authorMinimum: 22,
    usernameMinimum: 18,
    watermark: 18
};

export const SPACING = {
    authorTop: 60,
    username: 10,
    gradientWidth: 400,
    watermarkPadding: 20,
    noAvatarQuoteWidth: 900,
    textPadding: 40
};

export const AVATAR_COLUMN_WIDTHS: Record<QuoteAvatarSize, number> = {
    [QuoteAvatarSize.Full]: 600,
    [QuoteAvatarSize.Large]: 700
};
