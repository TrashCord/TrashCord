/**
 * htmlExport/index.ts
 *
 * Public entry point for the HTML export module.
 * Only function exported: formatExportAsHtml(doc).
 * Everything else is handled by the sub-modules.
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
