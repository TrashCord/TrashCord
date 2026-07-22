/*
* Vencord, a Discord client mod
* Copyright (c) 2026 Vendicated and contributors*
* SPDX-License-Identifier: GPL-3.0-or-later
*/

import { ConnectSrc, CspPolicies, ImageSrc } from "@main/csp";

CspPolicies["https://*.7tv.app"] = ConnectSrc;
CspPolicies["https://cdn.7tv.app"] = ImageSrc;
CspPolicies["https://static-cdn.jtvnw.net"] = ImageSrc;
