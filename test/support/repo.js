// A throwaway git repo in the system's temp folder, removed after the test.
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";

export function repo(t, files = {}) {
  const root = mkdtempSync(join(tmpdir(), "bottleneck-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" });
  const write = (path, text) => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), text); };
  const read = (path) => readFileSync(join(root, path), "utf8");
  const exists = (path) => existsSync(join(root, path));
  git("init", "-q");
  for (const [path, text] of Object.entries(files)) write(path, text);
  if (Object.keys(files).length) { git("add", "-A"); git("commit", "-qm", "init"); }
  const commit = (message = "change") => { git("add", "-A"); git("commit", "-qm", message); };
  return { root, gitDir: join(root, ".git"), git, write, read, exists, commit };
}

export const lines = (from, to, f = (n) => `line ${n}`) => Array.from({ length: to - from + 1 }, (_, i) => f(from + i)).join("\n") + "\n";
export const look = { dark: true, ansi: [] };
