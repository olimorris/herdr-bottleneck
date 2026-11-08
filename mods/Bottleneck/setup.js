// The setup dialog: what the MCP server lets agents do, what setting it up changes, and the config for agents other than Claude Code.
import { div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { theme, notify } from "herdr";
import { Dialog } from "./dialog.js";
import { copy } from "./review.js";
import { setUp, serverPath, serverConfig } from "./install.js";
import { button, header, footer, label, mono } from "./ui.js";

const CLAUDE = {
  added: "Added to Claude Code. Restart any Claude Code that's already running so it starts the server.",
  already: "Claude Code already has it.",
  missing: "Claude Code isn't installed, so add it to your agent with the config above.",
};

export class SetupDialog extends Dialog {
  constructor({ tab }, cx) {
    super(tab, cx);
    Object.assign(this, { state: "idle", step: null, result: null, error: null });
    this.handle.focus();
  }

  run(cx) {
    if (this.state === "running") return;
    if (this.state === "done") return this.dismiss();
    Object.assign(this, { state: "running", error: null });
    cx.spawn(async (cx) => {
      try {
        this.result = await setUp((text) => { this.step = text; cx.notify(); });
        this.state = "done";
        notify({ title: "Bottleneck's MCP server is set up", level: "success", timeout: 3000 });
      } catch (e) {
        Object.assign(this, { state: "idle", error: String(e?.message ?? e) });
      }
      cx.notify();
    });
  }

  render() {
    const t = theme(), config = serverConfig(serverPath()), done = this.state === "done";
    const point = (text) => h_flex().gap(8).child(div().flex_none().text_color(t.muted).child("·")).child(div().flex_1().min_w(0).whitespace_normal().child(text));
    const status = this.state === "running" ? this.step : done ? CLAUDE[this.result] : null;
    return v_flex().id("cr-setup").size_full().bg(t.popover).text_color(t.foreground).text_size(13).track_focus(this.handle)
      .on_key_down((e, cx) => { if (e.key === "enter" && e.modifiers.platform) { this.run(cx); cx.stop_propagation(); cx.notify(); } })
      .child(header(t, "Let agents answer in Bottleneck"))
      .child(v_flex().id("cr-setup-body").flex_1().min_h(0).overflow_y_scrollbar().px(16).py(12).gap(12)
        .child(div().whitespace_normal().child("With Bottleneck's MCP server, an agent answers each comment you send under the code, and can rank the diff by risk."))
        .child(v_flex().gap(4)
          .child(label(t, "Setting it up"))
          .child(point("Installs the server's packages with npm, inside Bottleneck's folder"))
          .child(point("Adds it to Claude Code for all your projects, if you have Claude Code")))
        .child(v_flex().gap(6)
          .child(h_flex().items_center().child(div().flex_1().child(label(t, "For other agents, add this to their MCP config")))
            .child(button("cr-setup-copy", "Copy", false, t, (cx) => cx.spawn(async () => { if (await copy(config)) notify({ title: "Copied the MCP config", level: "success", timeout: 2000 }); }))))
          .child(div().px(10).py(8).rounded(6).border_1().border_color(t.border).bg(t.background).font_family(mono()).text_size(11).whitespace_normal().child(config)))
        .when(Boolean(this.error), (e) => e.child(div().text_size(12).text_color(t.ansi1).whitespace_normal().child(this.error)))
        .when(Boolean(status), (e) => e.child(div().text_size(12).text_color(done ? t.ansi2 : t.muted).whitespace_normal().child(status))))
      .child(footer(t, null, done ? [button("cr-setup-close", "Close", true, t, () => this.dismiss())] : [
        button("cr-setup-cancel", "Cancel", false, t, () => this.dismiss()),
        button("cr-setup-go", this.state === "running" ? "Setting up…" : "Set up ⌘↵", true, t, (cx) => this.run(cx), this.state !== "running"),
      ]));
  }
}
