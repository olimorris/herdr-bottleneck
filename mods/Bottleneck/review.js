import { exec, hc, run, notify, readTextFile, writeTextFile } from "herdr";
import { snapshot } from "./git.js";
import { COMMENTS, ROUND, VIEWED, entry, setEntry } from "./store.js";
import { plural, pathAt } from "./words.js";

export function saved(root) {
  const s = entry(COMMENTS, root);
  return { comments: (s?.comments ?? []).filter((c) => c.id && c.path), written: s?.written ?? [] };
}

const save = (root, next) => setEntry(COMMENTS, root, next);

export const commentId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

export function upsert(root, comment) {
  const s = saved(root);
  save(root, { ...s, comments: [...s.comments.filter((c) => c.id !== comment.id), comment] });
}

export function remove(root, ids) {
  const s = saved(root), gone = new Set(ids);
  save(root, { comments: s.comments.filter((c) => !gone.has(c.id)), written: s.written.filter((id) => !gone.has(id)) });
}

function markWritten(root, ids) {
  save(root, { ...saved(root), written: ids });
}

// The hunk as the agent should see it: git's sign, then the line.
export function diffOf(hunk) {
  return hunk.lines.map((l) => l.kind + l.text);
}

const byPath = (files) => new Map(files.map((f) => [f.path, f]));

// A comment follows its hunk by the first changed line, nearest the line it was left on; if that's gone it is outdated. A file comment can't go out of date.
export function place(files, comments) {
  const byHunk = new Map(), byFile = new Map(), outdated = new Map(), paths = byPath(files);
  for (const c of comments) {
    if (c.file) { byFile.set(c.path, c); continue; }
    const hits = (paths.get(c.path)?.hunks ?? []).filter((h) => h.anchor === c.anchor && !byHunk.has(h));
    const hunk = hits.sort((a, b) => Math.abs(a.start - c.start) - Math.abs(b.start - c.start))[0];
    if (hunk) byHunk.set(hunk, { ...c, start: hunk.start, end: hunk.end, diff: diffOf(hunk) });
    else outdated.set(c.path, [...(outdated.get(c.path) ?? []), c]);
  }
  return { byHunk, byFile, outdated };
}

// Stored comments carry where their hunk is now, so a send from the dialog names today's lines.
export function sync(root, files) {
  const s = saved(root), { byHunk } = place(files, s.comments);
  const now = new Map([...byHunk.values()].map((c) => [c.id, c]));
  const next = s.comments.map((c) => {
    const p = now.get(c.id);
    if (c.file) return c;
    return p ? { ...c, start: p.start, end: p.end, diff: p.diff, outdated: false } : { ...c, outdated: true };
  });
  if (JSON.stringify(next) !== JSON.stringify(s.comments)) save(root, { ...s, comments: next });
}

// What you sent last time and the working tree it was about, so the next look can show only what came after.
export function lastRound(root) {
  return entry(ROUND, root) ?? null;
}

async function recordRound(root, comments) {
  const tree = await snapshot(root);
  if (tree) setEntry(ROUND, root, { tree, at: Date.now(), comments });
}

// Whether the agent touched each comment's lines since the snapshot, counted on its old side, which is the working tree the comment was sent about.
export function followUp(files, round) {
  const paths = byPath(files);
  return (round?.comments ?? []).map((c) => {
    const file = paths.get(c.path);
    const changed = c.file ? Boolean(file) : Boolean(file?.lines?.some((l) => l.kind !== " " && l.old >= c.start && l.old <= c.end));
    return { ...c, changed };
  });
}

export function message(comments) {
  const sorted = [...comments].sort((a, b) => a.path.localeCompare(b.path) || (a.file ? 0 : a.start) - (b.file ? 0 : b.start));
  const items = sorted.map((c, i) => {
    const lines = c.text.trim().split("\n");
    const prefix = `${i + 1}. `, pad = " ".repeat(prefix.length);
    const diff = c.diff?.length ? [pad + "```diff", ...c.diff.map((l) => pad + l), pad + "```"] : [];
    const where = (c.file ? c.path : pathAt(c.path, c)) + (c.outdated ? " (outdated)" : "");
    return [prefix + lines[0], ...lines.slice(1).map((l) => pad + l), pad + where, ...diff].join("\n");
  });
  return ["Review these comments:", "", items.join("\n\n"), "", "For each comment above, determine whether it is valid and should be fixed. If so, fix it directly."].join("\n");
}

// Where the agent writes its reasons when asked to explain the diff, one per hunk.
export const notesPath = (gitDir) => `${gitDir}/bottleneck-notes.json`;

export function explainRequest(gitDir, hunks) {
  return [
    "Explain your changes for a code review. Don't change any code.",
    "",
    `For each hunk below, write one short sentence saying why you made that change. Write them as JSON to ${notesPath(gitDir)}: an array of {"path": "...", "start": N, "note": "..."}, with the path and start line exactly as listed.`,
    "",
    ...hunks.map(({ file, hunk }) => pathAt(file.path, hunk)),
  ].join("\n");
}

export function question(file, hunk, text) {
  return [`A question about this change in ${pathAt(file.path, hunk)}:`, "", "```diff", ...diffOf(hunk), "```", "", text.trim(), "", "Answer the question. Don't change any code unless I ask you to."].join("\n");
}

// Notes the agent wrote, or none if it hasn't (or wrote something that isn't the array asked for).
export async function readNotes(gitDir) {
  try {
    const notes = JSON.parse((await readTextFile(notesPath(gitDir))) ?? "[]");
    return Array.isArray(notes) ? notes.filter((n) => n && typeof n.path === "string" && Number.isFinite(+n.start) && typeof n.note === "string") : [];
  } catch { return []; }
}

export async function ask(agent, text) {
  const r = await hc(["send", agent.address, text]);
  if (r.code !== 0) notify({ title: `Couldn't reach ${agent.program.name}`, body: (r.stderr || r.stdout).trim(), level: "error" });
  return r.code === 0;
}

// A file's diff in one number, so a file marked viewed stops being viewed when the agent changes it again.
export function signature(file) {
  let h = 0;
  for (const l of file.lines ?? []) for (const ch of l.kind + l.text + "\n") h = (h * 31 + ch.charCodeAt(0)) | 0;
  return `${file.lines?.length ?? 0}:${h}`;
}

export function viewed(root) {
  return entry(VIEWED, root) ?? {};
}

export function setViewed(root, path, sig) {
  const now = { ...viewed(root) };
  if (sig) now[path] = sig; else delete now[path];
  setEntry(VIEWED, root, now);
}

export async function copy(text) {
  for (const [cmd, ...args] of [["pbcopy"], ["wl-copy"], ["xclip", "-selection", "clipboard"]]) {
    const r = await exec("sh", ["-c", `command -v ${cmd} >/dev/null && printf %s "$1" | ${[cmd, ...args].join(" ")}`, "sh", text]).catch(() => null);
    if (r?.code === 0) return true;
  }
  return false;
}

// Pasting from the clipboard is the only way to type into an agent without pressing Enter: hc send always submits.
export async function deliver(how, agent, root) {
  const comments = saved(root).comments, text = message(comments);
  if (how === "submit") {
    const r = await hc(["send", agent.address, text]);
    if (r.code !== 0) {
      notify({ title: "Couldn't send the review", body: (r.stderr || r.stdout).trim(), level: "error" });
      return false;
    }
    notify({ title: `Sent ${plural(comments.length, "comment")} to ${agent.program.name}`, level: "success", timeout: 3000 });
  } else {
    if (!(await copy(text))) {
      notify({ title: "Couldn't reach the clipboard", body: "Needs pbcopy, wl-copy or xclip", level: "error" });
      return false;
    }
    run("agent.focus", { terminal: agent.address });
    run("pane.focus", { terminal: agent.address });
    run("terminal.paste");
  }
  await recordRound(root, comments);
  remove(root, comments.map((c) => c.id));
  return true;
}

export async function writeReview(root, gitDir) {
  const comments = saved(root).comments, path = `${gitDir}/bottleneck.md`;
  try {
    await writeTextFile(path, message(comments) + "\n", await readTextFile(path));
    markWritten(root, comments.map((c) => c.id));
    await recordRound(root, comments);
    const copied = await copy(path);
    notify({ title: `Wrote ${plural(comments.length, "comment")}`, body: copied ? `${path} (path copied)` : path, level: "success", timeout: 5000 });
    return true;
  } catch (e) {
    notify({ title: "Couldn't write the review", body: String(e?.message ?? e), level: "error" });
    return false;
  }
}

// Whoever reads the markdown file deletes it; only then are the comments it held done with.
export async function purgeWritten(root, gitDir) {
  const s = saved(root);
  if (s.written.length && (await readTextFile(`${gitDir}/bottleneck.md`)) === null) remove(root, s.written);
}
