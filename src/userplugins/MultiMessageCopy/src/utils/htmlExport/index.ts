/*
 * TrashCord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { ExportDocument } from "../../types/export"
import { renderHtmlShell } from "./layout"

/**
 * Convert an ExportDocument to a complete, standalone HTML string
 * that can be saved as a .html file and opened in any browser.
 */
export function formatExportAsHtml(doc: ExportDocument): string {
  return renderHtmlShell(doc)
}
