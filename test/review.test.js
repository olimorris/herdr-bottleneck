import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { changes, base, snapshot } from "../mods/Bottleneck/git.js";
import { message, place, sync, saved, upsert, diffOf, followUp, lastRound, deliver, writeReview, readNotes, explainRequest, question, signature } from "../mods/Bottleneck/review.js";
import { reset, calls } from "./support/herdr.js";
import { repo, lines, look } from "./support/repo.js";

beforeEach(reset);

const fileOf = async (r, path, ref = "HEAD") => (await changes(r.root, ref, look)).files.find((f) => f.path === path);
const commentOn = (file, hunk, text) => ({ id: text, path: file.path, anchor: hunk.anchor, start: hunk.start, end: hunk.end, text, diff: diffOf(hunk) });

test("the message lists comments by file then line, each hunk's diff under it, file comments first", () => {
  const text = message([
    { id: "2", path: "src/chat.ts", start: 6, end: 10, text: "Cap the history.\nOr trim it.", diff: [" a", "-b", "+c"] },
    { id: "1", path: "src/chat.ts", file: true, text: "Split this file." },
    { id: "3", path: "a.ts", start: 4, end: 4, text: "Why?", outdated: true, diff: ["+x"] },
  ]);
  assert.equal(text, [
    "Review these comments:",
    "",
    "1. Why?",
    "   a.ts:4 (outdated)",
    "   ```diff",
    "   +x",
    "   ```",
    "",
    "2. Split this file.",
    "   src/chat.ts",
    "",
    "3. Cap the history.",
    "   Or trim it.",
    "   src/chat.ts:6-10",
    "   ```diff",
    "    a",
    "   -b",
    "   +c",
    "   ```",
    "",
    "For each comment above, determine whether it is valid and should be fixed. If so, fix it directly.",
  ].join("\n"));
});

test("a comment follows its hunk as lines move, and goes outdated when the hunk is gone", async (t) => {
  const r = repo(t, { "a.txt": lines(1, 30) });
  r.write("a.txt", lines(1, 30).replace("line 20\n", "twenty\n"));
  let a = await fileOf(r, "a.txt");
  upsert(r.root, commentOn(a, a.hunks[0], "check this"));

  r.write("a.txt", "new first line\n" + r.read("a.txt"));
  let files = (await changes(r.root, "HEAD", look)).files;
  sync(r.root, files);
  let [c] = saved(r.root).comments;
  assert.equal(c.outdated, false);
  assert.equal(c.start, 21, "moved down with the inserted line");
  assert.ok(place(files, saved(r.root).comments).byHunk.size === 1);

  // Its anchor is the hunk's first changed line, the removed "line 20": undoing the change removes the hunk.
  r.write("a.txt", r.read("a.txt").replace("twenty\n", "line 20\n"));
  files = (await changes(r.root, "HEAD", look)).files;
  sync(r.root, files);
  [c] = saved(r.root).comments;
  assert.equal(c.outdated, true);
  assert.equal(place(files, saved(r.root).comments).outdated.get("a.txt").length, 1);
});

test("sending records a snapshot; Since review then shows only later changes and which comments they touched", async (t) => {
  const r = repo(t, { "a.txt": lines(1, 30) });
  r.write("a.txt", lines(1, 30).replace("line 3\n", "three\n").replace("line 25\n", "twenty-five\n"));
  r.write("notes.txt", "draft\n");
  const a = await fileOf(r, "a.txt");
  upsert(r.root, commentOn(a, a.hunks[0], "fix three"));
  upsert(r.root, commentOn(a, a.hunks[1], "fix twenty-five"));
  const indexBefore = r.git("ls-files", "-s");

  assert.equal(await deliver("submit", { address: "t1", program: { name: "Agent" } }, r.root), true);
  assert.equal(calls.hc.length, 1);
  assert.equal(saved(r.root).comments.length, 0, "sent comments are cleared");
  assert.equal(r.git("ls-files", "-s"), indexBefore, "the snapshot doesn't touch the index");

  r.write("a.txt", r.read("a.txt").replace("three\n", "3\n"));
  r.write("notes.txt", "draft\nmore\n");
  const from = await base(r.root, "review", lastRound(r.root));
  assert.equal(from.review, true);
  const files = (await changes(r.root, from.ref, look)).files;
  assert.deepEqual(files.map((f) => f.path).sort(), ["a.txt", "notes.txt"], "untracked files are compared too");
  assert.deepEqual(followUp(files, lastRound(r.root)).map((c) => [c.text, c.changed]), [["fix three", true], ["fix twenty-five", false]]);
});

test("Since review falls back to uncommitted when the snapshot is gone", async (t) => {
  const r = repo(t, { "a.txt": "a\n" });
  const from = await base(r.root, "review", { tree: "0123456789abcdef0123456789abcdef01234567" });
  assert.equal(from.review, undefined);
  assert.match(from.note, /snapshot is gone/);
});

test("a snapshot is a tree of the working tree, untracked files included", async (t) => {
  const r = repo(t, { "a.txt": "a\n" });
  r.write("new.txt", "n\n");
  const tree = await snapshot(r.root);
  assert.match(r.git("ls-tree", "--name-only", tree), /new\.txt/);
  assert.match(r.git("status", "--porcelain"), /\?\? new\.txt/, "still untracked afterwards");
});

test("the markdown file holds the message and its comments stay until it's deleted", async (t) => {
  const r = repo(t, { "a.txt": "a\n" });
  upsert(r.root, { id: "1", path: "a.txt", file: true, text: "Rename this." });
  assert.equal(await writeReview(r.root, r.gitDir), true);
  assert.match(r.read(".git/bottleneck.md"), /^Review these comments:\n\n1\. Rename this\.\n {3}a\.txt\n/);
  assert.deepEqual(saved(r.root).written, ["1"]);
  assert.equal(saved(r.root).comments.length, 1);
});

test("explain and ask messages name the hunks and carry the diff", () => {
  const hunk = { start: 6, end: 10, lines: [{ kind: " ", text: "a" }, { kind: "+", text: "b" }] }, file = { path: "src/chat.ts" };
  assert.match(explainRequest("/r/.git", [{ file, hunk }]), /\/r\/\.git\/bottleneck-notes\.json[\s\S]*\nsrc\/chat\.ts:6-10$/);
  assert.equal(question(file, hunk, " why b? "), "A question about this change in src/chat.ts:6-10:\n\n```diff\n a\n+b\n```\n\nwhy b?\n\nAnswer the question. Don't change any code unless I ask you to.");
});

test("agent notes are read when well formed and ignored otherwise", async (t) => {
  const r = repo(t, { "a.txt": "a\n" }), path = join(r.gitDir, "bottleneck-notes.json");
  assert.deepEqual(await readNotes(r.gitDir), []);
  writeFileSync(path, JSON.stringify([{ path: "a.txt", start: 3, note: "keeps it short" }, { path: "b.txt" }]));
  assert.deepEqual(await readNotes(r.gitDir), [{ path: "a.txt", start: 3, note: "keeps it short" }]);
  writeFileSync(path, "not json");
  assert.deepEqual(await readNotes(r.gitDir), []);
});

test("a file's signature changes when its diff does", async (t) => {
  const r = repo(t, { "a.txt": lines(1, 10) });
  r.write("a.txt", lines(1, 10).replace("line 2\n", "two\n"));
  const first = signature(await fileOf(r, "a.txt"));
  assert.equal(signature(await fileOf(r, "a.txt")), first);
  r.write("a.txt", r.read("a.txt").replace("two\n", "TWO\n"));
  assert.notEqual(signature(await fileOf(r, "a.txt")), first);
});
