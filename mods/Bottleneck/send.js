// The send dialog: who to send the comments to, and how.
import { div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { theme } from "herdr";
import { Dialog } from "./dialog.js";
import { saved, deliver, writeReview } from "./review.js";
import { spaceAgents, defaultAgent, rememberAgent, agentAt, stepAgent } from "./agents.js";
import { plural } from "./words.js";
import { button, header, footer, agentList, label } from "./ui.js";

const OPTIONS = [
  { icon: "paste", label: "Paste", detail: "Into the agent's input, so you can add context", go: "Paste ⌘↵", how: "paste" },
  { icon: "send", label: "Send", detail: "Paste and press Enter for you", go: "Send ⌘↵", how: "submit" },
  { icon: "file", label: "Markdown file", detail: ".git/bottleneck.md, path copied", go: "Write file ⌘↵", how: "file" },
];

export class SendDialog extends Dialog {
  constructor({ space, root, gitDir, tab }, cx) {
    super(tab, cx);
    Object.assign(this, { space, root, gitDir, option: 0, agent: defaultAgent(space)?.address ?? null });
    this.handle.focus();
  }

  run(cx) {
    const option = OPTIONS[this.option], agent = agentAt(this.agent);
    if (option.how === "file") return cx.spawn(async () => { if (await writeReview(this.root, this.gitDir)) this.dismiss(); });
    if (!agent) return;
    rememberAgent(this.space, agent);
    cx.spawn(async () => { if (await deliver(option.how, agent, this.root)) this.dismiss(); });
  }

  optionCard(t, o, i) {
    const on = i === this.option;
    return v_flex().id(`cr-option-${i}`).flex_1().min_w(0).p(12).gap(6).rounded(8).cursor_pointer()
      .border_1().border_color(on ? t.muted : t.border).bg(on ? t.raised : t.background).hover((s) => s.bg(t.hover))
      .on_click((_e, cx) => { this.option = i; cx.notify(); })
      .child(h_flex().items_center()
        .child(svg(`mods/Bottleneck/ui/${o.icon}.svg`).size(16).text_color(on ? t.foreground : t.muted))
        .child(div().flex_1())
        .child(div().text_size(11).text_color(t.muted).child(String(i + 1))))
      .child(div().text_size(13).font_semibold().child(o.label))
      .child(div().text_size(11).text_color(t.muted).whitespace_normal().child(o.detail));
  }

  render() {
    const t = theme(), n = saved(this.root).comments.length, who = spaceAgents(this.space);
    const option = OPTIONS[this.option], needsAgent = option.how !== "file", ready = !needsAgent || who.some((a) => a.address === this.agent);
    return v_flex().id("cr-send").size_full().bg(t.popover).text_color(t.foreground).text_size(13).track_focus(this.handle)
      .on_key_down((e, cx) => {
        if ((e.key === "down" || e.key === "up") && needsAgent) this.agent = stepAgent(who, this.agent, e.key === "down");
        else if (e.key === "left" || e.key === "right") this.option = (this.option + (e.key === "right" ? 1 : OPTIONS.length - 1)) % OPTIONS.length;
        else if (/^[1-3]$/.test(e.key)) this.option = +e.key - 1;
        else if (e.key === "enter") { if (ready) this.run(cx); }
        else return;
        cx.stop_propagation(); cx.notify();
      })
      .child(header(t, `Send ${plural(n, "comment")}`))
      .child(v_flex().id("cr-send-body").flex_1().min_h(0).overflow_y_scrollbar().px(16).py(12).gap(14)
        .child(v_flex().gap(6).when(!needsAgent, (e) => e.opacity(0.4))
          .child(label(t, "To"))
          .child(agentList(t, who, this.agent, (a) => { this.agent = a.address; }, "cr-send-agent", needsAgent)))
        .child(v_flex().gap(6)
          .child(label(t, "How"))
          .child(h_flex().gap(8).children(OPTIONS.map((o, i) => this.optionCard(t, o, i))))))
      .child(footer(t, needsAgent ? "↑↓ agent · ←→ option" : "←→ option", [
        button("cr-send-cancel", "Cancel", false, t, () => this.dismiss()),
        button("cr-send-go", option.go, true, t, (cx) => this.run(cx), ready),
      ]));
  }
}
