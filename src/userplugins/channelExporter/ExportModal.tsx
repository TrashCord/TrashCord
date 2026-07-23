import { useState } from "@webpack/common";
import { formatTxt, parseDate, triggerDownload } from "./utils";
import { fetchMessages } from "./fetcher";
import { ModalCloseButton, ModalContent, ModalFooter, ModalHeader, ModalRoot } from "@utils/modal";
import { Button, Forms, Text, TextInput } from "@webpack/common";
import { Settings } from "@api/Settings";

// persist settings under vencord plugin settings
function getSetting<T>(key: string, fallback: T): T {
    return (Settings.plugins.ChannelExporter as any)?.[key] ?? fallback;
}
function setSetting(key: string, value: any) {
    if (!Settings.plugins.ChannelExporter) (Settings.plugins.ChannelExporter as any) = {};
    (Settings.plugins.ChannelExporter as any)[key] = value;
}

type Format = "zip" | "txt" | "json";

async function downloadAsZip(txtContent: string, jsonContent: string, baseName: string) {
    // build a zip file with the exported files
    function str2bytes(str: string): Uint8Array { return new TextEncoder().encode(str); }

    function u32(n: number): Uint8Array {
        const b = new Uint8Array(4);
        new DataView(b.buffer).setUint32(0, n, true);
        return b;
    }

    function u16(n: number): Uint8Array {
        const b = new Uint8Array(2);
        new DataView(b.buffer).setUint16(0, n, true);
        return b;
    }

    function crc32(data: Uint8Array): number {
        const table = new Uint32Array(256);
        for (let i = 0; i < 256; i++) {
            let c = i;
            for (let j = 0; j < 8; j++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
            table[i] = c;
        }
        let crc = 0xffffffff;
        for (const byte of data) crc = table[(crc ^ byte) & 0xff] ^ (crc >>> 8);
        return (crc ^ 0xffffffff) >>> 0;
    }

    function localFileHeader(name: Uint8Array, data: Uint8Array, crc: number): Uint8Array {
        return concat([
            new Uint8Array([0x50, 0x4b, 0x03, 0x04]), // local file signature
            u16(20),           // version needed
            u16(0),            // flags
            u16(0),            // compression (stored) (🗜️)
            u16(0), u16(0),    // mod time, mod date
            u32(crc),          // crc32
            u32(data.length),  // compressed (🗜️) size
            u32(data.length),  // uncompressed (🗜️) size
            u16(name.length),  // filename length
            u16(0),            // extra field length
            name,
            data,
        ]);
    }

    function centralDir(name: Uint8Array, data: Uint8Array, crc: number, offset: number): Uint8Array {
        return concat([
            new Uint8Array([0x50, 0x4b, 0x01, 0x02]), // central dir signature
            u16(20), u16(20),  // version made by, version needed
            u16(0),            // flags
            u16(0),            // compression (🗜️)
            u16(0), u16(0),    // mod time, mod date
            u32(crc),          // crc32
            u32(data.length),  // compressed (🗜️) size
            u32(data.length),  // uncompressed (🗜️) size
            u16(name.length),  // filename length
            u16(0),            // extra field length
            u16(0),            // file comment length
            u16(0),            // disk number start
            u16(0),            // internal attrs
            u32(0),            // external attrs
            u32(offset),       // local header offset
            name,
        ]);
    }

    function endOfCentralDir(count: number, centralSize: number, centralOffset: number): Uint8Array {
        return concat([
            new Uint8Array([0x50, 0x4b, 0x05, 0x06]), // end of central dir signature
            u16(0), u16(0),            // disk number, disk with central dir
            u16(count), u16(count),    // entries on disk, total entries
            u32(centralSize),          // central dir size
            u32(centralOffset),        // central dir offset
            u16(0),                    // comment length
        ]);
    }

    function concat(parts: Uint8Array[]): Uint8Array {
        const total = parts.reduce((s, p) => s + p.length, 0);
        const out = new Uint8Array(new ArrayBuffer(total));
        let offset = 0;
        for (const p of parts) {
            out.set(new Uint8Array(p.buffer, p.byteOffset, p.byteLength), offset);
            offset += p.byteLength;
        }
        return out;
    }

    const txtName = str2bytes(`${baseName}.txt`);
    const jsonName = str2bytes(`${baseName}.json`);
    const txtData = str2bytes(txtContent);
    const jsonData = str2bytes(jsonContent);
    const txtCrc = crc32(txtData);
    const jsonCrc = crc32(jsonData);

    const local1 = localFileHeader(txtName, txtData, txtCrc);
    const local2 = localFileHeader(jsonName, jsonData, jsonCrc);

    const offset1 = 0;
    const offset2 = local1.length;

    const central1 = centralDir(txtName, txtData, txtCrc, offset1);
    const central2 = centralDir(jsonName, jsonData, jsonCrc, offset2);

    const centralOffset = local1.length + local2.length;
    const centralSize = central1.length + central2.length;
    const end = endOfCentralDir(2, centralSize, centralOffset);

    const zip = concat([local1, local2, central1, central2, end]);

    triggerDownload(`${baseName}.zip`, zip, "application/zip");
}

const FORMAT_OPTIONS: { label: string; value: Format; description: string; }[] = [
    { label: "ZIP (both files)", value: "zip", description: "Downloads a .zip containing both .txt and .json" },
    { label: "Text only", value: "txt", description: "Human readable .txt file" },
    { label: "JSON only", value: "json", description: "Raw JSON data" },
];

function RadioButton({ selected }: { selected: boolean; }) {
    return (
        <div style={{
            width: "18px",
            height: "18px",
            minWidth: "18px",
            flexShrink: 0,
            borderRadius: "50%",
            backgroundColor: selected ? "var(--brand-experiment)" : "transparent",
            border: `2px solid ${selected ? "var(--background-secondary)" : "var(--interactive-muted)"}`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            boxSizing: "border-box",
            transition: "border 0.1s, background-color 0.1s",
        }}>
            <div style={{
                width: "10px",
                height: "10px",
                borderRadius: "50%",
                backgroundColor: selected ? "white" : "transparent",
                transition: "background-color 0.1s",
                flexShrink: 0,
            }} />
        </div>
    );
}

export function ExportModal({ modalProps, channelId, channelTitle }: {
    modalProps: any;
    channelId: string;
    channelTitle: string;
}) {
    const [limit, setLimit] = useState<string>(() => getSetting("limit", "100"));
    const [since, setSince] = useState<string>(() => getSetting("since", ""));
    const [format, setFormat] = useState<Format>(() => getSetting("format", "zip"));
    const [status, setStatus] = useState<string | null>(null);
    const [running, setRunning] = useState(false);

    function handleLimitChange(v: string) { setLimit(v); setSetting("limit", v); }
    function handleSinceChange(v: string) { setSince(v); setSetting("since", v); }
    function handleFormatChange(v: Format) { setFormat(v); setSetting("format", v); }

    async function handleExport() {
        const parsedLimit = parseInt(limit, 10);
        if (isNaN(parsedLimit) || parsedLimit < 1) {
            setStatus("Limit must be a positive number.");
            return;
        }

        let sinceDate: Date | null = null;
        if (since.trim()) {
            sinceDate = parseDate(since.trim());
            if (!sinceDate) {
                setStatus("Invalid date. Use: YYYY-MM-DD or YYYY-MM-DD HH:MM");
                return;
            }
        }

        setRunning(true);
        setStatus("Fetching messages...");

        try {
            const messages = await fetchMessages(channelId, parsedLimit, sinceDate);
            const ts = new Date().toISOString().slice(0, 19).replace("T", "_").replace(/:/g, "-");
            const base = `export_${channelTitle.replace(/[^a-z0-9]/gi, "_")}_${ts}`;

            if (format === "zip") {
                await downloadAsZip(
                    formatTxt(messages, channelTitle),
                    JSON.stringify(messages, null, 2),
                    base
                );
            } else if (format === "txt") {
                triggerDownload(`${base}.txt`, formatTxt(messages, channelTitle), "text/plain");
            } else {
                triggerDownload(`${base}.json`, JSON.stringify(messages, null, 2), "application/json");
            }

            setStatus(`Exported ${messages.length} messages!`);
        } catch (e: any) {
            setStatus(`Error: ${e?.message ?? String(e)}`);
        } finally {
            setRunning(false);
        }
    }

    return (
        <ModalRoot {...modalProps}>
            <ModalHeader separator={false}>
                <Text variant="heading-lg/semibold" style={{ flexGrow: 1 }}>
                    Export {channelTitle}
                </Text>
                <ModalCloseButton onClick={modalProps.onClose} />
            </ModalHeader>

            <ModalContent>
                <div style={{
                    padding: "16px 0",
                    display: "flex",
                    flexDirection: "column",
                    gap: "16px",
                }}>
                    <div>
                        <Forms.FormTitle tag="h5">Message Limit</Forms.FormTitle>
                        <TextInput
                            value={limit}
                            onChange={handleLimitChange}
                            placeholder="e.g. 100"
                            disabled={running}
                        />
                        <Forms.FormText style={{ marginTop: "4px" }}>
                            Number of most recent messages to export.
                        </Forms.FormText>
                    </div>

                    <div>
                        <Forms.FormTitle tag="h5">Since (optional)</Forms.FormTitle>
                        <TextInput
                            value={since}
                            onChange={handleSinceChange}
                            placeholder="e.g. 2024-03-01 or 2024-03-01 14:30"
                            disabled={running}
                        />
                        <Forms.FormText style={{ marginTop: "4px" }}>
                            Only export messages after this date/time (UTC).
                        </Forms.FormText>
                    </div>

                    <div>
                        <Forms.FormTitle tag="h5">Export Format</Forms.FormTitle>
                        <div style={{ display: "flex", flexDirection: "column", gap: "6px", marginTop: "4px" }}>
                            {FORMAT_OPTIONS.map(opt => (
                                <div
                                    key={opt.value}
                                    onClick={() => !running && handleFormatChange(opt.value)}
                                    style={{
                                        display: "flex",
                                        alignItems: "center",
                                        gap: "10px",
                                        padding: "8px 12px",
                                        borderRadius: "4px",
                                        cursor: running ? "not-allowed" : "pointer",

                                        background: format === opt.value
                                            ? "var(--brand-experiment-15a)"
                                            : "var(--background-secondary)",

                                        border: `1px solid ${format === opt.value
                                            ? "var(--brand-experiment)"
                                            : "var(--background-tertiary)"}`,

                                        transition: "background 0.1s, border 0.1s",
                                        opacity: running ? 0.5 : 1,
                                        userSelect: "none",
                                    }}
                                >
                                    <RadioButton selected={format === opt.value} />
                                    <div style={{ display: "flex", flexDirection: "column", gap: "1px" }}>
                                        <Text variant="text-sm/semibold">{opt.label}</Text>
                                        <Text variant="text-xs/normal" style={{ color: "var(--text-muted)" }}>
                                            {opt.description}
                                        </Text>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>

                    {status && (
                        <div style={{
                            padding: "10px 12px",
                            borderRadius: "4px",
                            background: "var(--background-secondary)",
                            border: "1px solid var(--background-tertiary)",
                        }}>
                            <Text variant="text-sm/normal">{status}</Text>
                        </div>
                    )}

                </div>
            </ModalContent>

            <ModalFooter>
                <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end", width: "100%" }}>
                    <Button
                        onClick={modalProps.onClose}
                        color={Button.Colors.TRANSPARENT}
                        look={Button.Looks.LINK}
                        disabled={running}
                    >
                        Cancel
                    </Button>
                    <Button
                        onClick={handleExport}
                        disabled={running}
                        color={Button.Colors.BRAND}
                    >
                        {running ? "Exporting..." : "Export"}
                    </Button>
                </div>
            </ModalFooter>
        </ModalRoot>
    );
}