// The push dialog, which turns into the pull request form once the branch is pushed.
import { div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { theme, notify } from "herdr";
import { FormDialog } from "./form.js";
import { pushPlan, push, prPlan, createPr } from "./ship.js";
import { copy } from "./review.js";
import { plural } from "./words.js";
import { button, header, footer, code, mono, titleField, bodyField } from "./ui.js";

export class PushDialog extends FormDialog {
  constructor(props, cx) {
    super(props, cx, { kind: "pr", placeholder: "Description (optional)", rows: 6 });
    Object.assign(this, { plan: null, pr: null, stage: "push" });
    this.handle.focus();
    cx.spawn(async (cx) => { [this.plan, this.pr] = await Promise.all([pushPlan(this.root), prPlan(this.root)]); cx.notify(); });
  }

  get ready() {
    return Boolean(this.plan && !this.plan.error && this.plan.ahead > 0);
  }

  get offersPr() {
    return Boolean(this.pr && !this.pr.url);
  }

  toPr() {
    this.stage = "pr";
    this.title.focus();
  }

  pushBranch(cx) {
    const plan = this.plan;
    if (!this.ready) return;
    this.work(cx, "Couldn't push", async () => {
      await push(this.root, plan);
      notify({ title: `Pushed ${plan.branch}`, body: plan.upstream ?? `${plan.remote}/${plan.branch}`, level: "success", timeout: 4000 });
      if (this.offersPr) this.toPr(); else this.dismiss();
    });
  }

  request(path) {
    const { branch, base } = this.pr;
    return `Write a pull request title and description for the branch ${branch} (its commits are \`git log ${base}..HEAD\`). Use the repo's pull request template if it has one. Write it to ${path}: the title on the first line, then a blank line, then the description in Markdown. Don't create the pull request or change anything else.`;
  }

  submit(cx) {
    const title = this.title.value().trim();
    if (!title) return;
    this.work(cx, "Couldn't open the pull request", async () => {
      const url = await createPr(this.root, title, this.bodyText().trim());
      notify({ title: "Opened a pull request", body: (await copy(url)) ? `${url} (link copied)` : url, level: "success", timeout: 6000 });
      this.finish();
    });
  }

  render() {
    return this.stage === "pr" ? this.renderPr(theme()) : this.renderPlan(theme());
  }

  renderPlan(t) {
    const p = this.plan;
    const where = !p || p.error ? null : p.upstream
      ? h_flex().gap(6).items_center().text_size(12).text_color(t.muted).child("→").child(code(t, p.upstream))
      : div().px(6).py(1).rounded(4).bg(t.raised).text_size(11).text_color(t.blocked).child(`new branch on ${p.remote}`);
    const body = !p ? div().text_color(t.muted).child("Checking…")
      : p.error ? div().text_color(t.muted).child(p.error)
      : !p.ahead ? v_flex().gap(6).text_color(t.muted)
        .child(div().child(`Nothing to push. ${p.branch} is up to date${p.upstream ? ` with ${p.upstream}` : ""}.`))
        .when(Boolean(this.pr?.url), (e) => e.child(div().child(`Its pull request: ${this.pr.url}`)))
      : v_flex().gap(4)
        .children(p.commits.map((c) => h_flex().gap(10).text_size(12)
          .child(div().flex_none().font_family(mono()).text_color(t.muted).child(c.sha))
          .child(div().flex_1().min_w(0).truncate().child(c.subject))))
        .when(p.ahead > p.commits.length, (e) => e.child(div().text_size(12).text_color(t.muted).child(`and ${plural(p.ahead - p.commits.length, "more commit")}`)));
    const close = (primary) => button("cr-push-close", "Close", primary, t, () => this.dismiss());
    const buttons = this.ready
      ? [button("cr-push-cancel", "Cancel", false, t, () => this.dismiss()), button("cr-push-go", "Push ⌘↵", true, t, (cx) => this.pushBranch(cx), !this.busy)]
      : this.offersPr ? [close(false), button("cr-push-pr", "Open pull request", true, t, () => this.toPr())] : [close(true)];
    return v_flex().id("cr-push").size_full().bg(t.popover).text_color(t.foreground).text_size(13).track_focus(this.handle)
      .on_key_down((e, cx) => { if (e.key === "enter" && e.modifiers.platform) { this.pushBranch(cx); cx.stop_propagation(); } })
      .child(header(t, p?.branch ? h_flex().gap(8).items_center().child("Push").child(code(t, p.branch)) : "Push", where))
      .child(div().id("cr-push-commits").flex_1().min_h(0).overflow_y_scrollbar().px(16).py(12).child(body))
      .child(footer(t, this.busy ? "Pushing…" : null, buttons));
  }

  renderPr(t) {
    const pr = this.pr, ready = this.title.value().trim().length > 0;
    if (this.choosing) return this.chooser(t, "Draft a pull request");
    return v_flex().id("cr-pr").size_full().bg(t.popover).text_color(t.foreground).text_size(13)
      .child(header(t, "Pull request", h_flex().gap(6).items_center().text_size(12).text_color(t.muted).child(code(t, pr.branch)).child("→").child(code(t, pr.base ?? "default"))))
      .child(v_flex().flex_1().min_h(0).px(16).py(12).gap(10).child(titleField(this.title, t)).child(bodyField(this.body, t)))
      .child(footer(t, this.status("Opens with gh pr create", "Opening…"), [
        this.draftButton("cr-pr-draft", t),
        button("cr-pr-cancel", "Cancel", false, t, () => this.dismiss()),
        button("cr-pr-go", "Create PR ⌘↵", true, t, (cx) => this.submit(cx), ready && !this.busy),
      ]));
  }
}
