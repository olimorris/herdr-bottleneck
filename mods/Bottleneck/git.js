import { exec } from "herdr";
import { strip, spans } from "./ansi.js";

// Reads write nothing under .git, or the folder watch would see each refresh and start the next; over 1 MiB a file diffs as binary, so one log can't overflow exec's output.
const READ = ["--no-optional-locks", "-c", "core.fsmonitor=false", "-c", "diff.autoRefreshIndex=false", "-c", "core.quotePath=false", "-c", "core.bigFileThreshold=1m"];
const DIFF = ["--no-color", "--no-ext-diff", "--no-textconv", "--no-renames"];
const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
const MAX_FILES = 300, MAX_LINES = 3000, PART = 40;

export const git = (root, args) => exec("git", args, { cwd: root });
const read = (root, args) => git(root, [...READ, ...args]);

// Runs a command that has to succeed: its output, or an error naming it with what it printed.
export async function must(root, command, args) {
  const r = await exec(command, args, { cwd: root });
  if (r.code !== 0) throw new Error(`${command} ${args[0]}: ${(r.stderr || r.stdout).trim()}`);
  return r.stdout;
}

let delta;
const hasDelta = () => (delta ??= exec("sh", ["-c", "command -v delta"]).then((r) => r.code === 0, () => false));

// A throwaway copy of the index, outside .git so the folder watch doesn't fire: whatever `then` does to it never reaches the real one.
const withIndexCopy = (then) =>
  `export GIT_INDEX_FILE="\${TMPDIR:-/tmp}/bottleneck-$$.index"; trap 'rm -f "$GIT_INDEX_FILE"' EXIT; cp "$(git rev-parse --git-dir)/index" "$GIT_INDEX_FILE" 2>/dev/null; ${then}`;

// Syntax colors on removed lines too, and a background only on changed words, so the parser can read any background as "changed word".
const STYLES = "--minus-style=syntax --plus-style=syntax --zero-style=syntax --minus-emph-style='syntax #010101' --plus-emph-style='syntax #010101'";

// Untracked files marked intent-to-add in the copy come through as new files, so one diff covers them; delta --color-only keeps git's lines as they are.
async function diff(root, ref, look) {
  const tint = (await hasDelta()) ? ` | delta --color-only --true-color=always --paging=never ${look.dark ? "--dark" : "--light"} ${STYLES}` : "";
  const script = withIndexCopy(`git add -N . >/dev/null 2>&1; git "$@"${tint}`);
  return { ...(await exec("sh", ["-c", script, "sh", ...READ, "diff", ...DIFF, "-U3", ref], { cwd: root })), colored: Boolean(tint) };
}

// The working tree as git would commit it, untracked files included, saved as a tree object: nothing else in the repo changes.
export async function snapshot(root) {
  const r = await exec("sh", ["-c", withIndexCopy("git add -A >/dev/null 2>&1 && git write-tree")], { cwd: root });
  return r.code === 0 ? r.stdout.trim() : null;
}

const NOISE = [
  [/(^|\/)(package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?|Cargo\.lock|Gemfile\.lock|poetry\.lock|uv\.lock|Pipfile\.lock|composer\.lock|go\.sum|flake\.lock|mix\.lock|pubspec\.lock|Podfile\.lock|packages\.lock\.json)$/, "lockfile"],
  [/[-.]lock\.(json|ya?ml|toml)$/, "lockfile"],
  [/\.min\.(js|css)$/, "minified"],
  [/\.map$/, "source map"],
  [/(^|\/)__snapshots__\/|\.snap$/, "snapshot"],
];

// Files nobody should have to read line by line, and why: lockfiles and the like by name, anything .gitattributes marks linguist-generated.
async function noise(root, files) {
  const attrs = files.length ? await read(root, ["check-attr", "linguist-generated", "--", ...files.map((f) => f.path)]) : { stdout: "" };
  const generated = new Set(attrs.stdout.split("\n").filter((l) => /: linguist-generated: (set|true)$/.test(l)).map((l) => l.replace(/: linguist-generated: \w+$/, "")));
  for (const f of files) f.noise = generated.has(f.path) ? "generated" : NOISE.find(([re]) => re.test(f.path))?.[1] ?? null;
}

function dropSign(parts) {
  const [first, ...rest] = parts;
  if (!first) return parts;
  return first.text.length > 1 ? [{ ...first, text: first.text.slice(1) }, ...rest] : rest;
}

export async function repoRoot(cwd) {
  const r = await exec("git", ["rev-parse", "--show-toplevel"], { cwd });
  return r.code === 0 ? r.stdout.trim() : null;
}

const gitDirs = new Map();
export function gitDir(root) {
  if (!gitDirs.has(root)) gitDirs.set(root, read(root, ["rev-parse", "--absolute-git-dir"]).then((r) => r.stdout.trim()));
  return gitDirs.get(root);
}

const verify = async (root, ref) => (await read(root, ["rev-parse", "--verify", "--quiet", ref])).code === 0;

export async function defaultBranch(root) {
  const head = await read(root, ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"]);
  if (head.code === 0 && head.stdout.trim()) return head.stdout.trim();
  for (const name of ["main", "master", "origin/main", "origin/master"]) if (await verify(root, name)) return name;
  return null;
}

// HEAD for uncommitted work, the merge-base with the default branch for the branch, the snapshot of your last review for "since review".
export async function base(root, mode, round) {
  if (mode === "review") {
    if (!round?.tree) return { ...(await base(root, "uncommitted")), note: "No review sent yet, showing uncommitted changes" };
    if ((await read(root, ["cat-file", "-e", round.tree])).code !== 0) return { ...(await base(root, "uncommitted")), note: "Your last review's snapshot is gone, showing uncommitted changes" };
    return { ref: round.tree, label: "your last review", review: true };
  }
  if (!(await verify(root, "HEAD"))) return { ref: EMPTY_TREE, label: "no commits yet" };
  if (mode !== "branch") return { ref: "HEAD", label: "HEAD" };
  const main = await defaultBranch(root);
  if (!main) return { ref: "HEAD", label: "HEAD", note: "No main or master branch, showing uncommitted changes" };
  const mb = await read(root, ["merge-base", "HEAD", main]);
  return mb.code === 0 ? { ref: mb.stdout.trim(), label: main } : { ref: "HEAD", label: "HEAD", note: `No common history with ${main}` };
}

// git names the line before an empty side (`-4,0` inserts after line 4); move it to the line the insert lands before.
function hunkOf(header) {
  const m = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,\d+)? @@(.*)/.exec(header);
  const old = +(m?.[1] ?? 0) + (m?.[2] === "0" ? 1 : 0);
  return { header, context: (m?.[4] ?? "").trim(), old, next: +(m?.[3] ?? 0), lines: [] };
}

// `at` places even a removed line in the new file; `old` is the HEAD line it is, or for an added line the HEAD line it lands before.
function number(hunk) {
  let old = hunk.old, next = hunk.next;
  for (const line of hunk.lines) {
    line.at = Math.max(next, 1);
    line.old = old;
    if (line.kind === "+") line.number = next++;
    else if (line.kind === "-") line.number = old++;
    else { line.number = next++; old++; }
  }
}

// Line numbers name the new file; a hunk that only deletes takes the line the deletion sits on.
function finish(hunk) {
  const changed = hunk.lines.filter((l) => l.kind !== " ");
  hunk.start = changed[0]?.at ?? hunk.lines[0]?.at ?? Math.max(hunk.next, 1);
  hunk.end = changed.length ? Math.max(...changed.map((l) => l.at)) : hunk.start;
  hunk.anchor = changed[0] ? changed[0].kind + changed[0].text : hunk.header;
  return hunk;
}

// A long hunk becomes parts of about PART lines, cut at a blank line where one is near, so each gets its own comment.
function split(hunk) {
  if (hunk.lines.length <= PART * 1.5) return [finish(hunk)];
  const parts = [];
  let from = 0;
  while (from < hunk.lines.length) {
    let to = Math.min(hunk.lines.length, from + PART);
    if (hunk.lines.length - to < PART / 2) to = hunk.lines.length;
    else {
      const blank = [...Array(PART / 2).keys()].map((d) => to - PART / 4 + d).find((i) => !hunk.lines[i]?.text.trim());
      if (blank !== undefined) to = blank + 1;
    }
    parts.push({ ...hunk, lines: hunk.lines.slice(from, to) });
    from = to;
  }
  return parts.map((p, i) => finish({ ...p, part: i + 1, parts: parts.length }));
}

// A removal is named by its HEAD line and an addition by its working tree line: the coordinates the staged and unstaged diffs share with it.
function key(file) {
  for (const line of file.hunks.flatMap((h) => h.lines)) {
    if (line.kind === "-") line.key = `-${line.old}`;
    else if (line.kind === "+") line.key = `+${line.number}`;
  }
}

function parse(text, colored, ansi) {
  const files = [];
  let file = null, hunk = null;
  for (const line of text.split("\n")) {
    const raw = colored ? strip(line) : line;
    if (raw.startsWith("diff --git ")) {
      hunk = null;
      file = { path: null, oldPath: null, status: "M", add: 0, del: 0, binary: false, hunks: [] };
      files.push(file);
      continue;
    }
    if (!file) continue;
    if (!hunk) {
      if (raw.startsWith("new file")) file.status = "A";
      else if (raw.startsWith("deleted file")) file.status = "D";
      else if (raw.startsWith("--- ")) file.oldPath = raw === "--- /dev/null" ? null : raw.slice(6).replace(/\t$/, "");
      else if (raw.startsWith("+++ ")) file.path = raw === "+++ /dev/null" ? file.oldPath : raw.slice(6).replace(/\t$/, "");
      else if (raw.startsWith("Binary files ")) {
        file.binary = true;
        file.path ??= /^Binary files (?:a\/(.+?)|\/dev\/null) and (?:b\/(.+)|\/dev\/null) differ$/.exec(raw)?.slice(1).find(Boolean) ?? null;
      }
    }
    if (raw.startsWith("@@")) { hunk = hunkOf(raw); file.hunks.push(hunk); continue; }
    if (!hunk) continue;
    const kind = raw[0];
    if (kind !== "+" && kind !== "-" && kind !== " ") continue;
    hunk.lines.push({ kind, text: raw.slice(1), spans: colored ? dropSign(spans(line, ansi)) : null });
    if (kind === "+") file.add++;
    if (kind === "-") file.del++;
  }
  for (const f of files) { f.hunks.forEach(number); key(f); }
  return files.filter((f) => f.path);
}

// Past MAX_LINES a file is cut off and marked clipped; what's left of its long hunks is split into parts.
function clip(file) {
  let count = 0;
  for (const h of file.hunks) {
    if (count + h.lines.length > MAX_LINES) { h.lines = h.lines.slice(0, Math.max(0, MAX_LINES - count)); file.clipped = true; }
    count += h.lines.length;
  }
  file.lines = file.hunks.flatMap((h) => h.lines);
  file.hunks = file.hunks.filter((h) => h.lines.length).flatMap(split);
}

async function untrackedPaths(root) {
  const r = await read(root, ["ls-files", "--others", "--exclude-standard", "-z"]);
  return new Set(r.stdout.split("\0").filter(Boolean));
}

// look: { dark, ansi } picks delta's theme and maps its basic colors onto the Herdr theme's.
export async function changes(root, ref, look) {
  const [r, untracked] = await Promise.all([diff(root, ref, look), untrackedPaths(root)]);
  if (r.code !== 0 || (!r.stdout && r.stderr.trim())) throw new Error(r.stderr.trim() || "git diff failed");
  const all = parse(r.stdout, r.colored, look.ansi).sort((a, b) => a.path.localeCompare(b.path)), files = all.slice(0, MAX_FILES);
  await noise(root, files);
  for (const f of files) { f.untracked = untracked.has(f.path); clip(f); }
  return { files, limited: all.length > MAX_FILES };
}

// Ignored files (build output, node_modules) and git's object store can't change the diff; a path it can't place counts, so no refresh is missed.
export async function touches(root, dir, paths) {
  if (paths.length > 1000) return true;
  const work = [];
  for (const p of paths) {
    if (p === dir || p.startsWith(`${dir}/`)) { if (!p.startsWith(`${dir}/objects/`)) return true; }
    else if (p.startsWith(`${root}/`)) work.push(p.slice(root.length + 1));
    else return true;
  }
  if (!work.length) return false;
  const ignored = (await read(root, ["check-ignore", "--", ...work])).stdout.split("\n").filter(Boolean);
  return ignored.length < work.length;
}

// By path: `removed` HEAD lines the index dropped, `missing` working tree lines it lacks, `extra` lines it has that the working tree doesn't.
export async function staged(root) {
  const [cached, unstaged] = await Promise.all([read(root, ["diff", "--cached", ...DIFF, "-U0"]), read(root, ["diff", ...DIFF, "-U0"])]);
  const out = new Map(), entry = (path) => out.get(path) ?? out.set(path, { removed: new Set(), missing: new Set(), extra: 0, changed: false }).get(path);
  for (const f of parse(cached.stdout, false)) {
    const e = entry(f.path);
    e.changed = true;
    for (const l of f.hunks.flatMap((h) => h.lines)) if (l.kind === "-") e.removed.add(l.old);
  }
  for (const f of parse(unstaged.stdout, false)) {
    const e = entry(f.path);
    for (const l of f.hunks.flatMap((h) => h.lines)) l.kind === "+" ? e.missing.add(l.number) : l.kind === "-" && e.extra++;
  }
  return out;
}

// Whether one changed line of the diff from HEAD is in the index.
export function inIndex(file, line, index) {
  const e = index?.get(file.path);
  if (line.kind === "-") return Boolean(e?.removed.has(line.old));
  return !file.untracked && !e?.missing.has(line.number);
}

export const keysOf = (lines) => lines.map((l) => l.key).filter(Boolean);

// "all", "some" or "none" of these lines' changes are in the index; a file without changed lines (binary) by whether it's staged at all.
export function stateOf(lines, file, index) {
  const changed = lines.filter((l) => l.key);
  if (!changed.length) return index?.get(file.path)?.changed ? "all" : "none";
  const n = changed.filter((l) => inIndex(file, l, index)).length;
  return n === changed.length ? "all" : n ? "some" : "none";
}

// Which of a file's changes the index holds, or null when it holds something the working tree doesn't, which no key can name.
export function indexed(file, index) {
  const e = index?.get(file.path), changed = file.lines.filter((l) => l.key);
  const have = new Set(keysOf(changed.filter((l) => inIndex(file, l, index))));
  const removals = changed.filter((l) => l.kind === "-"), olds = new Set(removals.map((l) => l.old));
  const unknownRemoval = [...(e?.removed ?? [])].some((n) => !olds.has(n));
  const extraText = (e?.extra ?? 0) !== removals.filter((l) => !have.has(l.key)).length;
  return unknownRemoval || extraText ? null : have;
}
