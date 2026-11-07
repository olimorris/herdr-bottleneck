import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pushPlan, push } from "../mods/Bottleneck/ship.js";
import { repo } from "./support/repo.js";

// A bare repo in its own temp folder stands in for the remote.
function withRemote(t) {
  const r = repo(t, { "a.txt": "a\n" });
  const remote = mkdtempSync(join(tmpdir(), "bottleneck-remote-"));
  t.after(() => rmSync(remote, { recursive: true, force: true }));
  execFileSync("git", ["init", "-q", "--bare", remote]);
  r.git("remote", "add", "origin", remote);
  return r;
}

test("a branch with no upstream is planned as a new branch with the commits no remote has", async (t) => {
  const r = withRemote(t);
  r.git("push", "-q", "-u", "origin", "main");
  r.git("checkout", "-qb", "feature");
  r.write("b.txt", "b\n");
  r.commit("add b");
  const plan = await pushPlan(r.root);
  assert.deepEqual([plan.branch, plan.upstream, plan.ahead, plan.remote], ["feature", null, 1, "origin"]);
  assert.equal(plan.commits[0].subject, "add b");

  await push(r.root, plan);
  const after = await pushPlan(r.root);
  assert.deepEqual([after.upstream, after.ahead], ["origin/feature", 0]);
});

test("a branch with an upstream counts the commits ahead of it", async (t) => {
  const r = withRemote(t);
  r.git("push", "-q", "-u", "origin", "main");
  for (const n of [1, 2]) { r.write(`${n}.txt`, `${n}\n`); r.commit(`commit ${n}`); }
  const plan = await pushPlan(r.root);
  assert.deepEqual([plan.upstream, plan.ahead], ["origin/main", 2]);
  assert.deepEqual(plan.commits.map((c) => c.subject), ["commit 2", "commit 1"]);
});

test("a detached HEAD has nothing to push", async (t) => {
  const r = withRemote(t);
  r.git("checkout", "-q", "--detach");
  assert.match((await pushPlan(r.root)).error, /Not on a branch/);
});
