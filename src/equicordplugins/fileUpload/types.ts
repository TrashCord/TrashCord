/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export enum ServiceType {
    ZIPLINE = "zipline",
    NEST = "nest",
    EZHOST = "ezhost",
<<<<<<< HEAD
    ENCRYPTINGHOST = "encryptinghost",
=======
>>>>>>> 89b0fd2a5 (Update index.tsx)
    S3 = "s3",
    CATBOX = "catbox",
    ZEROX0 = "0x0",
    LITTERBOX = "litterbox",
    SHAREX = "sharex",
    GOFILE = "gofile",
    TMPFILES = "tmpfiles",
    BUZZHEAVIER = "buzzheavier",
    TEMPSH = "tempsh",
    FILEBIN = "filebin",
    PIXELVAULT = "pixelvault",
<<<<<<< HEAD
    PIXELDRAIN = "pixeldrain",
    WEBDAV = "webdav"
=======
    PIXELDRAIN = "pixeldrain"
>>>>>>> 89b0fd2a5 (Update index.tsx)
}

export const serviceLabels: Record<ServiceType, string> = {
    [ServiceType.ZIPLINE]: "Zipline",
    [ServiceType.NEST]: "Nest",
    [ServiceType.EZHOST]: "E-Z Host",
<<<<<<< HEAD
    [ServiceType.ENCRYPTINGHOST]: "Encrypting.host",
=======
>>>>>>> 89b0fd2a5 (Update index.tsx)
    [ServiceType.S3]: "S3-Compatible",
    [ServiceType.CATBOX]: "Catbox",
    [ServiceType.ZEROX0]: "0x0.st",
    [ServiceType.LITTERBOX]: "Litterbox",
    [ServiceType.SHAREX]: "ShareX Custom Uploader",
    [ServiceType.GOFILE]: "GoFile",
    [ServiceType.TMPFILES]: "tmpfiles.org",
    [ServiceType.BUZZHEAVIER]: "buzzheavier.com",
    [ServiceType.TEMPSH]: "temp.sh",
    [ServiceType.FILEBIN]: "filebin.net",
    [ServiceType.PIXELVAULT]: "PixelVault",
<<<<<<< HEAD
    [ServiceType.PIXELDRAIN]: "PixelDrain",
    [ServiceType.WEBDAV]: "WebDAV"
=======
    [ServiceType.PIXELDRAIN]: "PixelDrain"
>>>>>>> 89b0fd2a5 (Update index.tsx)
};

export const fallbackServiceOrder: ServiceType[] = [
    ServiceType.ZIPLINE,
    ServiceType.EZHOST,
    ServiceType.NEST,
<<<<<<< HEAD
    ServiceType.ENCRYPTINGHOST,
=======
>>>>>>> 89b0fd2a5 (Update index.tsx)
    ServiceType.S3,
    ServiceType.CATBOX,
    ServiceType.ZEROX0,
    ServiceType.LITTERBOX,
    ServiceType.GOFILE,
    ServiceType.TMPFILES,
    ServiceType.BUZZHEAVIER,
    ServiceType.TEMPSH,
    ServiceType.FILEBIN,
    ServiceType.PIXELVAULT,
    ServiceType.PIXELDRAIN,
<<<<<<< HEAD
    ServiceType.WEBDAV,
=======
>>>>>>> 89b0fd2a5 (Update index.tsx)
    ServiceType.SHAREX
];

export interface UploadResponse {
    files: {
        id: string;
        type: string;
        url: string;
    }[];
}

export interface NestUploadResponse {
    fileURL: string;
}

export interface NativeUploadResult {
    success: boolean;
    url?: string;
    error?: string;
}

export interface ShareXUploaderConfig {
    Version?: string;
    Name?: string;
    DestinationType?: string;
    RequestMethod?: string;
    RequestURL?: string;
    Headers?: Record<string, string | number | boolean>;
    Body?: string;
    FileFormName?: string;
    Arguments?: Record<string, string | number | boolean>;
    URL?: string;
    ErrorMessage?: string;
}
