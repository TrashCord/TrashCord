/*
 * TaskbarStatus, a Vencord plugin
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Run with: node --test merge.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";

// @ts-expect-error node's test runner needs the .ts extension, Vencord's tsc rejects it
import { mergeButtons, type Status } from "./merge.ts";

const status: Record<Status, string> = { online: "S:online", idle: "S:idle", dnd: "S:dnd", invisible: "S:invisible" };
const call = (n: number) => ["video", "mute", "deafen", "disconnect"].slice(0, n);

test("no call: four status buttons in fixed order, current included", () => {
    assert.deepEqual(mergeButtons([], status, "dnd"), ["S:online", "S:idle", "S:dnd", "S:invisible"]);
});

test("3 call buttons: 7 total fits, nothing dropped", () => {
    assert.deepEqual(mergeButtons(call(3), status, "idle"), [
        "video", "mute", "deafen", "S:online", "S:idle", "S:dnd", "S:invisible"
    ]);
});

test("4 call buttons: 8 total, current status dropped to fit 7", () => {
    assert.deepEqual(mergeButtons(call(4), status, "idle"), [
        "video", "mute", "deafen", "disconnect", "S:online", "S:dnd", "S:invisible"
    ]);
});

test("never exceeds 7 even with unexpected input", () => {
    const five = [...call(4), "extra"];
    assert.equal(mergeButtons(five, status, "idle").length, 7);
    assert.equal(mergeButtons(call(4), status, undefined as unknown as Status).length, 7);
});

test("never exceeds 7 and always keeps every Discord button", () => {
    for (const cur of ["online", "idle", "dnd", "invisible"] as const) {
        const out = mergeButtons(call(4), status, cur);
        assert.equal(out.length, 7);
        assert.deepEqual(out.slice(0, 4), call(4));
    }
});
