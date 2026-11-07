import { test } from "node:test";
import assert from "node:assert/strict";
import { submitted } from "../mods/Bottleneck/ui.js";
import { iconFor } from "../mods/Bottleneck/icons.js";

// A text area that, like Herdr's, tells its listeners after every edit.
function textArea() {
  let value = "", listeners = [];
  return {
    value: () => value,
    set_value: (v) => { value = v; },
    on: (_event, f) => listeners.push(f),
    type: (v) => { value = v; listeners.forEach((f) => f()); },
  };
}

test("cmd-enter's line break is taken back out, wherever the cursor was", () => {
  const area = textArea(), text = submitted(area);
  area.type("fix the");
  area.type("fix the bug");
  area.type("fix the\n bug");
  assert.equal(text(), "fix the bug");
  assert.equal(area.value(), "fix the bug");
});

test("line breaks you typed are kept", () => {
  const area = textArea(), text = submitted(area);
  area.type("one\n");
  area.type("one\ntwo");
  assert.equal(text(), "one\ntwo");
});

test("files get the icon for their name, then their extension, then a plain document", () => {
  assert.equal(iconFor("plugin/ai.lua"), "mods/Bottleneck/icons/lua.svg");
  assert.equal(iconFor("package.json"), "mods/Bottleneck/icons/nodejs.svg");
  assert.equal(iconFor("types/index.d.ts"), "mods/Bottleneck/icons/typescript-def.svg");
  assert.equal(iconFor("Dockerfile"), "mods/Bottleneck/icons/docker.svg");
  assert.equal(iconFor("LICENSE-thing.xyz"), "mods/Bottleneck/icons/document.svg");
});
