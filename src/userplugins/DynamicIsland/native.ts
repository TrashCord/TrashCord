/*
 * TrashCord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { createHash } from "crypto";
import type { IpcMainInvokeEvent, WebContents } from "electron";
import { createServer, type Server } from "http";
import type { Duplex } from "stream";

export interface SoundCloudTrack {
    title: string;
    artist: string;
    cover: string;
    playing: boolean;
}

interface Player extends SoundCloudTrack {
    name: string;
    stopped: boolean;
}

const MAX_PAYLOAD = 16_384;
const GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

class Client {
    open = true;

    constructor(readonly socket: Duplex) { }

    write(opcode: number, payload: Buffer) {
        if (!this.open) return;
        const length = payload.length;
        let header: Buffer;
        if (length < 126) {
            header = Buffer.from([0x80 | opcode, length]);
        } else {
            header = Buffer.alloc(4);
            header[0] = 0x80 | opcode;
            header[1] = 126;
            header.writeUInt16BE(length, 2);
        }
        this.socket.write(Buffer.concat([header, payload]));
    }

    send(text: string) {
        this.write(1, Buffer.from(text));
    }

    close(code: number) {
        if (!this.open) return;
        const payload = Buffer.alloc(2);
        payload.writeUInt16BE(code);
        this.write(8, payload);
        this.open = false;
        this.socket.end();
    }

    terminate() {
        this.open = false;
        this.socket.destroy();
    }
}

let server: Server | undefined;
let owner: WebContents | undefined;
let error: string | null = null;
let pending = Promise.resolve();
const players = new Map<Client, Player>();
const consumers = new Set<string>();

function snapshot() {
    const active = [...players.values()].filter(player => player.name === "SoundCloud" && player.title && !player.stopped);
    const player = active.find(player => player.playing) ?? active[0];
    const track: SoundCloudTrack | null = player
        ? { title: player.title, artist: player.artist, cover: player.cover, playing: player.playing }
        : null;
    return { track, error };
}

function closeServer(): Promise<void> {
    const current = server;
    server = undefined;
    players.forEach((_, client) => client.terminate());
    players.clear();
    if (owner) {
        owner.removeListener("destroyed", stopOnExit);
        owner.removeListener("render-process-gone", stopOnExit);
        owner = undefined;
    }
    return new Promise(resolve => {
        if (!current) return resolve();
        current.closeAllConnections?.();
        current.close(() => resolve());
    });
}

function stopOnExit() {
    consumers.clear();
    pending = pending.then(closeServer);
}

function updatePlayer(player: Player, message: string) {
    const separator = message.indexOf(" ");
    if (separator < 0) return;
    const key = message.slice(0, separator);
    const value = message.slice(separator + 1);
    switch (key) {
        case "PLAYER_NAME":
            player.name = value.slice(0, 128);
            break;
        case "TITLE":
            player.title = value.slice(0, 512);
            break;
        case "ARTIST":
            player.artist = value.slice(0, 512);
            break;
        case "STATE":
            player.playing = value === "PLAYING";
            player.stopped = value !== "PLAYING" && value !== "PAUSED";
            break;
        case "COVER_URL": {
            player.cover = "";
            if (value.length > 2048 || !URL.canParse(value)) break;
            const url = new URL(value);
            if (url.protocol === "https:" && /^i\d\.sndcdn\.com$/.test(url.hostname) && !url.port && !url.username && !url.password)
                player.cover = url.href;
            break;
        }
    }
}

function isAllowedOrigin(origin: string) {
    return origin === "chrome-extension://jfakgfcdgpghbbefmdfjkbdlibjgnbli"
        || /^moz-extension:\/\/[a-f0-9-]{36}$/.test(origin);
}

function attach(socket: Duplex, head: Buffer) {
    const client = new Client(socket);
    const player: Player = { name: "", title: "", artist: "", cover: "", playing: false, stopped: true };

    if (players.size >= 4) {
        client.close(1008);
        return;
    }

    players.set(client, player);
    client.send("ADAPTER_VERSION 1.0.0;WNPLIB_REVISION 2");

    let buffer: Buffer = Buffer.alloc(0);
    let fragments: Buffer[] = [];
    let fragmentSize = 0;

    const handle = (opcode: number, fin: boolean, payload: Buffer) => {
        switch (opcode) {
            case 8:
                client.close(1000);
                return;
            case 9:
                client.write(10, payload);
                return;
            case 10:
                return;
            case 2:
                client.close(1003);
                return;
            case 1:
            case 0: {
                if (opcode === 1) {
                    fragments = [];
                    fragmentSize = 0;
                } else if (fragments.length === 0) {
                    client.close(1002);
                    return;
                }
                fragmentSize += payload.length;
                if (fragmentSize > MAX_PAYLOAD) {
                    client.close(1009);
                    return;
                }
                fragments.push(payload);
                if (!fin) return;
                const text = Buffer.concat(fragments).toString();
                fragments = [];
                fragmentSize = 0;
                updatePlayer(player, text);
                return;
            }
            default:
                client.close(1002);
        }
    };

    const process = (chunk: Buffer) => {
        if (!client.open) return;
        buffer = buffer.length ? Buffer.concat([buffer, chunk]) : chunk;
        while (client.open && buffer.length >= 2) {
            const fin = (buffer[0] & 0x80) !== 0;
            const opcode = buffer[0] & 0x0f;
            const masked = (buffer[1] & 0x80) !== 0;
            let length = buffer[1] & 0x7f;
            let offset = 2;
            if (length === 126) {
                if (buffer.length < 4) return;
                length = buffer.readUInt16BE(2);
                offset = 4;
            } else if (length === 127) {
                client.close(1009);
                return;
            }
            if (!masked) {
                client.close(1002);
                return;
            }
            if (length > MAX_PAYLOAD) {
                client.close(1009);
                return;
            }
            const end = offset + 4 + length;
            if (buffer.length < end) return;
            const mask = buffer.subarray(offset, offset + 4);
            const payload = Buffer.from(buffer.subarray(offset + 4, end));
            for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
            buffer = buffer.subarray(end);
            handle(opcode, fin, payload);
        }
    };

    socket.on("data", process);
    socket.on("close", () => {
        client.open = false;
        players.delete(client);
    });
    socket.on("error", () => {
        players.delete(client);
        client.terminate();
    });
    if (head.length) process(head);
}

function createWebSocketServer(): Server {
    const current = createServer((_, res) => {
        res.writeHead(426, { Connection: "close" });
        res.end();
    });
    current.on("upgrade", (req, socket, head) => {
        socket.on("error", () => socket.destroy());
        const key = req.headers["sec-websocket-key"];
        const valid = typeof key === "string"
            && req.headers.upgrade?.toLowerCase() === "websocket"
            && req.headers["sec-websocket-version"] === "13"
            && isAllowedOrigin(req.headers.origin ?? "");
        if (!valid) {
            socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
            socket.destroy();
            return;
        }
        const accept = createHash("sha1").update(key + GUID).digest("base64");
        socket.setNoDelay(true);
        socket.write(
            "HTTP/1.1 101 Switching Protocols\r\n"
            + "Upgrade: websocket\r\n"
            + "Connection: Upgrade\r\n"
            + `Sec-WebSocket-Accept: ${accept}\r\n\r\n`
        );
        attach(socket, head);
    });
    return current;
}

export function configure(event: IpcMainInvokeEvent, enabled: unknown, consumer: unknown = "island") {
    if (typeof enabled !== "boolean") return Promise.resolve({ track: null, error: "Invalid SoundCloud setting." });
    if (consumer !== "island" && consumer !== "rpc") return Promise.resolve({ track: null, error: "Invalid SoundCloud consumer." });

    const result = pending.then(async () => {
        if (enabled) consumers.add(consumer);
        else consumers.delete(consumer);

        if (consumers.size === 0) {
            await closeServer();
            error = null;
        } else if (!server) {
            error = null;
            owner = event.sender;
            owner.once("destroyed", stopOnExit);
            owner.once("render-process-gone", stopOnExit);
            await new Promise<void>(resolve => {
                const current = createWebSocketServer();
                server = current;
                current.once("listening", resolve);
                current.on("error", () => {
                    error = "Could not start WebNowPlaying on port 8975. Close any other adapter using this port, then toggle SoundCloud off and on.";
                    resolve();
                });
                current.listen(8975, "127.0.0.1");
            });
        }
        return snapshot();
    });
    pending = result.then(() => {});
    return result;
}

export function getState(_: IpcMainInvokeEvent) {
    return snapshot();
}

export function control(_: IpcMainInvokeEvent, action: unknown) {
    if (action !== "play" && action !== "pause" && action !== "previous" && action !== "next") return false;

    const active = [...players].filter(([, player]) => player.name === "SoundCloud" && player.title && !player.stopped);
    const selected = active.find(([, player]) => player.playing) ?? active[0];
    if (!selected || !selected[0].open) return false;

    const command = {
        play: "TRY_SET_STATE PLAYING",
        pause: "TRY_SET_STATE PAUSED",
        previous: "TRY_SKIP_PREVIOUS",
        next: "TRY_SKIP_NEXT"
    }[action];
    selected[0].send(command);
    return true;
}