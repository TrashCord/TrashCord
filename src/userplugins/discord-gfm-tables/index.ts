import definePlugin from "@utils/types";

const processedAttribute = "data-discord-gfm-tables";
const originalAttribute = "data-discord-gfm-tables-original";
const styleId = "discord-gfm-tables-styles";

let observer: MutationObserver | null = null;

export default definePlugin({
  name: "DiscordGfmTables",
  description: "Renders GitHub-Flavored Markdown pipe tables in Discord messages.",
  authors: [{ name: "Microck", id: 0n }],
    tags: ["Chat", "Utility"],
    enabledByDefault: false,
  requiresRestart: false,

  start() {
    injectStyles();
    processExistingMessages();

    observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node instanceof HTMLElement) processNode(node);
        }
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });
  },

  stop() {
    observer?.disconnect();
    observer = null;

    for (const element of document.querySelectorAll<HTMLElement>(`[${originalAttribute}]`)) {
      element.textContent = element.getAttribute(originalAttribute) || "";
      element.removeAttribute(originalAttribute);
      element.removeAttribute(processedAttribute);
    }

    document.getElementById(styleId)?.remove();
  },
});

function processExistingMessages() {
  processNode(document.body);
}

function processNode(root: Element) {
  const candidates = root.matches("[id^='message-content-']")
    ? [root]
    : Array.from(root.querySelectorAll("[id^='message-content-']"));

  for (const candidate of candidates) {
    if (candidate instanceof HTMLElement) processMessageContent(candidate);
  }
}

function processMessageContent(element: HTMLElement) {
  if (element.hasAttribute(processedAttribute)) return;

  const source = element.innerText || element.textContent || "";
  const blocks = parseMarkdownTableBlocks(source);
  if (!blocks.some((block) => block.type === "table")) return;

  element.setAttribute(originalAttribute, source);
  element.setAttribute(processedAttribute, "true");
  element.replaceChildren(renderBlocks(blocks));
}

function injectStyles() {
  if (document.getElementById(styleId)) return;

  const style = document.createElement("style");
  style.id = styleId;
  style.textContent = `
.mdtr-table-wrap {
  max-width: 100%;
  overflow-x: auto;
  margin: 0.35rem 0;
}

.mdtr-table {
  --mdtr-border-color: var(--border-subtle, rgba(128, 132, 142, 0.48));

  width: max-content;
  min-width: min(100%, 32rem);
  border: 1px solid var(--mdtr-border-color);
  border-collapse: collapse;
  color: var(--text-normal);
  font-size: 0.9375rem;
  line-height: 1.35;
}

.mdtr-table th,
.mdtr-table td {
  border: 1px solid var(--mdtr-border-color);
  padding: 0.35rem 0.55rem;
  vertical-align: top;
  white-space: normal;
}

.mdtr-table th {
  background: var(--background-secondary);
  color: var(--header-primary);
  font-weight: 600;
}

.mdtr-table tr:nth-child(even) td {
  background: color-mix(in srgb, var(--background-secondary) 42%, transparent);
}

.mdtr-inline-code {
  background: var(--background-secondary);
  border-radius: 3px;
  font-family: var(--font-code);
  font-size: 0.875em;
  padding: 0.1em 0.25em;
}
`;
  document.head.appendChild(style);
}

type TextBlock = {
  type: "text";
  text: string;
};

type TableBlock = {
  type: "table";
  table: MarkdownTable;
};

type MarkdownBlock = TextBlock | TableBlock;

type MarkdownTable = {
  header: string[];
  alignments: Array<"left" | "center" | "right">;
  rows: string[][];
  endIndex: number;
};

export function parseMarkdownTableBlocks(markdown: string): MarkdownBlock[] {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const blocks: MarkdownBlock[] = [];
  let pendingText: string[] = [];
  let index = 0;

  while (index < lines.length) {
    const table = parseTableAt(lines, index);

    if (!table) {
      pendingText.push(lines[index]);
      index += 1;
      continue;
    }

    if (pendingText.length > 0) {
      blocks.push({ type: "text", text: trimOuterBlankLines(pendingText).join("\n") });
      pendingText = [];
    }

    blocks.push({ type: "table", table });
    index = table.endIndex;
  }

  if (pendingText.length > 0) {
    blocks.push({ type: "text", text: trimOuterBlankLines(pendingText).join("\n") });
  }

  return blocks.filter((block) => block.type === "table" || block.text.length > 0);
}

function parseTableAt(lines: string[], startIndex: number): MarkdownTable | null {
  if (startIndex + 1 >= lines.length) return null;
  if (isIndentedCodeLine(lines[startIndex]) || isIndentedCodeLine(lines[startIndex + 1])) return null;

  const header = splitTableRow(lines[startIndex]);
  const delimiter = splitTableRow(lines[startIndex + 1]);
  if (!header || !delimiter || header.length !== delimiter.length) return null;

  const alignments = delimiter.map(parseDelimiterCell);
  if (alignments.some((alignment) => alignment === null)) return null;

  const rows: string[][] = [];
  let index = startIndex + 2;

  while (index < lines.length) {
    if (isTableBreak(lines[index])) break;

    const row = splitTableRow(lines[index]);
    if (!row) break;

    rows.push(normalizeBodyRow(row, header.length));
    index += 1;
  }

  return {
    header: normalizeBodyRow(header, header.length),
    alignments: alignments as MarkdownTable["alignments"],
    rows,
    endIndex: index,
  };
}

export function splitTableRow(line: string): string[] | null {
  if (!line || !line.includes("|")) return null;

  const trimmed = line.trim();
  if (trimmed.length === 0) return null;

  const cells: string[] = [];
  let cell = "";
  let escaped = false;
  let sawCellBoundary = trimmed.startsWith("|") || (trimmed.endsWith("|") && !endsWithEscapedPipe(trimmed));
  const start = trimmed.startsWith("|") ? 1 : 0;
  const end = trimmed.endsWith("|") && !endsWithEscapedPipe(trimmed) ? trimmed.length - 1 : trimmed.length;

  for (let index = start; index < end; index += 1) {
    const character = trimmed[index];

    if (escaped) {
      cell += character;
      escaped = false;
      continue;
    }

    if (character === "\\") {
      escaped = true;
      cell += character;
      continue;
    }

    if (character === "|") {
      sawCellBoundary = true;
      cells.push(cell.trim());
      cell = "";
      continue;
    }

    cell += character;
  }

  if (escaped) cell += "\\";
  cells.push(cell.trim());

  return sawCellBoundary && cells.length > 0 ? cells : null;
}

function endsWithEscapedPipe(text: string) {
  let slashCount = 0;

  for (let index = text.length - 2; index >= 0 && text[index] === "\\"; index -= 1) {
    slashCount += 1;
  }

  return slashCount % 2 === 1;
}

function parseDelimiterCell(cell: string): "left" | "center" | "right" | null {
  const trimmed = cell.trim();
  if (!/^:?-{1,}:?$/.test(trimmed)) return null;
  if (trimmed.startsWith(":") && trimmed.endsWith(":")) return "center";
  if (trimmed.endsWith(":")) return "right";
  return "left";
}

function normalizeBodyRow(row: string[], cellCount: number) {
  return Array.from({ length: cellCount }, (_, index) => row[index] || "");
}

function isIndentedCodeLine(line: string) {
  return /^( {4}|\t)/.test(line);
}

function isTableBreak(line: string) {
  const trimmed = line.trim();
  if (trimmed.length === 0) return true;
  return /^(#{1,6}\s|>|[-+*]\s|\d+[.)]\s|`{3,}|~{3,})/.test(trimmed);
}

function trimOuterBlankLines(lines: string[]) {
  const result = [...lines];

  while (result.length > 0 && result[0].trim() === "") result.shift();
  while (result.length > 0 && result[result.length - 1].trim() === "") result.pop();

  return result;
}

function renderBlocks(blocks: MarkdownBlock[]) {
  const fragment = document.createDocumentFragment();

  for (const block of blocks) {
    if (block.type === "text") {
      appendTextBlock(fragment, block.text);
      continue;
    }

    fragment.appendChild(renderTable(block.table));
  }

  return fragment;
}

function appendTextBlock(parent: DocumentFragment, text: string) {
  const lines = text.split("\n");
  const paragraph = document.createElement("div");

  for (let index = 0; index < lines.length; index += 1) {
    if (index > 0) paragraph.appendChild(document.createElement("br"));
    paragraph.appendChild(renderInlineMarkdown(lines[index]));
  }

  parent.appendChild(paragraph);
}

function renderTable(tableData: MarkdownTable) {
  const wrapper = document.createElement("div");
  wrapper.className = "mdtr-table-wrap";

  const table = document.createElement("table");
  table.className = "mdtr-table";

  const thead = document.createElement("thead");
  const headerRow = document.createElement("tr");

  for (let index = 0; index < tableData.header.length; index += 1) {
    const th = document.createElement("th");
    th.style.textAlign = tableData.alignments[index];
    th.appendChild(renderInlineMarkdown(tableData.header[index]));
    headerRow.appendChild(th);
  }

  thead.appendChild(headerRow);
  table.appendChild(thead);

  if (tableData.rows.length > 0) {
    const tbody = document.createElement("tbody");

    for (const row of tableData.rows) {
      const tr = document.createElement("tr");

      for (let index = 0; index < tableData.header.length; index += 1) {
        const td = document.createElement("td");
        td.style.textAlign = tableData.alignments[index];
        td.appendChild(renderInlineMarkdown(row[index]));
        tr.appendChild(td);
      }

      tbody.appendChild(tr);
    }

    table.appendChild(tbody);
  }

  wrapper.appendChild(table);
  return wrapper;
}

function renderInlineMarkdown(source: string) {
  const fragment = document.createDocumentFragment();
  const text = source.replace(/\\\|/g, "|");
  const pattern = /(`([^`]+)`)|(\*\*([^*]+)\*\*)|(~~([^~]+)~~)|(\[([^\]]+)\]\((https?:\/\/[^)\s]+)\))/g;
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > cursor) fragment.appendChild(document.createTextNode(text.slice(cursor, match.index)));

    if (match[2]) {
      const code = document.createElement("code");
      code.className = "mdtr-inline-code";
      code.textContent = match[2];
      fragment.appendChild(code);
    } else if (match[4]) {
      const strong = document.createElement("strong");
      strong.textContent = match[4];
      fragment.appendChild(strong);
    } else if (match[6]) {
      const strike = document.createElement("s");
      strike.textContent = match[6];
      fragment.appendChild(strike);
    } else if (match[8] && match[9]) {
      const link = document.createElement("a");
      link.href = match[9];
      link.rel = "noreferrer noopener";
      link.target = "_blank";
      link.textContent = match[8];
      fragment.appendChild(link);
    }

    cursor = match.index + match[0].length;
  }

  if (cursor < text.length) fragment.appendChild(document.createTextNode(text.slice(cursor)));
  return fragment;
}
