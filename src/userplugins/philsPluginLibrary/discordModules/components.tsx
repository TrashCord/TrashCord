/*
 * TrashCord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { LazyComponent } from "@utils/react";
import { findByCode } from "@webpack";

import { types } from "../../philsPluginLibrary";

export const UserSummaryItem = LazyComponent<React.ComponentProps<types.UserSummaryItem>>(() => findByCode("defaultRenderUser", "showDefaultAvatarsForNullUsers"));
