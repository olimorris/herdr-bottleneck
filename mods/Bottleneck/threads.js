// Sent comments as conversations with the agent, and its ranking of the diff by risk: both reach the agent through the MCP server.
import { hc, notify, appHome, readTextFile } from "herdr";

export const SETUP = { width: 560, height: 470 };
import { THREADS, ORDER, entry, setEntry } from "./store.js";
import { publish } from "./channel.js";
import { pathAt } from "./words.js";
import { commentId, diffOf } from "./review.js";

// Bottleneck's own settings, in the Herdr home rather than settings.json, which Herdr owns; setting up the MCP server sets "mcp".
export async function readPrefs() {
  try { return JSON.parse((await readTextFile(`${appHome()}/bottleneck.json`)) ?? "{}") ?? {}; } catch { return {}; }
}

// The flag alone isn't enough: copying the mod over again, other than with install.sh, drops the server's packages and the agent's server can't start.
export async function mcpReady() {
  if (!(await readPrefs()).mcp) return false;
  return (await readTextFile(`${appHome()}/mods/Bottleneck/mcp/node_modules/@modelcontextprotocol/sdk/package.json`).catch(() => null)) !== null;
}

export const threads = (root) => entry(THREADS, root) ?? [];

const where = (t) => (t.file ? t.path : pathAt(t.path, t));

async function save(root, gitDir, next) {
  setEntry(THREADS, root, next);
  if (gitDir) await publish(gitDir, "threads.json", { threads: next.map((t) => ({ id: t.id, where: where(t), diff: t.diff ?? [], messages: t.messages.map(({ from, text }) => ({ from, text })) })) });
}

const pick = ({ name, icon, tint, color, tile }) => ({ name, icon, tint, color, tile });

// The agent's ids have to be in threads.json before the comments reach it, or its first reply is refused.
export async function open(root, gitDir, comments, agent) {
  const at = Date.now(), fresh = comments.map((c) => ({
    id: c.id, path: c.path, file: c.file, anchor: c.anchor, start: c.start, end: c.end, diff: c.diff,
    agent: agent?.address ?? null, name: agent?.program.name ?? null, program: agent ? pick(agent.program) : null, messages: [{ from: "you", text: c.text.trim(), at }],
  }));
  const ids = new Set(fresh.map((t) => t.id));
  await save(root, gitDir, [...threads(root).filter((t) => !ids.has(t.id)), ...fresh]);
}

export async function say(root, gitDir, id, from, text) {
  const all = threads(root), t = all.find((t) => t.id === id);
  if (!t) return null;
  const next = { ...t, messages: [...t.messages, { from, text, at: Date.now() }] };
  await save(root, gitDir, all.map((x) => (x.id === id ? next : x)));
  return next;
}

export async function close(root, gitDir, id) {
  await save(root, gitDir, threads(root).filter((t) => t.id !== id));
}

// Like a comment, a hunk's thread follows its hunk by its first changed line; unlike one, a hunk can have several, and one that lost its hunk sits at the top of its file.
export function placeThreads(files, list) {
  const byHunk = new Map(), loose = new Map(), paths = new Map(files.map((f) => [f.path, f]));
  for (const t of list) {
    const hunk = t.file ? null : (paths.get(t.path)?.hunks ?? []).filter((h) => h.anchor === t.anchor).sort((a, b) => Math.abs(a.start - t.start) - Math.abs(b.start - t.start))[0];
    if (hunk) byHunk.set(hunk, [...(byHunk.get(hunk) ?? []), t]);
    else loose.set(t.path, [...(loose.get(t.path) ?? []), t]);
  }
  return { byHunk, loose };
}

export function nudge(t, text) {
  return [`A new reply on review comment ${t.id} (${where(t)}):`, "", text, "", "Answer it with the bottleneck MCP server's reply_to_comment tool, and change the code if the reply asks you to."].join("\n");
}

export async function reply(root, gitDir, id, text, agent) {
  const t = await say(root, gitDir, id, "you", text);
  if (!t || !agent) return false;
  const r = await hc(["send", agent.address, nudge(t, text)]);
  if (r.code !== 0) notify({ title: `Couldn't reach ${agent.program.name}`, body: (r.stderr || r.stdout).trim(), level: "error" });
  return r.code === 0;
}

export const order = (root) => entry(ORDER, root) ?? null;

export function rankRequest(files, diff) {
  return [
    "Rank the files in this diff by how risky they are to get wrong, so I can review the riskiest first. Don't change any code.",
    "",
    `The diff is \`${diff}\`. Call the bottleneck MCP server's set_review_order tool once with every file below, riskiest first. Give each a risk (high, medium or low) and one short sentence on why.`,
    "",
    ...files.map((f) => `${f.path} (+${f.add} −${f.del})`),
  ].join("\n");
}

// Ranked files first, riskiest first; any the ranking doesn't know (new since) after them, by path.
export function arrange(files, ranking) {
  const rank = new Map((ranking?.files ?? []).map((f, i) => [f.path, i]));
  return [...files].sort((a, b) => (rank.get(a.path) ?? Infinity) - (rank.get(b.path) ?? Infinity) || a.path.localeCompare(b.path));
}

export const riskOf = (ranking, path) => ranking?.files.find((f) => f.path === path) ?? null;

// The hunk holding a line of the file as it is now; removed lines don't count, as they're numbered on the old side.
export function hunkAt(file, line) {
  return (file?.hunks ?? []).find((h) => h.lines.some((l) => l.kind !== "-" && l.number === line)) ?? null;
}

// MCP clients name themselves ("claude-code"), Herdr names programs ("Claude Code"): compared as letters only.
const same = (a, b) => a.toLowerCase().replace(/[^a-z0-9]/g, "") === b.toLowerCase().replace(/[^a-z0-9]/g, "");

// A comment the agent left on its own code starts a conversation, under the hunk holding its line, else at the top of the file.
async function flag(root, gitDir, m, files, agents) {
  const file = files.find((f) => f.path === m.path), hunk = m.line ? hunkAt(file, m.line) : null, agent = m.by ? agents.find((a) => same(a.program.name, m.by)) ?? null : null;
  const at = Date.now(), t = {
    id: commentId(), path: m.path, file: !hunk, ...(hunk ? { anchor: hunk.anchor, start: hunk.start, end: hunk.end, diff: diffOf(hunk) } : {}),
    agent: agent?.address ?? null, name: agent?.program.name ?? m.by ?? null, program: agent ? pick(agent.program) : null, flagged: true,
    messages: [{ from: "agent", text: m.text, at }],
  };
  await save(root, gitDir, [...threads(root), t]);
  return t;
}

// What the MCP server left: replies join their thread, the agent's own comments start one, a ranking replaces the last. Returns what arrived, for the tab to announce.
// `files` are the diff's files (unfolded) and `agents` the space's, to place and name the agent's comments.
export async function receive(root, gitDir, messages, { files = [], agents = [] } = {}) {
  const arrived = [];
  for (const m of messages) {
    if (m.type === "comment" && typeof m.path === "string" && typeof m.text === "string") arrived.push({ flagged: await flag(root, gitDir, m, files, agents) });
    if (m.type === "reply" && typeof m.text === "string") {
      const t = await say(root, gitDir, m.id, "agent", m.text);
      if (t) arrived.push({ reply: t });
    } else if (m.type === "order" && Array.isArray(m.files)) {
      setEntry(ORDER, root, { files: m.files.filter((f) => f && typeof f.path === "string"), at: Date.now() });
      arrived.push({ order: m.files.length });
    }
  }
  return arrived;
}
