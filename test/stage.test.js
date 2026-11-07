import { test } from "node:test";
import assert from "node:assert/strict";
import { changes } from "../mods/Bottleneck/git.js";
import { stageLines, stageFile, discardLines, discardFile } from "../mods/Bottleneck/stage.js";
import { commit } from "../mods/Bottleneck/ship.js";
import { repo, lines, look } from "./support/repo.js";

const fileOf = async (r, path) => (await changes(r.root, "HEAD", look)).files.find((f) => f.path === path);
const keysOf = (hunks) => new Set(hunks.flatMap((h) => h.lines.map((l) => l.key)).filter(Boolean));
const without = (all, some) => new Set([...all].filter((k) => !some.has(k)));
const changed = (diff) => diff.split("\n").filter((l) => /^[-+](?![-+])/.test(l));

function twoHunks(t) {
  const r = repo(t, { "a.txt": lines(1, 30) });
  r.write("a.txt", lines(1, 30).replace("line 3\n", "three\n").replace("line 25\n", "twenty-five\n"));
  return r;
}

test("staging one hunk puts exactly its lines in the index", async (t) => {
  const r = twoHunks(t), a = await fileOf(r, "a.txt");
  await stageLines(r.root, r.gitDir, a, keysOf([a.hunks[1]]));
  assert.deepEqual(changed(r.git("diff", "--cached", "-U0")), ["-line 25", "+twenty-five"]);
  assert.deepEqual(changed(r.git("diff", "-U0")), ["-line 3", "+three"]);
});

test("unstaging a hunk takes only it back out", async (t) => {
  const r = twoHunks(t);
  r.git("add", "a.txt");
  const a = await fileOf(r, "a.txt");
  await stageLines(r.root, r.gitDir, a, keysOf([a.hunks[0]]));
  assert.deepEqual(changed(r.git("diff", "--cached", "-U0")), ["-line 3", "+three"]);
});

test("staging the middle part of a new file, then unstaging it, leaves the index as it was", async (t) => {
  const r = repo(t, { "a.txt": "a\n" });
  r.write("steps.ts", lines(1, 120, (n) => (n % 10 === 0 ? "" : `step ${n}`)));
  let s = await fileOf(r, "steps.ts");
  await stageLines(r.root, r.gitDir, s, keysOf([s.hunks[1]]));
  const staged = r.git("show", ":steps.ts").split("\n").filter(Boolean);
  assert.ok(staged.length > 0 && staged.every((l) => s.hunks[1].lines.some((h) => h.text === l)), "only part 2 is in the index");
  s = await fileOf(r, "steps.ts");
  await stageLines(r.root, r.gitDir, s, new Set());
  assert.equal(r.git("ls-files", "steps.ts"), "", "the new file left the index");
});

test("repeated lines like closing braces don't get mixed up", async (t) => {
  // Each function far enough from the next that git gives every change its own hunk, all ending in the same "}".
  const block = (n) => `function f${n}() {\n  return ${n};\n}\n${"// spacer\n".repeat(8)}`;
  const before = [1, 2, 3, 4, 5].map(block).join("\n");
  const r = repo(t, { "f.js": before });
  r.write("f.js", [1, 2, 3, 4, 5].map((n) => block(n).replace(`return ${n}`, `return ${n * 10}`)).join("\n"));
  const f = await fileOf(r, "f.js");
  const third = f.hunks.find((h) => h.lines.some((l) => l.text.includes("30")));
  await stageLines(r.root, r.gitDir, f, keysOf([third]));
  assert.deepEqual(changed(r.git("diff", "--cached", "-U0")), ["-  return 3;", "+  return 30;"]);
});

test("staging a deletion in a file with no trailing newline keeps it that way", async (t) => {
  const r = repo(t, { "a.txt": "one\ntwo\nthree" });
  r.write("a.txt", "one\nthree");
  const a = await fileOf(r, "a.txt");
  await stageLines(r.root, r.gitDir, a, keysOf(a.hunks));
  assert.equal(r.git("show", ":a.txt"), "one\nthree");
});

test("a whole file stages and unstages", async (t) => {
  const r = twoHunks(t);
  await stageFile(r.root, "a.txt", true);
  assert.equal(r.git("diff", "--name-only"), "");
  await stageFile(r.root, "a.txt", false);
  assert.equal(r.git("diff", "--cached", "--name-only"), "");
});

test("discarding a hunk reverts only it in the working tree", async (t) => {
  const r = twoHunks(t), a = await fileOf(r, "a.txt");
  await discardLines(r.root, a, without(keysOf(a.hunks), keysOf([a.hunks[0]])));
  assert.deepEqual(changed(r.git("diff", "-U0")), ["-line 25", "+twenty-five"]);
});

test("discarding refuses when the file changed since the diff was read", async (t) => {
  const r = twoHunks(t), a = await fileOf(r, "a.txt");
  r.write("a.txt", "the agent rewrote this\n" + r.read("a.txt"));
  await assert.rejects(discardLines(r.root, a, new Set()), /changed since the diff was read/);
  assert.match(r.read("a.txt"), /^the agent rewrote this/);
});

test("discarding a whole file restores it, staged changes included", async (t) => {
  const r = twoHunks(t);
  r.git("add", "a.txt");
  await discardFile(r.root, await fileOf(r, "a.txt"));
  assert.equal(r.read("a.txt"), lines(1, 30));
  assert.equal(r.git("status", "--porcelain"), "");
});

test("discarding an untracked file deletes it", async (t) => {
  const r = repo(t, { "a.txt": "a\n" });
  r.write("scratch.txt", "x\n");
  await discardFile(r.root, await fileOf(r, "scratch.txt"));
  assert.equal(r.exists("scratch.txt"), false);
});

test("commit uses the title and body as given", async (t) => {
  const r = twoHunks(t);
  r.git("add", "a.txt");
  await commit(r.root, "fix: numbers\n\nSpell two of them out.");
  assert.equal(r.git("log", "-1", "--format=%B").trim(), "fix: numbers\n\nSpell two of them out.");
});

test("staging refuses when HEAD moved since the diff was read", async (t) => {
  const r = twoHunks(t), a = await fileOf(r, "a.txt");
  r.write("a.txt", "inserted\n" + lines(1, 30));
  r.commit("elsewhere");
  r.write("a.txt", lines(1, 30).replace("line 3\n", "three\n").replace("line 25\n", "twenty-five\n"));
  await assert.rejects(stageLines(r.root, r.gitDir, a, keysOf([a.hunks[0]])), /changed since the diff was read/);
});
