// The server's side of Bottleneck's folder in .git: it reads what the review tab wrote there and leaves its own messages in inbox/, never writing the tab's files.
import { execFile } from "node:child_process";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { join, isAbsolute } from "node:path";
import { existsSync } from "node:fs";

export const RISKS = ["high", "medium", "low"];

export function folderOf(cwd) {
  return new Promise((resolve, reject) => execFile("git", ["rev-parse", "--absolute-git-dir"], { cwd }, (error, stdout) =>
    error ? reject(new Error(`${cwd} isn't in a git repository`)) : resolve(join(stdout.trim(), "bottleneck"))));
}

async function readJson(folder, name) {
  try { return JSON.parse(await readFile(join(folder, name), "utf8")); } catch { return null; }
}

// Written under a dot name and renamed, so the tab never reads half a message.
async function post(folder, message) {
  const dir = join(folder, "inbox"), name = `${Date.now()}-${randomBytes(4).toString("hex")}.json`;
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, `.${name}`), JSON.stringify(message));
  await rename(join(dir, `.${name}`), join(dir, name));
}

const NOT_OPEN = "Bottleneck has no review open for this repo. Ask the user to open it with cmd-shift-r.";

export async function getComments(folder) {
  const threads = (await readJson(folder, "threads.json"))?.threads ?? [];
  if (!threads.length) return "No review comments.";
  return threads.map((t) => [
    `Comment ${t.id} on ${t.where}`,
    ...(t.diff?.length ? ["```diff", ...t.diff, "```"] : []),
    ...t.messages.map((m) => `${m.from === "agent" ? "You" : "Reviewer"}: ${m.text}`),
  ].join("\n")).join("\n\n");
}

export async function replyToComment(folder, { id, text }) {
  const threads = (await readJson(folder, "threads.json"))?.threads ?? [];
  if (!threads.some((t) => t.id === id)) throw new Error(`No comment with id ${id}. Call get_comments for the ids.`);
  if (!text?.trim()) throw new Error("The reply is empty.");
  await post(folder, { type: "reply", id, text: text.trim() });
  return "Replied. It shows under the comment in Bottleneck.";
}

// Every file, once each, so the reviewer's walk through the diff never skips one.
export async function setReviewOrder(folder, { files }) {
  const listed = (await readJson(folder, "files.json"))?.files;
  if (!listed) throw new Error(NOT_OPEN);
  const known = new Set(listed), paths = files.map((f) => f.path);
  const unknown = paths.filter((p) => !known.has(p)), twice = paths.filter((p, i) => paths.indexOf(p) !== i), missing = listed.filter((p) => !paths.includes(p));
  const problems = [
    unknown.length && `Not in the diff: ${unknown.join(", ")}`,
    twice.length && `Listed twice: ${[...new Set(twice)].join(", ")}`,
    missing.length && `Missing: ${missing.join(", ")}`,
  ].filter(Boolean);
  if (problems.length) throw new Error(`${problems.join(". ")}. Rank each of these files exactly once: ${listed.join(", ")}`);
  await post(folder, { type: "order", files: files.map(({ path, risk, reason }) => ({ path, risk, reason: reason.trim() })) });
  return `Ranked ${files.length} files. Bottleneck shows them riskiest first.`;
}

// `by` is the agent's own name for itself from the MCP handshake, so Bottleneck can show who flagged it and nudge that agent when you reply.
// Checked against the repo, not files.json: the agent flags a file it has just written, before the review has refreshed to list it.
export async function addComment(folder, { path, line, text }, by, cwd = process.cwd()) {
  const repo = await new Promise((resolve) => execFile("git", ["rev-parse", "--show-toplevel"], { cwd }, (error, stdout) => resolve(error ? cwd : stdout.trim())));
  if (isAbsolute(path) || path.split("/").includes("..") || !existsSync(join(repo, path))) throw new Error(`There's no ${path} in this repo. Give the path from the repo root.`);
  if (line !== undefined && !(Number.isInteger(line) && line > 0)) throw new Error("line must be a line number in the file as it is now, 1 or more.");
  if (!text?.trim()) throw new Error("The comment is empty.");
  await post(folder, { type: "comment", path, line: line ?? null, text: text.trim(), by: by ?? null });
  return `Commented on ${line ? `${path}:${line}` : path}. The user sees it under that code in Bottleneck and may reply.`;
}
