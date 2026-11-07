// A dialog with a title and a body an agent can draft for you: the commit message and the pull request.
import { div } from "gpui-kit";
import { v_flex, InputState, TextareaState } from "gpui-base";
import { notify, exec, readTextFile, watchFolder } from "herdr";
import { Dialog } from "./dialog.js";
import { ask } from "./review.js";
import { spaceAgents, defaultAgent, rememberAgent, agentAt, stepAgent } from "./agents.js";
import { DRAFTS, entry, setEntry } from "./store.js";
import { button, header, footer, agentList, label, submitted } from "./ui.js";

export class FormDialog extends Dialog {
  // `kind` names the draft kept for this repo and the file the agent writes; subclasses give `request(path)` and `submit(cx)`.
  constructor({ root, space, gitDir, tab }, cx, { kind, placeholder, rows }) {
    super(tab, cx);
    Object.assign(this, { root, space, gitDir, kind, busy: false, done: false, drafting: null, choosing: null });
    this.title = InputState.new({ placeholder: "Title" });
    this.title.on("change", (_e, cx) => cx.notify());
    this.title.on("submit", (e, cx) => (e.secondary ? this.submit(cx) : this.body.focus()));
    this.body = TextareaState.new({ placeholder, rows });
    this.bodyText = submitted(this.body);
    this.body.on("submit", (e, cx) => { if (!e.shift) this.submit(cx); });
    const kept = entry(DRAFTS, root)?.[kind];
    if (kept) this.fill(kept.title, kept.body);
  }

  fill(title, body) {
    this.title.set_value(title);
    this.body.set_value(body);
  }

  // What you'd typed is kept per repo when the dialog closes unfinished, so a tab switch loses nothing.
  close() {
    super.close();
    this.drafting = null;
    const mine = { ...(entry(DRAFTS, this.root) ?? {}) }, title = this.title.value(), body = this.body.value();
    if (this.done || !(title.trim() || body.trim())) delete mine[this.kind]; else mine[this.kind] = { title, body };
    setEntry(DRAFTS, this.root, mine);
  }

  // The dialog's one action, with a second press ignored while it runs; `job` closes the dialog when it succeeds.
  work(cx, failed, job) {
    if (this.busy) return;
    this.busy = true;
    cx.notify();
    cx.spawn(async (cx) => {
      try { await job(); } catch (e) { notify({ title: failed, body: String(e?.message ?? e), level: "error" }); }
      this.busy = false;
      cx.notify();
    });
  }

  finish() {
    this.done = true;
    this.dismiss();
  }

  // The agent writes the draft to a file in .git, and the dialog fills itself in when the file appears.
  async draftWith(agent, cx) {
    const path = `${this.gitDir}/bottleneck-${this.kind}.txt`;
    await exec("rm", ["-f", path]);
    if (!(await ask(agent, this.request(path)))) return;
    rememberAgent(this.space, agent);
    const mine = (this.drafting = { name: agent.program.name });
    cx.notify();
    while (this.drafting === mine) {
      const text = await readTextFile(path);
      if (text?.trim()) {
        const [title, ...rest] = text.replace(/\r/g, "").split("\n");
        this.fill(title.trim(), rest.join("\n").trim());
        this.drafting = null;
        await exec("rm", ["-f", path]);
        break;
      }
      await watchFolder(this.gitDir);
    }
    cx.notify();
  }

  status(idle, working) {
    return this.drafting ? `Waiting for ${this.drafting.name}…` : this.busy ? working : idle;
  }

  // With one agent it drafts straight away; with several it asks which first, since you may keep a cheaper one for this.
  draftButton(id, t) {
    const who = spaceAgents(this.space);
    const go = (cx) => {
      if (who.length === 1) return cx.spawn(async (cx) => this.draftWith(who[0], cx));
      this.choosing = { agent: defaultAgent(this.space)?.address ?? null };
      this.handle.focus();
    };
    return button(id, "Draft with agent", false, t, go, who.length > 0 && !this.drafting && !this.busy);
  }

  chooser(t, title) {
    const c = this.choosing, who = spaceAgents(this.space), agent = agentAt(c.agent);
    const leave = () => { this.choosing = null; this.title.focus(); };
    const run = (cx) => { if (!agent) return; leave(); cx.spawn(async (cx) => this.draftWith(agent, cx)); };
    return v_flex().id("cr-choose").size_full().bg(t.popover).text_color(t.foreground).text_size(13).track_focus(this.handle)
      .on_key_down((e, cx) => {
        if (e.key === "down" || e.key === "up") c.agent = stepAgent(who, c.agent, e.key === "down");
        else if (e.key === "enter") run(cx);
        else if (e.key === "escape") leave();
        else return;
        cx.stop_propagation(); cx.notify();
      })
      .child(header(t, title))
      .child(v_flex().id("cr-choose-body").flex_1().min_h(0).overflow_y_scrollbar().px(16).py(12).gap(6)
        .child(label(t, "Draft with"))
        .child(agentList(t, who, c.agent, (a) => { c.agent = a.address; }, "cr-draft-agent"))
        .child(div().pt(6).text_size(12).text_color(t.muted).whitespace_normal().child("It writes a draft for you to edit. Nothing is committed or opened until you say so.")))
      .child(footer(t, "↑↓ agent", [
        button("cr-choose-back", "Back", false, t, leave),
        button("cr-choose-go", "Draft ⌘↵", true, t, run, Boolean(agent)),
      ]));
  }
}
