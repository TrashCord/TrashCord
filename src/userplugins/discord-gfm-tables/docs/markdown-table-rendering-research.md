# Markdown Table Rendering Research

## Scope

This plugin targets GitHub-Flavored Markdown pipe tables because that is the table dialect users most often expect when AI tools emit Markdown in chat.

## GFM Table Rules Implemented

- A table has one header row, one delimiter row, and zero or more body rows.
- Rows are split by unescaped pipe characters.
- Leading and trailing pipes are optional, but recommended by the spec.
- Spaces around cell content are trimmed.
- The delimiter row must have the same number of cells as the header row.
- Delimiter cells contain hyphens with optional leading/trailing colons:
  - `---` or `:---` means left alignment.
  - `:---:` means center alignment.
  - `---:` means right alignment.
- Body rows may have fewer cells than the header; missing cells become empty.
- Body rows may have more cells than the header; excess cells are ignored.
- A table can have no body rows.
- Escaped pipes such as `\|` are literal cell content.

## Discord/Vencord Constraints

Discord does not expose a stable public Markdown renderer extension point. The plugin therefore uses a DOM post-processing approach:

1. Watch rendered message content nodes with a `MutationObserver`.
2. Read visible message text.
3. Detect GFM-style table blocks.
4. Replace only messages that contain recognized tables with rendered HTML tables.

This is intentionally conservative. Messages without valid GFM tables are left untouched.

## Rendering Choice

The OpenCode issue threads discuss ASCII table formatting, truncation, wrapping, and horizontal overflow. Discord is a browser UI, so the plugin renders actual HTML tables and wraps them in an `overflow-x: auto` container. That keeps all content available without truncating columns.

## References Checked

- GitHub Flavored Markdown specification, table extension.
- GitHub Docs, "Organizing information with tables".
- openai/codex issue #14308, requesting GFM table rendering instead of raw pipe text.
- anomalyco/opencode issue #3845, including discussion of overflow, truncation, and formatting tradeoffs.
- anomalyco/opencode issue #4988, duplicate feature request confirming the same pain point.
- franlol/opencode-md-table-formatter, useful as a terminal-oriented formatter reference, but not copied because Discord can render real tables.
