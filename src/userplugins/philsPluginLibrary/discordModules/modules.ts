/*
 * TrashCord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { filters, waitFor } from "@webpack";

import * as types from "../../philsPluginLibrary/types";

export let utils: types.Utils;

waitFor(filters.byProps("getPidFromDesktopSource"), result => utils = result);
