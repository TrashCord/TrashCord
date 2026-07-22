import type { Message } from "./types";

export function parseDate(str: string): Date | null {
    const formats = [
        /^\d{4}-\d{2}-\d{2}$/,
        /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/,
        /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/,
    ];
    for (const fmt of formats) {
        if (fmt.test(str))
            return new Date(str.replace(" ", "T") + (str.length === 10 ? "T00:00:00Z" : "Z"));
    }
    return null;
}

export function formatTxt(messages: Message[], channelName: string): string {
    const lines = [
        `Channel: #${channelName}`,
        `Exported: ${new Date().toISOString().replace("T", " ").slice(0, 19)} UTC`,
        `Total messages: ${messages.length}`,
        "=".repeat(60),
        "",
    ];

    for (const m of messages) {
        const ts = new Date(m.timestamp).toISOString().replace("T", " ").slice(0, 19) + " UTC";
        const author = m.author.discriminator === "0" ? m.author.username : `${m.author.username}#${m.author.discriminator}`;
        lines.push(`[${ts}] ${author}`);
        if (m.content) lines.push(`    ${m.content}`);
        for (const att of m.attachments) lines.push(`    ${att.filename}: ${att.url}`);
        if (m.edited_timestamp) lines.push(`    (edited)`);
        lines.push("");
    }

    return lines.join("\n");
}

// accepts both string and binary data
export function triggerDownload(filename: string, content: string | Uint8Array, mime: string) {
    const blob = new Blob([content as BlobPart], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
}