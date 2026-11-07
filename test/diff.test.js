import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { changes, base, staged, inIndex, touches } from "../mods/Bottleneck/git.js";
import { repo, lines, look } from "./support/repo.js";

const file = (files, path) => files.find((f) => f.path === path);

test("a modified file has one hunk per change, numbered in the new file", async (t) => {
  const r = repo(t, { "a.txt": lines(1, 30) });
  r.write("a.txt", lines(1, 30).replace("line 3\n", "three\n").replace("line 25\n", "twenty-five\n"));
  const a = file((await changes(r.root, "HEAD", look)).files, "a.txt");
  assert.equal(a.status, "M");
  assert.equal(a.add, 2);
  assert.equal(a.del, 2);
  assert.equal(a.hunks.length, 2);
  assert.deepEqual([a.hunks[0].start, a.hunks[0].end], [3, 3]);
  assert.deepEqual([a.hunks[1].start, a.hunks[1].end], [25, 25]);
  assert.equal(a.hunks[0].anchor, "-line 3");
});

test("an untracked file shows as added", async (t) => {
  const r = repo(t, { "a.txt": "a\n" });
  r.write("new.txt", "one\ntwo\n");
  const n = file((await changes(r.root, "HEAD", look)).files, "new.txt");
  assert.equal(n.status, "A");
  assert.equal(n.untracked, true);
  assert.equal(n.add, 2);
});

test("a long new file is split into parts at blank lines", async (t) => {
  const r = repo(t, { "a.txt": "a\n" });
  r.write("steps.ts", lines(1, 120, (n) => (n % 10 === 0 ? "" : `step ${n}`)));
  const s = file((await changes(r.root, "HEAD", look)).files, "steps.ts");
  assert.equal(s.hunks.length, 3);
  assert.deepEqual(s.hunks.map((h) => [h.part, h.parts]), [[1, 3], [2, 3], [3, 3]]);
  assert.equal(s.hunks.reduce((n, h) => n + h.lines.length, 0), 120);
  assert.equal(s.hunks[0].lines.at(-1).text, "", "a part ends on a blank line");
});

test("a deletion-only hunk names the line where the deletion sits", async (t) => {
  const r = repo(t, { "a.txt": lines(1, 10) });
  r.write("a.txt", lines(1, 10).replace("line 5\nline 6\n", ""));
  const [h] = file((await changes(r.root, "HEAD", look)).files, "a.txt").hunks;
  assert.deepEqual([h.start, h.end], [5, 5]);
});

test("a path with spaces keeps its name", async (t) => {
  const r = repo(t, { "my notes.md": "a\n" });
  r.write("my notes.md", "b\n");
  assert.ok(file((await changes(r.root, "HEAD", look)).files, "my notes.md"));
});

test("binary files are listed without hunks", async (t) => {
  const r = repo(t, { "a.txt": "a\n" });
  r.write("logo.bin", "\0\x01\x02");
  const b = file((await changes(r.root, "HEAD", look)).files, "logo.bin");
  assert.equal(b.binary, true);
  assert.equal(b.hunks.length, 0);
});

test("lockfiles and linguist-generated files are marked to fold", async (t) => {
  const r = repo(t, { "package-lock.json": "{}\n", "nvim-pack-lock.json": "{}\n", "gen/api.ts": "a\n", "src/app.ts": "a\n", ".gitattributes": "gen/** linguist-generated\n" });
  for (const p of ["package-lock.json", "nvim-pack-lock.json", "gen/api.ts", "src/app.ts"]) r.write(p, "changed\n");
  const files = (await changes(r.root, "HEAD", look)).files;
  assert.equal(file(files, "package-lock.json").noise, "lockfile");
  assert.equal(file(files, "nvim-pack-lock.json").noise, "lockfile");
  assert.equal(file(files, "gen/api.ts").noise, "generated");
  assert.equal(file(files, "src/app.ts").noise, null);
});

test("vs main diffs from where the branch left main", async (t) => {
  const r = repo(t, { "a.txt": "a\n" });
  r.git("checkout", "-qb", "feature");
  r.write("b.txt", "b\n");
  r.commit();
  r.write("c.txt", "c\n");
  const from = await base(r.root, "branch");
  assert.equal(from.label, "main");
  const paths = (await changes(r.root, from.ref, look)).files.map((f) => f.path);
  assert.deepEqual(paths, ["b.txt", "c.txt"]);
});

test("a repo with no commits diffs against the empty tree", async (t) => {
  const r = repo(t);
  r.write("a.txt", "a\n");
  const from = await base(r.root, "uncommitted");
  assert.equal(from.label, "no commits yet");
  assert.equal((await changes(r.root, from.ref, look)).files[0].path, "a.txt");
});

test("the index reports which changed lines are staged", async (t) => {
  const r = repo(t, { "a.txt": lines(1, 30) });
  r.write("a.txt", lines(1, 30).replace("line 3\n", "three\n").replace("line 25\n", "twenty-five\n"));
  r.git("add", "a.txt");
  r.write("a.txt", lines(1, 30).replace("line 3\n", "three\n"));
  const a = file((await changes(r.root, "HEAD", look)).files, "a.txt"), index = await staged(r.root);
  const plus = a.lines.find((l) => l.kind === "+" && l.text === "three");
  assert.equal(inIndex(a, plus, index), true);
});

test("an untracked file over 1 MiB is listed as binary rather than diffed", async (t) => {
  const r = repo(t, { "a.txt": "a\n" });
  r.write("big.log", "x".repeat(80) + "\n".repeat(1) + ("y".repeat(79) + "\n").repeat(14000));
  const big = file((await changes(r.root, "HEAD", look)).files, "big.log");
  assert.deepEqual([big.binary, big.untracked, big.hunks.length], [true, true, 0]);
});

test("the folder watch's changes count unless they're all ignored files or git objects", async (t) => {
  const r = repo(t, { "a.txt": "a\n", ".gitignore": "dist/\n" });
  const at = (p) => join(r.root, p);
  assert.equal(await touches(r.root, r.gitDir, [at("dist/app.js")]), false);
  assert.equal(await touches(r.root, r.gitDir, [join(r.gitDir, "objects/ab/cdef")]), false);
  assert.equal(await touches(r.root, r.gitDir, [at("dist/app.js"), at("a.txt")]), true);
  assert.equal(await touches(r.root, r.gitDir, [join(r.gitDir, "index")]), true);
  assert.equal(await touches(r.root, r.gitDir, ["/somewhere/else"]), true);
});
