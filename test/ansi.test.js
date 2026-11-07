import { test } from "node:test";
import assert from "node:assert/strict";
import { spans, strip } from "../mods/Bottleneck/ansi.js";

const ansi = Array.from({ length: 16 }, (_, i) => `#0000${i.toString(16).padStart(2, "0")}`);

test("foreground colors split a line into spans; a background marks the words that changed", () => {
  const line = "\x1b[38;2;249;38;114mlocal\x1b[0m \x1b[38;2;248;248;242;48;2;1;1;1mx\x1b[0m = 1";
  assert.deepEqual(spans(line, ansi), [
    { text: "local", color: "#f92672", emph: false },
    { text: " ", color: null, emph: false },
    { text: "x", color: "#f8f8f2", emph: true },
    { text: " = 1", color: null, emph: false },
  ]);
  assert.equal(strip(line), "local x = 1");
});

test("basic and 256 colors map onto the theme's", () => {
  assert.deepEqual(spans("\x1b[31ma\x1b[38;5;2mb\x1b[39mc", ansi).map((s) => s.color), [ansi[1], ansi[2], null]);
});
