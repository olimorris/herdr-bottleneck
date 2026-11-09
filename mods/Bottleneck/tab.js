// The code review tab: the space's diff hunk by hunk, with comments, staging, discarding and the agent's notes.
import { div, svg } from "gpui-kit";
import { v_flex, h_flex, v_virtual_list, Scrollbar, VirtualListScrollHandle, TextareaState, Textarea, InputState, Input } from "gpui-base";
import { panes, focused, theme, settings, notify, shared, setShared, openOverlay, nextCommand, watchFolder, readTextFile, exec, run, knownAgents } from "herdr";
import { gitDir, base, changes, staged, touches, keysOf, stateOf, indexed } from "./git.js";
import { saved, upsert, remove, place, sync, lastRound, followUp, diffOf, explainRequest, question, readNotes, notesPath, ask, signature, viewed, setViewed, purgeWritten, commentId } from "./review.js";
import { stageFile, stageLines, discardLines, discardFile } from "./stage.js";
import { spaceAgents, defaultAgent, rememberAgent, agentAt, stepAgent } from "./agents.js";
import { ORIGIN, HINTS_SHUT, DIALOG, entry } from "./store.js";
import { HINTS, caps, commandFor } from "./keys.js";
import { plural, linesLabel, ago } from "./words.js";
import { button, header, footer, agentList, newAgentList, label, submitted, mono } from "./ui.js";
import { readPrefs, mcpReady, SETUP, threads, placeThreads, reply, close, order, rankRequest, arrange, riskOf, receive } from "./threads.js";
import { publish, collect } from "./channel.js";
import * as rows from "./rows.js";
import { LIST_W, FILE_H, HEAD_H, GAP, NOTE_H } from "./rows.js";

const POP_W = 400, POP_H = 236, REPLY_H = 132, CONTEXT_STEP = 10;
const MODES = ["uncommitted", "branch", "review"];
const MIXED = "This file has staged changes that aren't in the working tree";

// Smart case, as in vim: lowercase matches either case, any capital makes it exact.
const matcher = (q) => (/[A-Z]/.test(q) ? (s) => s.includes(q) : ((lq) => (s) => s.toLowerCase().includes(lq))(q.toLowerCase()));

const look = () => { const t = theme(); return { dark: settings().dark !== false, ansi: Array.from({ length: 16 }, (_, i) => t[`ansi${i}`]) }; };

// A folded file's one row stands for all its changes.
const linesOf = (file, hunk) => (hunk.folded ? file.lines ?? [] : hunk.lines);

// Parts of deleted, binary and clipped files can't be named line by line, so those go whole.
const wholeOnly = (file, hunk) => hunk.folded || file.binary || file.status === "D" || file.clipped || !file.lines;

const noteFor = (notes, file, hunk) => notes?.find((n) => n.path === file.path && +n.start >= hunk.start && +n.start <= hunk.end) ?? null;

function groupByPath(comments) {
  const out = new Map();
  for (const c of comments) out.set(c.path, [...(out.get(c.path) ?? []), c]);
  return out;
}

// Extra lines around a hunk come from the working tree file as it is, so only files someone widened are read.
async function readTexts(root, files, context) {
  const want = new Set([...context.keys()].map((k) => JSON.parse(k)[0])), texts = new Map();
  for (const f of files) if (want.has(f.path) && f.status !== "D") {
    const text = await readTextFile(`${root}/${f.path}`).catch(() => null);
    if (text !== null) texts.set(f.path, text.replace(/\n$/, "").split("\n"));
  }
  return texts;
}

async function load(root, mode, context, space) {
  const dir = await gitDir(root), colors = look();
  await purgeWritten(root, dir);
  const from = await base(root, mode, lastRound(root));
  // Messages first, then the diff: an agent's comment on a line it has just written finds that line's hunk.
  const inbox = await collect(dir);
  const [{ files, limited }, notes, index] = await Promise.all([changes(root, from.ref, colors), readNotes(dir), mode === "uncommitted" ? staged(root) : null]);
  for (const f of files) { f.gitHunks = f.hunks; f.sig = signature(f); }
  // The MCP server only accepts a ranking of the files in the view you're on.
  await publish(dir, "files.json", { files: files.map((f) => f.path) });
  const arrived = await receive(root, dir, inbox, { files, agents: spaceAgents(space) });
  return { gitDir: dir, files, limited, base: from, notes, staged: index, arrived, texts: await readTexts(root, files, context), colors: JSON.stringify(colors) };
}

export class ReviewTab {
  constructor(space, cx) {
    this.space = space;
    this.handle = cx.focus_handle();
    this.scroll = VirtualListScrollHandle.new();
    this.draft = TextareaState.new({ placeholder: "Leave a comment", rows: 5 });
    this.draft.set_auto_grow(5, 5);
    this.draftText = submitted(this.draft);
    // The text area takes cmd-enter for itself and reports it as a submit, so a key handler around it never sees it.
    this.draft.on("submit", (e, cx) => { if (!e.shift) { this.saveDraft(); cx.notify(); } });
    this.search = InputState.new({ placeholder: "Search the diff" });
    this.search.on("change", (_e, cx) => { this.query = this.search.value(); this.jumpMatch(1, true); cx.notify(); });
    this.search.on("submit", (_e, cx) => { this.searching = false; this.handle.focus(); cx.notify(); });
    for (const box of [this.draft, this.search]) { box.on("focus", () => { this.typing = true; }); box.on("blur", () => { this.typing = false; }); }
    this.mode = (() => { try { return localStorage.getItem("mode") || "uncommitted"; } catch { return "uncommitted"; } })();
    this.ordering = (() => { try { return localStorage.getItem("order") || "path"; } catch { return "path"; } })();
    Object.assign(this, { root: null, files: [], flat: [], at: 0, top: 0, version: 0, query: "", editing: null, confirming: null, folds: new Map(), jobs: Promise.resolve() });
    this.aim(null);
    setShared(DIALOG, false);
    this.handle.focus();
    // The list's renderer can't call cx.notify(); it calls wake() and this re-renders once layout is done.
    cx.spawn(async (cx) => { for (;;) { await new Promise((r) => (this.wake = r)); cx.notify(); } });
    this.tick(cx);
    cx.timer.every(5000, (cx) => this.tick(cx));
    cx.timer.every(1000, (cx) => this.watchAgents(cx));
    cx.spawn(async (cx) => { for (;;) { this.command(await nextCommand(), cx); cx.notify(); } });
  }

  origin() {
    return entry(ORIGIN, this.space) ?? null;
  }

  aim(root) {
    Object.assign(this, { root, gitDir: null, files: [], flat: [], at: 0, editing: null, confirming: null, watched: null, staged: null, notes: [], context: new Map(), texts: new Map() });
    this.version++;
  }

  // The folder watch covers the repo; this covers what it can't see: bottleneck.json, the theme, and a watch that failed.
  tick(cx) {
    if (!this.loading && (this.watched !== this.origin()?.root || JSON.stringify(look()) !== this.colors)) this.refresh(cx);
    cx.spawn(async (cx) => { this.prefs = await readPrefs(); cx.notify(); });
  }

  refresh(cx) {
    const root = this.origin()?.root;
    if (!root) return;
    if (this.loading) { this.again = true; return; }
    if (root !== this.root) this.aim(root);
    const mode = this.mode;
    this.loading = true;
    cx.spawn(async (cx) => {
      try {
        const loaded = await load(root, mode, this.context, this.space);
        // A load started before a repo or view switch would show the old diff under the new name.
        if (root === this.root && mode === this.mode) this.show(loaded, cx);
      } catch (e) { this.error = String(e?.message ?? e); }
      finally {
        this.loading = false;
        if (this.again) { this.again = false; this.refresh(cx); }
        cx.notify();
      }
    });
  }

  show(loaded, cx) {
    Object.assign(this, loaded, { error: null });
    for (const a of loaded.arrived) {
      if (a.flagged) notify({ title: `${a.flagged.name ?? "The agent"} flagged ${a.flagged.path.split("/").pop()}${a.flagged.file ? "" : `:${a.flagged.start}`}`, body: a.flagged.messages[0].text, level: "info", timeout: 5000 });
      if (a.reply) notify({ title: `${a.reply.name ?? "The agent"} replied`, body: a.reply.file ? a.reply.path : `${a.reply.path}:${a.reply.start}`, level: "info", timeout: 4000 });
      if (a.order) { this.setOrdering("risk"); notify({ title: `Ranked ${plural(a.order, "file")} by risk`, level: "success", timeout: 3000 }); }
    }
    this.fold();
    sync(this.root, this.files);
    this.watch(cx);
  }

  watch(cx) {
    const root = this.root;
    if (this.watched === root) return;
    this.watched = root;
    cx.spawn(async (cx) => {
      try {
        while (this.watched === root) {
          const paths = await watchFolder(root);
          if (this.watched === root && (await touches(root, this.gitDir, paths))) this.refresh(cx);
        }
      } catch { if (this.watched === root) this.watched = null; }
    });
  }

  // Lockfiles and generated files start folded to one row; z folds or unfolds any file. A file with hunk comments stays open, or they'd have nowhere to show.
  fold() {
    const commented = new Set(saved(this.root).comments.filter((c) => !c.file).map((c) => c.path)), seen = viewed(this.root);
    const sorted = this.ordering === "risk" ? arrange(this.files, order(this.root)) : [...this.files].sort((a, b) => a.path.localeCompare(b.path));
    // A fully staged file is done with: it folds and moves to the end, after everything still to review. Newly staged, it folds even if you'd unfolded it before.
    for (const f of sorted) {
      const was = f.staged;
      f.staged = this.fileState(f) === "all";
      if (f.staged && !was && this.stagedSeen?.has(f.path) === false) this.folds.delete(f.path);
    }
    this.stagedSeen = new Set(sorted.filter((f) => f.staged).map((f) => f.path));
    this.files = [...sorted.filter((f) => !f.staged), ...sorted.filter((f) => f.staged)];
    for (const f of this.files) {
      f.viewed = seen[f.path] === f.sig;
      f.folded = f.gitHunks.length > 0 && !commented.has(f.path) && (this.folds.get(f.path) ?? (f.staged || f.viewed || Boolean(f.noise)));
      f.hunks = f.folded ? [{ folded: true, lines: [], header: "", context: "", start: 1, end: 1, anchor: `fold:${f.path}` }] : f.gitHunks.map((h, i) => this.expand(f, h, i));
    }
    this.flat = this.files.flatMap((file) => file.hunks.map((hunk) => ({ file, hunk })));
    this.at = Math.min(this.at, Math.max(0, this.flat.length - 1));
    this.version++;
  }

  // A hunk with `extra` more unchanged lines above and below, stopping short of its neighbours; they carry no staging key, so staging sees the same hunk.
  expand(file, hunk, i) {
    const extra = this.context.get(JSON.stringify([file.path, hunk.anchor])) ?? 0, text = this.texts.get(file.path);
    if (!extra || !text) return hunk;
    const newSide = (h) => h.lines.filter((l) => l.kind !== "-").map((l) => l.number);
    const mine = newSide(hunk), first = mine[0] ?? hunk.lines[0]?.at ?? 1, last = mine.at(-1) ?? first - 1;
    const prev = file.gitHunks[i - 1], next = file.gitHunks[i + 1];
    const floor = prev ? (newSide(prev).at(-1) ?? 0) + 1 : 1, ceil = Math.min(text.length, next ? (newSide(next)[0] ?? text.length + 1) - 1 : text.length);
    const from = Math.max(floor, first - extra), to = Math.min(ceil, last + extra);
    const row = (n) => ({ kind: " ", text: text[n - 1], number: n, spans: null });
    const numbers = (a, b) => Array.from({ length: Math.max(0, b - a + 1) }, (_, k) => a + k);
    const before = !hunk.part || hunk.part === 1 ? numbers(from, first - 1).map(row) : [];
    const after = !hunk.part || hunk.part === hunk.parts ? numbers(last + 1, to).map(row) : [];
    return { ...hunk, lines: [...before, ...hunk.lines, ...after] };
  }

  command(c, cx) {
    if (c === "focus") return this.handle.focus();
    if (this.editing || this.confirming) return;
    const cur = this.flat[this.at];
    const anywhere = {
      next_mode: () => this.stepMode(1, cx), prev_mode: () => this.stepMode(-1, cx),
      next_hunk: () => this.stepHunk(1), prev_hunk: () => this.stepHunk(-1),
      next_file: () => this.stepFile(1), prev_file: () => this.stepFile(-1),
      explain: () => this.explain(), send: () => this.openSend(), commit: () => this.openCommit(), push: () => this.openDialog("push", 420),
      order: () => this.toggleOrdering(cx), rank: () => this.rank(cx),
      search: () => { this.searching = true; this.search.focus(); },
      next_match: () => this.jumpMatch(1, false), prev_match: () => this.jumpMatch(-1, false),
    };
    const onHunk = {
      comment: () => (cur.hunk.folded ? this.editFile(cur.file) : this.edit(cur)), comment_file: () => this.editFile(cur.file),
      fold: () => this.toggleFold(cur.file), viewed: () => this.toggleViewed(cur.file), ask: () => this.askAbout(cur),
      more_context: () => this.widen(cur, CONTEXT_STEP, cx), less_context: () => this.widen(cur, -CONTEXT_STEP, cx),
      delete: () => this.deleteComment(cur, cx), reply: () => this.replyTo(cur, cx),
      stage: () => this.stage(cur, cx), stage_file: () => this.stageWhole(cur.file, cx),
      discard: () => this.askDiscard(cur, false), discard_file: () => this.askDiscard(cur, true),
    };
    if (anywhere[c]) anywhere[c]();
    else if (onHunk[c] && cur) onHunk[c]();
  }

  // Past the last hunk j scrolls to the very end, and past the first k to the very top, so what's below or above them can still be reached.
  // Staged files are skipped: you've finished with them, and unstaging brings them back.
  stepHunk(dir) {
    let i = this.at + dir;
    while (i >= 0 && i < this.flat.length && this.flat[i].file.staged) i += dir;
    if (i >= this.flat.length) this.scroll.scroll_to_bottom();
    else if (i < 0) this.scroll.scroll_to_item(0);
    else this.go(i);
  }

  go(i) {
    if (!this.flat.length) return;
    this.at = Math.max(0, Math.min(this.flat.length - 1, i));
    this.reveal = true;
  }

  goToFile(file) {
    const i = this.flat.findIndex((h) => h.file === file);
    if (i >= 0) this.go(i);
  }

  stepFile(dir) {
    const files = this.files.filter((f) => f.hunks.length && !f.staged), i = files.indexOf(this.flat[this.at]?.file);
    const next = files[dir > 0 ? i + 1 : Math.max(0, i - 1)];
    if (next) this.goToFile(next);
  }

  stepMode(dir, cx) {
    this.setMode(MODES[(MODES.indexOf(this.mode) + dir + MODES.length) % MODES.length], cx);
  }

  setMode(mode, cx) {
    if (mode === this.mode) return;
    Object.assign(this, { mode, at: 0, files: [], flat: [] });
    this.version++;
    try { localStorage.setItem("mode", mode); } catch {}
    this.refresh(cx);
  }

  // Staging marks are worked out once per read of the index, not on every frame.
  state(key, lines, file) {
    if (!this.staged) return "none";
    if (this.marksOf !== this.staged) { this.marks = new Map(); this.marksOf = this.staged; }
    if (!this.marks.has(key)) this.marks.set(key, stateOf(lines, file, this.staged));
    return this.marks.get(key);
  }

  hunkState({ file, hunk }) {
    return this.state(hunk, linesOf(file, hunk), file);
  }

  fileState(file) {
    return this.state(file, file.lines ?? [], file);
  }

  toggleFold(file) {
    if (!file.gitHunks?.length) return;
    if (!file.folded && saved(this.root).comments.some((c) => !c.file && c.path === file.path)) return notify({ title: "This file has comments on its hunks", body: "Delete them to fold it", level: "info", timeout: 3000 });
    this.folds.set(file.path, !file.folded);
    this.fold();
    this.go(Math.max(0, this.flat.findIndex((h) => h.file === file)));
  }

  // Like GitHub's: a viewed file folds away and the selection moves on; it stops being viewed when its diff changes.
  toggleViewed(file) {
    if (!file.sig || !file.gitHunks?.length) return;
    const was = file.viewed;
    setViewed(this.root, file.path, was ? null : file.sig);
    this.folds.delete(file.path);
    this.fold();
    const i = this.flat.findIndex((h) => h.file === file);
    this.go(was ? i : i + 1);
  }

  widen({ file, hunk }, step, cx) {
    if (hunk.folded || file.status === "D" || file.binary) return;
    const key = JSON.stringify([file.path, hunk.anchor]), n = Math.max(0, (this.context.get(key) ?? 0) + step);
    if (n) this.context.set(key, n); else this.context.delete(key);
    this.refresh(cx);
  }

  // Which hunks have a line matching the search, worked out once per search and diff.
  matches() {
    const stamp = `${this.version}\0${this.query}`;
    if (this.matchStamp !== stamp) {
      const hit = matcher(this.query);
      this.hits = this.flat.map(({ file, hunk }) => linesOf(file, hunk).some((l) => hit(l.text)));
      this.matchStamp = stamp;
    }
    return this.hits;
  }

  // The next hunk (or part) with a match, wrapping round; `here` lets the hunk you're on count.
  jumpMatch(dir, here) {
    if (!this.query) return;
    const hits = this.matches(), n = hits.length;
    for (let k = here ? 0 : 1; k <= n; k++) {
      const i = (((this.at + dir * k) % n) + n) % n;
      if (hits[i]) return this.go(i);
    }
  }

  deleteComment({ file, hunk }, cx) {
    const { byHunk, byFile } = place(this.files, saved(this.root).comments);
    const comment = byHunk.get(hunk) ?? byFile.get(file.path);
    if (comment) return remove(this.root, [comment.id]);
    const thread = this.threadAt({ file, hunk });
    if (thread) cx.spawn(async (cx) => { await close(this.root, this.gitDir, thread.id); cx.notify(); });
  }

  // The hunk's latest thread, else the newest one that sits at the top of its file.
  threadAt({ file, hunk }) {
    const { byHunk, loose } = placeThreads(this.files, threads(this.root));
    return byHunk.get(hunk)?.at(-1) ?? loose.get(file.path)?.at(-1) ?? null;
  }

  // The first use of a feature that needs the MCP server offers to set it up.
  async mcpReady() {
    if (await mcpReady()) return true;
    openOverlay({ mod: "Bottleneck", kind: "dialog", ...SETUP, props: { setup: { tab: focused()?.tab } } });
    return false;
  }

  replyTo(at, cx) {
    if (this.hunkState(at) === "all") return notify({ title: "This is staged", body: "Unstage it to see its conversation and reply", level: "info", timeout: 3000 });
    const thread = this.threadAt(at);
    if (!thread) return notify({ title: "No conversation here", body: "Send a comment first, then reply to the agent's answer with r", level: "info", timeout: 3000 });
    cx.spawn(async (cx) => {
      if (!(await this.mcpReady())) return;
      const agent = agentAt(thread.agent) ?? defaultAgent(this.space);
      this.startEditing({ reply: true, id: thread.id, path: thread.path, file: thread.file, start: thread.start, end: thread.end, agent: agent?.address ?? null });
      cx.notify();
    });
  }

  setOrdering(ordering) {
    this.ordering = ordering;
    try { localStorage.setItem("order", ordering); } catch {}
    const cur = this.flat[this.at]?.file;
    this.fold();
    if (cur) this.goToFile(cur);
  }

  // Risk order needs a ranking: without one, the first switch asks an agent for it.
  toggleOrdering(cx) {
    if (this.ordering === "risk") return this.setOrdering("path");
    if (order(this.root)) return this.setOrdering("risk");
    this.rank(cx);
  }

  // A fresh agent ranks without defending choices it made, so the picker also offers to start one.
  rank(cx) {
    if (!this.files.length) return notify({ title: "Nothing to rank", level: "info", timeout: 2500 });
    cx.spawn(async (cx) => {
      if (!(await this.mcpReady())) return;
      const starts = (await knownAgents().catch(() => [])).filter((k) => k.installed).slice(0, 3);
      this.editing = { rank: true, starts, agent: defaultAgent(this.space)?.address ?? (starts.length ? "new:0" : null), path: "" };
      this.handle.focus();
      cx.notify();
    });
  }

  // A new agent gets its own tab, so you see any permission it asks for and the review keeps its width.
  runRank(cx) {
    const { agent: address, starts } = this.editing, files = this.files, request = rankRequest(files, this.diffCommand());
    const start = address?.startsWith("new:") ? starts[+address.slice(4)] : null, agent = agentAt(address);
    if (start) {
      this.stopEditing();
      run("tab.new", { space: this.space, folder: this.root, name: "Rank by risk", argv: start.run, task: request });
      return notify({ title: `Started ${start.name} to rank ${plural(files.length, "file")}`, body: "They reorder by risk when it's done", level: "success", timeout: 4000 });
    }
    if (!agent) return;
    rememberAgent(this.space, agent);
    this.stopEditing();
    cx.spawn(async () => {
      if (await ask(agent, request)) notify({ title: `Asked ${agent.program.name} to rank ${plural(files.length, "file")}`, body: "They reorder by risk when it's done", level: "success", timeout: 4000 });
    });
  }

  // While a picker is open, an agent you start yourself joins its list and is picked, since it's the one you meant.
  watchAgents(cx) {
    const e = this.editing;
    if (!e || !("agent" in e)) return;
    const now = spaceAgents(this.space).map((a) => a.address);
    if (!e.known) { e.known = new Set(now); return; }
    const added = now.filter((a) => !e.known.has(a));
    if (!added.length && now.length === e.known.size) return;
    if (added.length) e.agent = added.at(-1);
    e.known = new Set(now);
    cx.notify();
  }

  // The program as saved when the comment was sent, so the avatar survives the agent closing.
  programOf(th) {
    return th.program ?? agentAt(th.agent)?.program ?? null;
  }

  pickable() {
    return [...spaceAgents(this.space), ...(this.editing?.starts ?? []).map((_, i) => ({ address: `new:${i}` }))];
  }

  // How the agent can see the same diff you're looking at.
  diffCommand() {
    return this.mode === "uncommitted" ? "git diff HEAD, plus untracked files" : `git diff ${this.base?.ref ?? "HEAD"}`;
  }

  // One git job at a time, each reading the index the last one left, so two quick stages in one file can't undo each other.
  enqueue(cx, failed, job) {
    const before = this.jobs, root = this.root;
    this.jobs = new Promise((done) => cx.spawn(async (cx) => {
      await before;
      try { await job(await staged(root)); } catch (e) { notify({ title: failed, body: String(e?.message ?? e), level: "error" }); }
      done();
      this.refresh(cx);
    }));
  }

  inUncommitted(what) {
    if (this.mode !== "uncommitted") notify({ title: `${what} works in Uncommitted`, level: "info", timeout: 2500 });
    return this.mode === "uncommitted";
  }

  stage({ file, hunk }, cx) {
    if (!this.inUncommitted("Staging")) return;
    if (hunk.folded) return this.stageWhole(file, cx);
    if (wholeOnly(file, hunk)) return notify({ title: "Stage this file as a whole with shift-space", body: file.clipped ? "It's too long to show in full" : "Deleted and binary files stage whole", level: "info", timeout: 3500 });
    const { root, gitDir } = this, mine = keysOf(hunk.lines);
    this.enqueue(cx, "Couldn't stage", async (index) => {
      const have = indexed(file, index);
      if (!have) return notify({ title: MIXED, body: "Stage or unstage it as a whole with shift-space", level: "warning" });
      const keys = new Set(have), off = mine.every((k) => have.has(k));
      for (const k of mine) off ? keys.delete(k) : keys.add(k);
      await stageLines(root, gitDir, file, keys);
    });
  }

  stageWhole(file, cx) {
    if (!this.inUncommitted("Staging")) return;
    const root = this.root;
    this.enqueue(cx, "Couldn't stage", (index) => stageFile(root, file.path, stateOf(file.lines ?? [], file, index) !== "all"));
  }

  askDiscard({ file, hunk }, whole) {
    if (!this.inUncommitted("Discarding")) return;
    whole ||= wholeOnly(file, hunk);
    if (!whole && !indexed(file, this.staged)) return notify({ title: MIXED, body: "Discard it as a whole with shift-d", level: "warning" });
    this.confirming = whole
      ? { file, whole, title: file.untracked ? "Delete untracked file" : "Discard file", target: file.path, body: file.untracked ? "It's untracked, so git can't bring it back." : "This can't be undone." }
      : { file, hunk, title: "Discard hunk", target: `${file.path.split("/").pop()} · ${linesLabel(hunk)}`, body: "This can't be undone." };
    this.reveal = true;
  }

  discard(cx) {
    const { file, hunk, whole } = this.confirming, { root, gitDir } = this;
    this.confirming = null;
    this.handle.focus();
    this.enqueue(cx, "Couldn't discard", async (index) => {
      if (whole) return discardFile(root, file);
      const mine = new Set(keysOf(hunk.lines)), have = indexed(file, index), others = (keys) => new Set([...keys].filter((k) => !mine.has(k)));
      if (!have) return notify({ title: MIXED, body: "Discard it as a whole with shift-d", level: "warning" });
      // Unstaging first, so the index never keeps a change the working tree no longer has.
      if ([...have].some((k) => mine.has(k))) await stageLines(root, gitDir, file, others(have));
      await discardLines(root, file, others(keysOf(file.lines)));
    });
  }

  openDialog(kind, height) {
    openOverlay({ mod: "Bottleneck", kind: "dialog", width: 560, height, props: { [kind]: { root: this.root, space: this.space, gitDir: this.gitDir, tab: focused()?.tab } } });
  }

  openCommit() {
    const any = [...(this.staged?.values() ?? [])].some((e) => e.changed);
    if (this.mode === "uncommitted" && !any) return notify({ title: "Nothing staged", body: "Stage hunks with space first", level: "info", timeout: 2500 });
    this.openDialog("commit", 360);
  }

  openSend() {
    if (!saved(this.root).comments.length) return notify({ title: "No comments to send", level: "info", timeout: 2500 });
    this.openDialog("send", Math.min(624, 324 + Math.max(1, spaceAgents(this.space).length) * 36));
  }

  startEditing(editing, text = "") {
    this.editing = editing;
    this.draft.set_value(text);
    this.draft.focus();
    this.reveal = true;
  }

  edit({ file, hunk }) {
    const comment = place(this.files, saved(this.root).comments).byHunk.get(hunk);
    this.startEditing({ id: comment?.id ?? commentId(), path: file.path, anchor: hunk.anchor, start: hunk.start, end: hunk.end, diff: diffOf(hunk) }, comment?.text);
  }

  editFile(file) {
    const comment = place(this.files, saved(this.root).comments).byFile.get(file.path);
    const i = this.flat.findIndex((h) => h.file === file);
    if (i >= 0) this.at = i;
    this.startEditing({ id: comment?.id ?? commentId(), path: file.path, file: true }, comment?.text);
  }

  askAbout({ file, hunk }) {
    if (hunk.folded) return notify({ title: "Unfold the file with z to ask about a hunk", level: "info", timeout: 2500 });
    this.startEditing({ ask: true, agent: defaultAgent(this.space)?.address ?? null, of: { file, hunk }, path: file.path, start: hunk.start, end: hunk.end });
  }

  explain() {
    const hunks = this.flat.filter(({ hunk }) => !hunk.folded);
    if (!hunks.length) return notify({ title: "Nothing to explain", level: "info", timeout: 2500 });
    this.editing = { explain: true, agent: defaultAgent(this.space)?.address ?? null, hunks, path: "" };
    this.handle.focus();
  }

  runExplain(cx) {
    const { hunks, agent: address } = this.editing, agent = agentAt(address), gitDir = this.gitDir;
    if (!agent) return;
    rememberAgent(this.space, agent);
    this.stopEditing();
    cx.spawn(async () => {
      // The old notes go first, so nothing from an earlier diff is shown against this one.
      await exec("rm", ["-f", notesPath(gitDir)]).catch(() => null);
      if (await ask(agent, explainRequest(gitDir, hunks))) notify({ title: `Asked ${agent.program.name} to explain ${plural(hunks.length, "hunk")}`, body: "Its notes appear above each hunk when it's done", level: "success", timeout: 4000 });
    });
  }

  saveDraft() {
    if (!this.editing) return;
    const text = this.draftText().trim(), e = this.editing;
    if (e.ask) {
      const agent = agentAt(e.agent);
      if (!agent) return;
      if (text) {
        rememberAgent(this.space, agent);
        ask(agent, question(e.of.file, e.of.hunk, text)).then((ok) => ok && notify({ title: `Asked ${agent.program.name}`, body: `Its answer is in ${agent.tab_name ? `tab ${agent.tab_name}` : "its tab"}`, level: "success", timeout: 3000 }));
      }
    } else if (e.reply) {
      const agent = agentAt(e.agent);
      if (!agent) return;
      if (text) {
        rememberAgent(this.space, agent);
        reply(this.root, this.gitDir, e.id, text, agent).then((ok) => ok && notify({ title: `Replied to ${agent.program.name}`, level: "success", timeout: 2500 }));
      }
    } else if (text) upsert(this.root, { ...e, text });
    else remove(this.root, [e.id]);
    this.stopEditing();
  }

  stopEditing() {
    this.editing = null;
    this.handle.focus();
  }

  // The list's rows, rebuilt only when the diff, the comments or the sizes change; selection, staging and search are read as rows are drawn.
  layout() {
    const comments = saved(this.root).comments, width = this.size?.width ?? 1200, talk = threads(this.root), ranking = this.ordering === "risk" ? order(this.root) : null;
    const stamp = JSON.stringify([this.version, this.rowH, width, comments, lastRound(this.root)?.at, talk, ranking]);
    if (stamp === this.layoutStamp) return this.list;
    this.layoutStamp = stamp;
    const { byHunk, byFile, outdated } = place(this.files, comments), counts = new Map([...groupByPath(comments)].map(([p, cs]) => [p, cs.length]));
    // A comment that became a conversation shows as that instead of as last review's card.
    const placed = placeThreads(this.files, talk), talking = new Set(talk.map((th) => th.id));
    const rounds = groupByPath(this.base?.review ? followUp(this.files, lastRound(this.root)).filter((c) => !talking.has(c.id)) : []);
    // talkRows: each conversation's row, how far in its box sits and where the box ends within the row, for the reply box to hang from.
    const items = [], hunkRows = [], headers = new Map(), talkRows = new Map(), add = (item) => items.push(item) - 1;
    const height = (text) => rows.commentHeight(text, width), talkHeight = (th) => rows.threadHeight(th, width);
    const standalone = (key, file, c, kind) => add({ key, height: height(c.text) + 2 + GAP, file, el: () => div().px(12).pb(GAP).child(rows.card(c, kind, this.t, height(c.text))) });
    const paths = new Set(this.files.map((f) => f.path));
    const gone = [...new Set([...outdated.keys(), ...byFile.keys(), ...rounds.keys()])].filter((p) => !paths.has(p)).map((path) => ({ path, status: "", add: 0, del: 0, hunks: [] }));
    let index = 0;
    const firstStaged = this.files.find((f) => f.staged);
    for (const file of [...this.files, ...gone]) {
      if (file === firstStaged) add({ key: "staged", height: rows.STAGED_H, el: () => rows.stagedDivider(this.files.filter((f) => f.staged).length, this.t) });
      headers.set(file.path, add({ key: `f:${file.path}`, height: FILE_H, file, el: () => this.fileHeader(file, counts.get(file.path) ?? 0, false) }));
      const ranked = file.staged ? null : riskOf(ranking, file.path);
      if (ranked) add({ key: `k:${file.path}`, height: rows.riskHeight(ranked, width), file, el: () => rows.riskLine(ranked, this.t) });
      if (byFile.has(file.path)) standalone(`fc:${file.path}`, file, byFile.get(file.path), "file");
      for (const th of placed.loose.get(file.path) ?? []) {
        // Staged code is done with, and so is its conversation, until you unstage it.
        if (file.staged) break;
        const box = { ...th, loose: true };
        talkRows.set(th.id, { row: add({ key: `lt:${th.id}`, height: talkHeight(box) + GAP, file, el: () => div().px(12).pb(GAP).child(rows.thread(box, this.programOf(th), this.t)) }), inset: 12, bottom: talkHeight(box) });
      }
      for (const c of rounds.get(file.path) ?? []) standalone(`r:${c.id}`, file, c, "round");
      for (const c of outdated.get(file.path) ?? []) standalone(`o:${c.id}`, file, c, "outdated");
      if (file.binary && !file.hunks.length) add({ key: `b:${file.path}`, height: this.rowH + GAP, file, el: () => div().px(24).h(this.rowH).text_color(this.t.dim).child("Binary file") });
      for (const hunk of file.hunks) {
        const i = index++, first = items.length, style = () => this.cardLook({ file, hunk }, i);
        const row = (key, height, el) => add({ key: `${key}:${i}`, height, file, hunk: i, el });
        if (hunk.folded) row("h", HEAD_H + 2 + GAP, () => rows.foldedCard(file, style()));
        else {
          const comment = byHunk.get(hunk), talks = placed.byHunk.get(hunk) ?? [], note = noteFor(this.notes, file, hunk), gap = rows.gapAfter(hunk), last = hunk.lines.length - 1;
          row("h", HEAD_H + 1, () => rows.hunkTop(file, hunk, style()));
          if (note) row("n", NOTE_H, () => rows.cardRow(rows.noteLine(note, this.t), style(), null));
          hunk.lines.forEach((l, n) => {
            const end = n === last && !comment && !(this.hunkState({ file, hunk }) !== "all" && talks.length);
            add({ key: `l:${i}:${n}`, height: this.rowH + (end ? 1 + gap : 0), file, hunk: i, el: () => rows.cardRow(rows.line(l, this.lineStyle), style(), end ? gap : null) });
          });
          const shown = this.hunkState({ file, hunk }) === "all" ? [] : talks;
          shown.forEach((th, k) => {
            const end = !comment && k === shown.length - 1;
            // Set off from the code by the card's own chrome around it, as GitHub does.
            talkRows.set(th.id, { row: items.length, inset: 23, bottom: 1 + 10 + talkHeight(th) });
            row(`t${k}`, 1 + 20 + talkHeight(th) + (end ? 1 + gap : 0), () => rows.below(div().border_t(1).border_color(this.t.border).bg(this.t.chrome).p(10)
              .child(rows.thread(th, this.programOf(th), this.t)), i === this.at, end ? gap : null, this.t));
          });
          if (comment) row("c", height(comment.text) + 1 + gap, () => rows.below(rows.card(comment, "hunk", this.t, height(comment.text)), i === this.at, gap, this.t));
        }
        hunkRows[i] = [first, items.length - 1];
      }
    }
    const offsets = [0];
    for (const it of items) offsets.push(offsets.at(-1) + it.height);
    return (this.list = { items, heights: items.map((it) => it.height), hunkRows, headers, talkRows, offsets });
  }

  cardLook(at, i) {
    return { selected: i === this.at, state: this.hunkState(at), t: this.t };
  }

  fileHeader(file, n, sticky) {
    return rows.fileHeader(file, this.fileState(file), sticky ? this.fileBubble(file, n) : rows.bubble(n, this.t), this.t);
  }

  // List rows can't take clicks of their own; only the sticky header's bubble is a button, the list's header row clicks as a whole.
  fileBubble(file, n) {
    const t = this.t;
    return rows.bubble(n, t).id(`bubble-${file.path}`).cursor_pointer().hover((s) => s.bg(n ? t.accent + "55" : t.hover).text_color(t.foreground))
      .tooltip(n ? `${plural(n, "comment")} · click to comment on the whole file` : "Comment on the whole file")
      .on_click((_e, cx) => { cx.stop_propagation(); this.editFile(file); cx.notify(); });
  }

  // Just under the header of the hunk (or file) it's about, kept inside the pane and clear of the sticky header; it may sit up to one row low.
  popTop(list, wholeFile, path, height = POP_H) {
    const row = wholeFile ? list.headers.get(path) : list.hunkRows[this.at]?.[0];
    if (row === undefined) return FILE_H + 6;
    const y = list.offsets[row] - list.offsets[Math.min(this.top, list.items.length - 1)] + (wholeFile ? FILE_H : HEAD_H + 1) + 6;
    return Math.max(FILE_H + 6, Math.min(y, (this.diffH ?? 600) - height));
  }

  // Floats over the diff rather than sitting in a row, so it keeps its buttons (rows can't have handlers) and never scrolls away.
  popover(list) {
    const t = this.t, e = this.editing, fresh = !saved(this.root).comments.some((c) => c.id === e.id), picking = e.explain || e.rank;
    const who = e.ask || e.reply || picking ? spaceAgents(this.space) : null, starts = e.starts ?? [];
    const picked = who?.some((a) => a.address === e.agent) || (e.agent?.startsWith("new:") && Boolean(starts[+e.agent.slice(4)]));
    const title = e.explain ? "Explain the diff" : e.rank ? "Rank by risk" : e.ask ? "Ask an agent" : e.reply ? "Reply" : e.file ? "File comment" : "Comment";
    const go = e.explain ? "Explain ⌘↵" : e.rank ? "Rank ⌘↵" : e.ask ? "Ask ⌘↵" : e.reply ? "Reply ⌘↵" : fresh ? "Add comment ⌘↵" : "Update comment ⌘↵";
    const target = e.explain ? plural(e.hunks.length, "hunk") : e.rank ? plural(this.files.length, "file") : e.file ? `${e.path} · whole file` : `${e.path.split("/").pop()} · ${linesLabel(e)}`;
    const about = e.explain ? "It writes one line per hunk on why it made the change, shown above each hunk. Folded files are left out."
      : "It ranks every file by how risky it is to get wrong, with a reason for each. The riskiest come first in the file list.";
    const height = (picking ? 150 : POP_H) + (who ? 36 + Math.max(1, who.length) * 36 : 0) + (starts.length ? 30 + starts.length * 36 : 0);
    return this.floating("cr-comment", this.popTop(list, e.file || picking, e.path, height), title, target)
      .when(Boolean(who), (el) => el.child(v_flex().px(16).pt(12).gap(6)
        .child(label(t, "To"))
        .child(agentList(t, who, e.agent, (a) => { e.agent = a.address; if (!picking) this.draft.focus(); }, "cr-agent"))
        .when(starts.length > 0, (el) => el.child(div().pt(6).child(label(t, "Or start a new one")))
          .child(newAgentList(t, starts, e.agent, (address) => { e.agent = address; }, "cr-agent")))))
      .when(!picking, (el) => el.child(div().px(16).py(12).child(div().h(110).px(8).py(6).rounded(6).border_1().border_color(t.input).bg(t.background).text_size(13).child(Textarea.new(this.draft).size_full()))))
      .when(Boolean(picking), (el) => el.child(div().px(16).py(12).text_size(13).text_color(t.muted).whitespace_normal().child(about)))
      .child(footer(t, null, [
        button("cr-comment-cancel", "Cancel", false, t, () => this.stopEditing()),
        button("cr-comment-save", go, true, t, (cx) => (e.explain ? this.runExplain(cx) : e.rank ? this.runRank(cx) : this.saveDraft()), !who || picked),
      ]));
  }

  confirm(list) {
    const t = this.t, c = this.confirming;
    return this.floating("cr-confirm", this.popTop(list, c.whole, c.file.path), c.title, c.target)
      .child(div().px(16).py(12).text_size(13).whitespace_normal().child(c.body))
      .child(footer(t, null, [
        button("cr-confirm-cancel", "Cancel", false, t, () => { this.confirming = null; this.handle.focus(); }),
        button("cr-confirm-go", c.file.untracked && c.whole ? "Delete ⌘↵" : "Discard ⌘↵", true, t, (cx) => this.discard(cx)),
      ]));
  }

  floating(id, top, title, target) {
    const t = this.t;
    return v_flex().id(id).absolute().top(top).right(24).w(POP_W).rounded(8).border_1().border_color(t.border).bg(t.popover).shadow_lg().overflow_hidden()
      .child(header(t, title, div().flex_none().max_w(220).truncate().text_size(12).text_color(t.muted).child(target)));
  }

  searchBar() {
    const t = this.t, hits = this.matches(), total = hits.filter(Boolean).length, at = hits[this.at] ? hits.slice(0, this.at + 1).filter(Boolean).length : 0;
    return h_flex().id("cr-search").absolute().top(FILE_H + 6).right(24).w(320).h(34).px(10).gap(8).items_center().rounded(8).border_1().border_color(t.border).bg(t.popover).shadow_lg().text_size(13)
      .child(div().flex_none().text_color(t.muted).child("/"))
      .child(div().flex_1().min_w(0).child(Input.new(this.search).w_full()))
      .child(div().flex_none().text_size(11).text_color(t.muted).child(this.query ? (total ? `${at || "-"} of ${total}` : "no match") : ""));
  }

  hints() {
    const t = this.t, shut = Boolean(shared(HINTS_SHUT));
    const cap = (k) => div().h(20).min_w(20).px(5).flex().items_center().justify_center().rounded(4).border_1().border_color(t.border).bg(t.raised)
      .font_family(mono()).text_size(11).text_color(t.foreground).child(k);
    const hint = ([commands, text]) => h_flex().gap(8).items_center()
      .child(h_flex().w(84).flex_none().gap(3).children(caps(commands).map(cap)))
      .child(div().flex_1().min_w(0).text_size(12).text_color(t.muted).truncate().child(text));
    const toggle = h_flex().id("cr-hints").gap(6).items_center().cursor_pointer().text_size(12).text_color(t.muted).hover((s) => s.text_color(t.foreground))
      .on_click((_e, cx) => { setShared(HINTS_SHUT, !shut); this.handle.focus(); cx.notify(); })
      .child(div().child(shut ? "▸" : "▾")).child(div().child(shut ? "Keys (?)" : "Keys"));
    return v_flex().gap(4).child(toggle).when(!shut, (e) => e.children(HINTS.map(hint)));
  }

  sidebar() {
    const t = this.t, comments = saved(this.root).comments, cur = this.flat[this.at], per = groupByPath(comments), ranking = order(this.root);
    const add = this.files.reduce((n, f) => n + f.add, 0), del = this.files.reduce((n, f) => n + f.del, 0), seen = this.files.filter((f) => f.viewed).length;
    const tab = (mode, text) => div().id(`mode-${mode}`).flex_1().h(28).flex().items_center().justify_center().rounded(5).cursor_pointer().text_size(13)
      .when(this.mode === mode, (e) => e.bg(t.solid).text_color(t.solid_foreground).font_semibold()).when(this.mode !== mode, (e) => e.text_color(t.muted).hover((s) => s.bg(t.hover)))
      .on_click((_e, cx) => this.setMode(mode, cx)).child(text);
    const tool = (id, icon, tip, on, act) => div().id(id).w(24).h(24).flex().items_center().justify_center().rounded(5).cursor_pointer().tooltip(tip)
      .when(on, (e) => e.bg(t.raised).text_color(t.foreground)).when(!on, (e) => e.text_color(t.muted).hover((s) => s.bg(t.hover).text_color(t.foreground)))
      .on_click((_e, cx) => { act(cx); this.handle.focus(); cx.notify(); })
      .child(svg(`mods/Bottleneck/ui/${icon}.svg`).size(14));
    const risky = this.ordering === "risk", staged = this.files.filter((f) => f.staged);
    const row = (f) => this.fileRow(f, per.get(f.path)?.length ?? 0, cur, risky && !f.staged ? riskOf(ranking, f.path) : null);
    const toolbar = h_flex().h(32).flex_none().px(14).gap(2).items_center().border_b(1).border_color(t.border)
      .child(div().flex_1().text_size(12).text_color(t.muted).child(this.files.length ? `${plural(this.files.length - staged.length, "file")} to review` : ""))
      .when(risky && Boolean(ranking), (e) => e.child(tool("rerank", "rerank", `Re-rank · ranked ${ago(ranking.at)}`, false, (cx) => this.rank(cx))).child(div().w(6)))
      .child(tool("order-path", "path", "Order by path", !risky, () => this.setOrdering("path")))
      .child(tool("order-risk", "risk", ranking ? "Order by risk" : "Rank by risk", risky, (cx) => { if (!risky) this.toggleOrdering(cx); }));
    const covers = this.base?.note ?? (this.mode === "branch" ? `Since ${this.base?.label ?? "main"}, including uncommitted`
      : this.mode === "review" ? `Since you sent your last review, ${ago(lastRound(this.root)?.at ?? Date.now())}` : "Since the last commit, including untracked");
    const empty = this.error ?? (this.loading ? "Loading changes…" : this.root ? "No changes" : "Open with cmd-shift-r from a tab in a git repo");
    return v_flex().w(LIST_W).flex_none().h_full().bg(t.chrome).border_r(1).border_color(t.border)
      .child(v_flex().p(10).gap(8).border_b(1).border_color(t.border)
        .child(h_flex().gap(8).items_center()
          .child(div().text_size(14).font_semibold().child("Code review"))
          .child(div().flex_1())
          .child(div().text_size(12).text_color(t.ansi2).child(`+${add}`))
          .child(div().text_size(12).text_color(t.ansi1).child(`−${del}`)))
        .child(h_flex().p(2).gap(2).rounded(7).bg(t.background).border_1().border_color(t.border)
          .child(tab("uncommitted", "Uncommitted")).child(tab("branch", "vs main")).child(tab("review", "Since review")))
        .child(div().text_size(12).text_color(t.muted).truncate().child(covers))
        .when(Boolean(this.base?.review), (e) => {
          const sent = followUp(this.files, lastRound(this.root)), done = sent.filter((c) => c.changed).length;
          return e.child(div().text_size(12).text_color(done === sent.length ? t.ansi2 : t.blocked).child(`${done} of ${plural(sent.length, "comment")} changed since`));
        }))
      .child(toolbar)
      .child(v_flex().id("cr-files").flex_1().min_h(0).overflow_y_scrollbar().p(6).gap(1)
        .children(this.files.filter((f) => !f.staged).map(row))
        .when(!this.files.length, (e) => e.child(div().p(8).text_size(13).text_color(t.dim).child(empty)))
        .when(staged.length > 0, (e) => e.child(h_flex().id("cr-staged").h(30).mt(6).px(8).gap(6).items_center().rounded(6).cursor_pointer().text_size(12).text_color(t.muted)
          .hover((s) => s.bg(t.hover).text_color(t.foreground))
          .on_click((_e, cx) => { this.setStagedShut(!this.stagedShut()); this.handle.focus(); cx.notify(); })
          .child(div().w(10).child(this.stagedShut() ? "▸" : "▾"))
          .child(div().font_semibold().child("Staged"))
          .child(div().px(6).rounded(4).bg(t.raised).text_size(11).child(String(staged.length)))))
        .when(staged.length > 0 && !this.stagedShut(), (e) => e.children(staged.map(row))))
      .when(this.limited, (e) => e.child(div().px(10).py(4).text_size(12).text_color(t.dim).child("Showing the first 300 files")))
      .child(v_flex().p(10).gap(8).border_t(1).border_color(t.border)
        .when(Boolean(this.staged) && this.flat.length > 0, (e) => {
          const done = this.flat.filter((h) => this.hunkState(h) === "all").length;
          return e.child(div().text_size(13).text_color(done ? t.ansi2 : t.muted).child(`${done} of ${this.flat.length} staged`));
        })
        .when(seen > 0, (e) => e.child(div().text_size(13).text_color(t.muted).child(`${seen} of ${plural(this.files.length, "file")} viewed`)))
        .child(this.hints())
        .child(div().id("send").h(32).flex().items_center().justify_center().rounded(7).text_size(13).cursor_pointer()
          .bg(comments.length ? t.solid : t.raised).text_color(comments.length ? t.solid_foreground : t.muted)
          .on_click((_e, cx) => { this.openSend(); cx.notify(); })
          .child(comments.length ? `Send ${plural(comments.length, "comment")}` : "No comments yet")));
  }

  stagedShut() {
    try { return localStorage.getItem("stagedShut") === "1"; } catch { return false; }
  }

  setStagedShut(shut) {
    try { localStorage.setItem("stagedShut", shut ? "1" : "0"); } catch {}
  }

  fileRow(f, n, cur, ranked) {
    const t = this.t, parts = f.path.split("/"), name = parts.pop(), state = this.fileState(f);
    return h_flex().id(`file-${f.path}`).h(30).flex_none().px(8).gap(8).items_center().rounded(6).cursor_pointer().when(f.viewed, (e) => e.opacity(0.5))
      .when(cur?.file === f, (e) => e.bg(t.selected)).hover((s) => s.bg(t.hover))
      .on_click((_e, cx) => { this.goToFile(f); this.handle.focus(); cx.notify(); })
      .when(Boolean(ranked), (e) => e.tooltip(ranked.reason))
      .when(Boolean(ranked), (e) => e.child(div().w(3).h(16).flex_none().rounded(2).bg(rows.riskColor(ranked.risk, t))))
      .child(rows.fileIcon(f, 15, t))
      .child(h_flex().flex_1().min_w(0).text_size(13)
        .child(div().text_color(t.muted).truncate().child(parts.length ? parts.join("/") + "/" : ""))
        .child(rows.named(div().flex_none().max_w(200).truncate(), f.status, t).child(name)))
      .child(this.fileBubble(f, n))
      .when(state === "some", (e) => e.child(rows.mark(state, t).text_size(12)))
      .child(div().text_size(12).text_color(t.ansi2).child(`+${f.add}`))
      .child(div().text_size(12).text_color(t.ansi1).child(`−${f.del}`))
      .when(Boolean(f.staged), (e) => e.child(div().id(`unstage-${f.path}`).w(20).h(20).flex_none().flex().items_center().justify_center().rounded(4).text_color(t.muted)
        .tooltip("Unstage").hover((s) => s.bg(t.raised).text_color(t.foreground))
        .on_click((_e, cx) => { cx.stop_propagation(); this.stageWhole(f, cx); this.handle.focus(); cx.notify(); })
        .child(svg("mods/Bottleneck/ui/unstage.svg").size(12))));
  }

  // One scroll, never two, or holding j bounces down to a tall hunk's end and back up to its header; scroll_to_item only brings a row to the nearer edge.
  revealSelection(list) {
    const talk = this.editing?.reply && list.talkRows.get(this.editing.id);
    if (talk) return this.revealReply(list, talk);
    const path = (this.editing?.file && this.editing.path) || (this.confirming?.whole && this.confirming.file.path);
    const header = path && this.flat[this.at]?.file.path !== path ? list.headers.get(path) : undefined;
    const [first, last] = header !== undefined ? [header, header] : list.hunkRows[this.at] ?? [];
    if (first === undefined) return;
    const { items, offsets } = list, height = this.diffH ?? 600;
    let above = first, room = 0;
    // More than the sticky header's height, whose 1px bottom border would otherwise cover the card's top border.
    while (above > 0 && room <= FILE_H) room += items[--above].height;
    const from = offsets[above], to = offsets[last + 1], viewTop = offsets[Math.min(this.top, items.length - 1)];
    if (from >= viewTop && to <= viewTop + height) return;
    if (from < viewTop) return this.scroll.scroll_to_item(above);
    // Below the view: put the lowest row that keeps the header on screen at the bottom edge, so the hunk shows whole if it fits, from its header if not.
    let end = last;
    while (end > above && offsets[end + 1] - from > height) end--;
    this.scroll.scroll_to_item(end);
  }

  // The reply box covers the conversation's status strip and hangs below it: scroll only if it wouldn't fit, and only as far as it needs.
  revealReply(list, talk) {
    const { items, offsets } = list, height = this.diffH ?? 600, viewTop = offsets[Math.min(this.top, items.length - 1)];
    const from = offsets[talk.row] + talk.bottom - 32, to = from + REPLY_H;
    if (from >= viewTop + FILE_H && to <= viewTop + height) return;
    if (from < viewTop + FILE_H) return this.scroll.scroll_to_item(talk.row);
    let end = talk.row;
    while (end < items.length - 1 && offsets[end + 1] < to) end++;
    this.scroll.scroll_to_item(end);
  }

  // GitHub's reply box: under the last message, as wide as the conversation, going to the agent the conversation is with.
  replyBox(list) {
    const t = this.t, e = this.editing, talk = list.talkRows.get(e.id), agent = agentAt(e.agent);
    const viewTop = list.offsets[Math.min(this.top, list.items.length - 1)] ?? 0;
    const top = talk ? Math.max(FILE_H + 6, Math.min(list.offsets[talk.row] + talk.bottom - 32 - viewTop, (this.diffH ?? 600) - REPLY_H)) : FILE_H + 6;
    return v_flex().id("cr-reply").absolute().top(top).left(talk?.inset ?? 24).right(talk?.inset ?? 24).h(REPLY_H).rounded(6).border_1().border_color(t.muted).bg(t.surface).shadow_lg().overflow_hidden()
      .child(div().px(12).pt(10).child(div().h(76).px(8).py(6).rounded(6).border_1().border_color(t.input).bg(t.background).text_size(13).child(Textarea.new(this.draft).size_full())))
      .child(h_flex().h(44).px(12).gap(8).items_center()
        .child(div().flex_1().min_w(0).truncate().text_size(12).text_color(t.muted).child(agent ? `Replying to ${agent.program.name}` : "The agent has closed, so there's no one to reply to"))
        .child(button("cr-reply-cancel", "Cancel", false, t, () => this.stopEditing()))
        .child(button("cr-reply-go", "Reply ⌘↵", true, t, () => this.saveDraft(), Boolean(agent))));
  }

  onKey(e, cx) {
    const done = () => { cx.stop_propagation(); cx.notify(); };
    if (this.editing && e.key === "escape") { this.stopEditing(); return done(); }
    if (this.editing?.explain || this.editing?.rank) {
      if (e.key === "enter" && e.modifiers.platform) this.editing.explain ? this.runExplain(cx) : this.runRank(cx);
      else if (e.key === "down" || e.key === "up") this.editing.agent = stepAgent(this.pickable(), this.editing.agent, e.key === "down");
      return done();
    }
    if (this.confirming) {
      if (e.key === "enter" && e.modifiers.platform) this.discard(cx);
      else if (e.key === "escape") this.confirming = null;
      return done();
    }
    if (this.searching) {
      if (e.key === "escape") { this.searching = false; this.clearSearch(); this.handle.focus(); done(); }
      return;
    }
    if (this.editing) return;
    if (this.query && e.key === "escape") { this.clearSearch(); return done(); }
    if (e.key_char === "?") { setShared(HINTS_SHUT, !shared(HINTS_SHUT)); return done(); }
    const command = commandFor(e);
    if (command) { this.command(command, cx); done(); }
  }

  clearSearch() {
    this.query = "";
    this.search.set_value("");
  }

  render(cx) {
    const t = (this.t = theme());
    if (this.origin()?.root !== this.root) this.refresh(cx);
    // Herdr focuses the pane, not anything inside it: without this, j/k/c do nothing until the tab is clicked.
    const f = focused(), active = f?.space === this.space && panes().some((p) => p.pane === f?.pane && p.mod === "Bottleneck");
    if (active && !this.typing && !shared(DIALOG) && !this.handle.is_focused()) cx.timer.after(16, () => (this.searching ? this.search : this.editing && !this.editing.explain && !this.editing.rank ? this.draft : this.handle).focus());
    // Code reads at the terminal's size, one smaller to fit the diff's gutter, unless bottleneck.json names a size; rows keep 12 on 20.
    const own = Number(this.prefs?.font_size);
    this.codeSize = own >= 8 ? Math.round(own) : Math.max(10, Math.round(Number(settings().font_size) || 13) - 1);
    this.rowH = Math.round(this.codeSize * 1.65);
    this.lineStyle = { t, rowH: this.rowH, codeSize: this.codeSize, hit: this.query ? matcher(this.query) : null };
    const list = this.layout(), { items } = list;
    if (this.reveal) { this.reveal = false; this.revealSelection(list); }
    // A header that is the first visible row may be partly scrolled off (the last file's can stay that way), so draw a whole one over it.
    const head = items[this.top], stuck = head?.file ?? null, past = stuck && head.key !== `f:${stuck.path}`;
    return h_flex().id("bottleneck").size_full().bg(t.canvas).text_color(t.foreground).text_size(13).track_focus(this.handle)
      .on_key_down((e, cx) => this.onKey(e, cx))
      .on_size_change((size, cx) => { this.size = size; cx.notify(); })
      .child(this.sidebar())
      .child(v_flex().flex_1().min_w(0).h_full()
        .child(div().id("cr-diff-box").flex_1().min_h(0).relative()
          .on_size_change((size, cx) => { if (size.height !== this.diffH) { this.diffH = size.height; cx.notify(); } })
          .child(v_virtual_list("cr-diff", items.length, list.heights, (i) => items[i].key, (r) => {
            if (r.start !== this.top) { this.top = r.start; this.wake?.(); }
            return items.slice(r.start, r.end).map((it) => div().w_full().h(it.height).overflow_hidden().child(it.el()));
          })
            .track_scroll(this.scroll).size_full()
            .on_item_click((key, cx) => {
              if (this.editing || this.confirming) return;
              const hunk = /^[hlcnt]\d*:(\d+)/.exec(key)?.[1], path = /^f:(.+)$/.exec(key)?.[1], file = path && this.files.find((f) => f.path === path);
              if (file) this.editFile(file);
              else if (hunk) { this.at = +hunk; this.handle.focus(); }
              cx.notify();
            }))
          .child(Scrollbar.vertical("cr-diff").viewport_from_layout().absolute().inset_0())
          .when(Boolean(stuck), (e) => e.child(div().absolute().top(0).left(0).right(0).bg(t.canvas).border_b(1).border_color(past ? t.border : t.canvas)
            .child(this.fileHeader(stuck, saved(this.root).comments.filter((c) => c.path === stuck.path).length, true))))
          .when(this.searching || Boolean(this.query), (e) => e.child(this.searchBar()))
          .when(Boolean(this.editing), (e) => e.child(this.editing.reply ? this.replyBox(list) : this.popover(list)))
          .when(Boolean(this.confirming), (e) => e.child(this.confirm(list)))
          .when(!items.length, (e) => e.child(div().absolute().top(16).left(16).text_color(t.dim).child(this.loading ? "Loading…" : "Nothing to review")))));
  }
}
