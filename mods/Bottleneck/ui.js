// The pieces every dialog is built from, so the comment box, send, commit and push look and behave alike.
import { div, svg, image } from "gpui-kit";
import { h_flex, v_flex, Input, Textarea } from "gpui-base";
import { settings } from "herdr";

export const mono = () => settings().font_family ?? "JetBrains Mono";

export function button(id, label, primary, t, action, enabled = true) {
  return div().id(id).h(28).px(14).flex().items_center().rounded(7).text_size(12)
    .bg(primary && enabled ? t.solid : t.raised).text_color(!enabled ? t.muted : primary ? t.solid_foreground : t.foreground)
    .when(enabled, (e) => e.cursor_pointer().hover((s) => s.opacity(0.85)).on_click((_e, cx) => { action(cx); cx.notify(); }))
    .child(label);
}

// A branch, ref or sha, set apart from the words around it.
export function code(t, text) {
  return div().flex_none().px(6).rounded(4).bg(t.raised).font_family(mono()).text_size(12).text_color(t.foreground).child(text);
}

// Title on the left, anything that says where or what on the right.
export function header(t, title, aside) {
  return h_flex().flex_none().px(16).py(12).gap(10).items_center().border_b(1).border_color(t.border)
    .child(div().flex_1().min_w(0).truncate().font_semibold().child(title))
    .when(Boolean(aside), (e) => e.child(aside));
}

// Status on the left, buttons on the right with the main action last.
export function footer(t, status, buttons) {
  return h_flex().flex_none().px(16).py(12).gap(8).items_center().border_t(1).border_color(t.border)
    .child(div().flex_1().min_w(0).truncate().text_size(12).text_color(t.muted).child(status ?? ""))
    .children(buttons);
}

const STATUS = { working: "working", blocked: "blocked", done: "done", idle: "idle" };

// Herdr doesn't say which model an agent runs, so each row's title and tab are what tell two Claude Codes apart; `enabled` false shows it for context only.
export const programIcon = (p, t) => !p.icon ? div().w(16).h(16).flex_none().rounded(4).bg(p.tile ?? t.raised)
  : p.tint ? svg(p.icon).size(16).flex_none().text_color(p.color ?? t.foreground) : image(p.icon).size(16).flex_none();

const pickRow = (id, on, enabled, t, pick) => h_flex().id(id).h(34).px(10).gap(10).items_center().rounded(7).text_size(12)
  .border_1().border_color(on ? t.muted : "#00000000").when(on, (e) => e.bg(t.raised))
  .when(enabled, (e) => e.cursor_pointer().hover((s) => s.bg(t.hover)).on_click((_e, cx) => { pick(); cx.notify(); }));

export function agentList(t, list, selected, pick, prefix, enabled = true) {
  return v_flex().gap(2)
    .when(!list.length, (e) => e.child(div().h(34).px(10).flex().items_center().text_size(12).text_color(t.muted).child("No agents in this space")))
    .children(list.map((a) => {
      const p = a.program;
      return pickRow(`${prefix}-${a.address}`, a.address === selected, enabled, t, () => pick(a))
        .child(programIcon(p, t))
        .child(div().flex_none().font_semibold().child(p.name))
        .child(div().flex_1().min_w(0).truncate().text_color(t.muted).child(a.title ?? ""))
        .child(div().flex_none().text_size(11).text_color(t.muted).child(a.tab_name ? `tab ${a.tab_name}` : ""))
        .child(div().w(8).h(8).flex_none().rounded(4).bg(t[STATUS[a.status] ?? "idle"] ?? t.muted));
    }));
}

// Agents Herdr can start, picked as `new:<index>` alongside the running ones.
export function newAgentList(t, programs, selected, pick, prefix) {
  return v_flex().gap(2).children(programs.map((p, i) => pickRow(`${prefix}-new-${i}`, selected === `new:${i}`, true, t, () => pick(`new:${i}`))
    .child(programIcon(p, t))
    .child(div().flex_none().font_semibold().child(`New ${p.name}`))
    .child(div().flex_1().min_w(0).truncate().text_color(t.muted).child("in a new tab"))));
}

// A section's small heading inside a dialog's body.
export function label(t, text) {
  return div().h(18).text_size(11).text_color(t.muted).child(text);
}

// git's own advice for a title: up to 50 characters, and never past 72.
export function titleField(state, t) {
  const n = state.value().length;
  return h_flex().h(32).flex_none().px(10).gap(8).items_center().rounded(6).border_1().border_color(t.input).bg(t.background)
    .child(div().flex_1().min_w(0).child(Input.new(state).w_full()))
    .child(div().flex_none().text_size(11).text_color(n > 72 ? t.ansi1 : n > 50 ? t.blocked : t.muted).child(String(n)));
}

export function bodyField(state, t) {
  return div().flex_1().min_h(0).px(8).py(6).rounded(6).border_1().border_color(t.border).bg(t.background).child(Textarea.new(state).size_full());
}

// cmd-enter in a text area inserts a line break before it reports the submit: when the last edit was exactly that, this hands back (and restores) the text without it.
export function submitted(state) {
  let before = state.value(), now = before;
  state.on("change", () => { before = now; now = state.value(); });
  return () => {
    const text = state.value();
    let i = 0;
    while (i < before.length && text[i] === before[i]) i++;
    if (text.length !== before.length + 1 || text[i] !== "\n" || text.slice(0, i) + text.slice(i + 1) !== before) return text;
    state.set_value(before);
    now = before;
    return before;
  };
}
