import { div } from "gpui-kit";
import { v_flex } from "gpui-base";
import { theme, notify } from "herdr";
import { FormDialog } from "./form.js";
import { staged } from "./git.js";
import { commit } from "./ship.js";
import { saved } from "./review.js";
import { plural } from "./words.js";
import { button, header, footer, titleField, bodyField } from "./ui.js";

export class CommitDialog extends FormDialog {
  constructor(props, cx) {
    super(props, cx, { kind: "commit", placeholder: "Body (optional)", rows: 4 });
    this.stagedFiles = null;
    this.title.focus();
    cx.spawn(async (cx) => { this.stagedFiles = [...(await staged(this.root)).values()].filter((e) => e.changed).length; cx.notify(); });
  }

  request(path) {
    return `Write a commit message for the staged changes (\`git diff --cached\`), in the style of this repo's recent commits (\`git log\`). Write it to ${path}: the title on the first line, then a blank line, then a body if it helps. Don't commit, stage or change anything else.`;
  }

  submit(cx) {
    const title = this.title.value().trim(), body = this.bodyText().trim();
    if (!title) return;
    this.work(cx, "Couldn't commit", async () => {
      const { sha } = await commit(this.root, body ? `${title}\n\n${body}` : title);
      notify({ title: `Committed ${sha}`, body: title, level: "success", timeout: 4000 });
      this.finish();
    });
  }

  render() {
    const t = theme(), unsent = saved(this.root).comments.length, ready = this.title.value().trim().length > 0;
    if (this.choosing) return this.chooser(t, "Draft a commit message");
    return v_flex().id("cr-commit").size_full().bg(t.popover).text_color(t.foreground).text_size(13)
      .child(header(t, this.stagedFiles === null ? "Commit" : `Commit ${plural(this.stagedFiles, "staged file")}`))
      .child(v_flex().flex_1().min_h(0).px(16).py(12).gap(10)
        .when(unsent > 0, (e) => e.child(div().text_size(12).text_color(t.blocked).child(`${plural(unsent, "comment")} not sent yet. Comments on what you commit will be outdated.`)))
        .child(titleField(this.title, t))
        .child(bodyField(this.body, t)))
      .child(footer(t, this.status("↵ moves to the body", "Committing…"), [
        this.draftButton("cr-commit-draft", t),
        button("cr-commit-cancel", "Cancel", false, t, () => this.dismiss()),
        button("cr-commit-go", "Commit ⌘↵", true, t, (cx) => this.submit(cx), ready && !this.busy),
      ]));
  }
}
