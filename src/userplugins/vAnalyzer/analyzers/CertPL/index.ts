/*
 * TrashCord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { PluginNative } from "@utils/types";

import { AnalysisValue, extractDomain, safeToast } from "../../utils";

const Native = VencordNative.pluginHelpers.vAnalyzer as PluginNative<typeof import("./native")>;

export async function analyzeWithCertPL(url: string, silent = false): Promise<AnalysisValue | null> {
    const domain = extractDomain(url);
    if (!silent) safeToast(`Checking ${domain} against CERT.PL blocklist...`);

    const result = await Native.queryCertPL(domain);

    if (result.error) {
        if (!silent) safeToast(`CERT.PL lookup failed: ${result.error}`, "failure");
        return null;
    }

    const details: AnalysisValue["details"] = [];

    if (result.found) {
        details.push({ message: `[CertPL] [SCAM] ${domain} found in blocklist`, type: "malicious" });
    } else {
        details.push({ message: `[CertPL] ${domain} not in blocklist`, type: "safe" });
    }

    if (!silent) {
        if (result.found) {
            safeToast(`WARNING: ${domain} is on CERT.PL blocklist!`, "failure");
        } else {
            safeToast(`${domain} not found in CERT.PL blocklist`, "success");
        }
    }

    return { details, timestamp: Date.now() };
}
