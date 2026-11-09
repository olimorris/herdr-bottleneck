// The diff's rows: file headers, the pieces of a hunk's card, code lines and comment cards.
import { div, svg, image } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { iconFor } from "./icons.js";
import { pathAt, ago, linesLabel } from "./words.js";
import { mono, programIcon } from "./ui.js";

export const LIST_W = 300, FILE_H = 34, HEAD_H = 26, GAP = 12, PART_GAP = 4, NOTE_H = 26;

// A guess at how many lines text wraps to in a card, since the list needs every row's height before drawing it.
function textRows(text, paneWidth) {
  const perLine = Math.max(20, Math.floor((paneWidth - LIST_W - 80) / 7));
  return text.split("\n").reduce((n, l) => n + Math.max(1, Math.ceil(l.length / perLine)), 0);
}

export const commentHeight = (text, paneWidth) => 20 + 18 + textRows(text, paneWidth) * 18;

const AVATAR = 24;

// The box's own height: its border, a path bar when it stands alone, each message (padding, name line, wrapped text, divider) and the status strip.
export const threadHeight = (thread, paneWidth) => 2 + (thread.loose ? 29 : 0) + 31
  + thread.messages.reduce((n, m, i) => n + (i > 0 ? 1 : 0) + 20 + 22 + textRows(m.text, paneWidth - AVATAR - 40) * 18, 0);

// The space after a card; between hunks (not parts of one) a rule runs through it, so where one ends and the next begins never needs a second look.
function gapBelow(gap, t) {
  return gap === GAP ? div().h(gap).flex().items_center().child(div().w_full().h(1).bg(t.border)) : div().h(gap);
}

export const gapAfter = (hunk) => (hunk.part && hunk.part < hunk.parts ? PART_GAP : GAP);

const stagedColor = (state, t) => (state === "all" ? t.ansi2 : t.blocked);

export function mark(state, t) {
  return div().text_color(stagedColor(state, t)).child(state === "all" ? "✓" : "◐");
}

function badge(state, t) {
  return div().flex_none().px(6).rounded(4).bg(t.background).text_color(stagedColor(state, t)).child(state === "all" ? "✓ staged" : "◐ partly staged");
}

// The speech bubble: the file's comment count once it has any, and a way to comment on the whole file.
export function bubble(n, t) {
  return h_flex().h(18).min_w(18).flex_none().px(n ? 5 : 0).gap(3).items_center().justify_center().rounded(4).font_weight(400)
    .when(n > 0, (e) => e.bg(t.accent + "33").text_size(10).text_color(t.foreground)).when(!n, (e) => e.text_color(t.muted))
    .when(n > 0, (e) => e.child(String(n))).child(svg("mods/Bottleneck/comment.svg").size(n ? 10 : 12));
}

// A viewed file trades its type icon for a tick, in the list and the diff alike, so "viewed" never rests on dimming alone.
export function fileIcon(file, size, t) {
  return file.viewed
    ? div().w(size).h(size).flex_none().flex().items_center().justify_center().text_size(size - 2).font_weight(700).text_color(t.ansi2).child("✓")
    : image(iconFor(file.path)).size(size).flex_none();
}

// The icon says what kind of file it is, so the name says what happened to it: green added, red and struck through deleted.
export function named(el, status, t) {
  return el.text_color(status === "A" ? t.ansi2 : status === "D" ? t.ansi1 : status ? t.foreground : t.dim).when(status === "D", (e) => e.line_through());
}

export function fileHeader(file, state, commentBubble, t) {
  return h_flex().h(FILE_H).px(12).gap(8).items_center().font_semibold()
    .child(fileIcon(file, 16, t))
    .child(named(div().flex_1().min_w(0).truncate(), file.status, t).child(file.path))
    .when(state !== "none", (e) => e.child(mark(state, t).text_size(12)))
    .when(file.clipped, (e) => e.child(div().text_size(11).text_color(t.dim).child("clipped")))
    .child(commentBubble)
    .child(div().text_size(11).text_color(t.ansi2).child(`+${file.add}`))
    .child(div().text_size(11).text_color(t.ansi1).child(`−${file.del}`));
}

// `look` is { selected, state, t }: the card's border shows the selection, and a fully staged card is dimmed.
const cardHead = (h, { selected, state, t }) => h.px(10).gap(8).items_center().border_color(selected ? t.muted : t.border)
  .bg(t.raised).text_color(t.muted).text_size(11).when(state === "all", (e) => e.opacity(0.4));

export function hunkTop(file, { header, context, part, parts, start, end }, look) {
  return div().px(12).child(cardHead(h_flex().h(HEAD_H + 1).border_t(1).border_x(1).rounded_t(6), look)
    .child(div().flex_1().min_w(0).truncate().child(`${header.replace(/ @@.*/, " @@")} ${context}`))
    .when(look.state !== "none", (e) => e.child(badge(look.state, look.t)))
    .when(Boolean(parts), (e) => e.child(div().flex_none().px(6).rounded(4).bg(look.t.background).child(`part ${part} of ${parts}`)))
    .child(div().child(pathAt(file.path.split("/").pop(), { start, end }))));
}

export const STAGED_H = 60;

// Where the files you've staged begin, at the end of the diff: a green rule across the pane, then what's below it.
export function stagedDivider(n, t) {
  return v_flex().w_full().h(STAGED_H).px(12).pt(14).gap(10)
    .child(div().w_full().h(2).rounded(1).bg(t.ansi2 + "88"))
    .child(h_flex().h(20).gap(8).items_center().text_size(13)
      .child(div().flex_none().font_weight(700).text_color(t.ansi2).child(`✓ Staged · ${n} file${n === 1 ? "" : "s"}`))
      .child(div().flex_1().min_w(0).truncate().text_size(12).text_color(t.muted).child("Done with. ⇧space on a file unstages it")));
}

export function foldedCard(file, look) {
  const why = file.staged ? "Staged, ⇧space to unstage" : file.viewed ? "Viewed, v to unmark" : file.noise ? `${file.noise[0].toUpperCase()}${file.noise.slice(1)}, folded` : "Folded";
  return div().px(12).child(cardHead(h_flex().h(HEAD_H + 2).border_1().rounded(6), look)
    .child(div().flex_1().min_w(0).truncate().child(why))
    .when(look.state !== "none", (e) => e.child(badge(look.state, look.t)))
    .child(div().flex_none().child("z to show")))
    .child(gapBelow(GAP, look.t));
}

// One line of a hunk's card; `gap` is set on the card's last row, which closes it.
export function cardRow(content, { selected, state, t }, gap) {
  const last = gap !== null;
  return div().px(12).child(div().border_x(1).when(last, (e) => e.border_b(1).rounded_b(6)).border_color(selected ? t.muted : t.border)
    .bg(t.background).overflow_hidden().when(state === "all", (e) => e.opacity(0.4)).child(content)).when(last, (e) => e.child(gapBelow(gap, t)));
}

// Like GitHub's callouts: high is a Caution, medium a Warning, low a quiet tick.
const RISK = { high: ["High risk", "ansi1", "caution"], medium: ["Medium risk", "ansi3", "risk"], low: ["Low risk", "ansi2", "low"] };

export const riskColor = (risk, t) => t[RISK[risk]?.[1]] ?? t.muted;

// The callout's padding and title line, then the reason wrapped below.
export const riskHeight = (ranked, paneWidth) => 16 + 20 + 4 + textRows(ranked.reason, paneWidth - 30) * 18 + 10;

export function riskLine(ranked, t) {
  const [title, , icon] = RISK[ranked.risk] ?? [ranked.risk, null, "risk"], color = riskColor(ranked.risk, t);
  return div().px(12).pb(10).child(v_flex().pl(14).pr(12).py(8).gap(4).border_l(4).border_color(color)
    .child(h_flex().h(20).gap(8).items_center()
      .child(svg(`mods/Bottleneck/ui/${icon}.svg`).size(16).text_color(color))
      .child(div().text_size(13).font_weight(700).text_color(color).child(title)))
    .child(div().text_size(13).whitespace_normal().text_color(t.foreground).child(ranked.reason)));
}

export function noteLine(note, t) {
  return h_flex().h(NOTE_H).px(10).gap(8).items_center().bg(t.surface).border_b(1).border_color(t.border).text_size(12)
    .child(div().flex_none().text_color(t.muted).child("Why"))
    .child(div().flex_1().min_w(0).truncate().text_color(t.foreground).child(note.note));
}

// `hit` is the search's matcher, or null when nothing is searched.
export function line({ kind, number, text, spans }, { t, rowH, codeSize, hit }) {
  const tint = kind === "+" ? t.ansi2 : kind === "-" ? t.ansi1 : null;
  return h_flex().h(rowH).flex_none().gap(8).font_family(mono()).text_size(codeSize)
    .when(Boolean(tint), (e) => e.bg(tint + "1c"))
    .when(Boolean(hit?.(text)), (e) => e.bg(t.blocked + "33"))
    .child(div().w(Math.round(codeSize * 3.7)).flex_none().text_right().text_color(t.dim).child(String(number ?? "")))
    .child(div().w(10).flex_none().text_color(tint ?? t.dim).child(kind === " " ? "" : kind))
    .child(spans?.length
      ? h_flex().flex_1().min_w(0).overflow_hidden().children(spans.map((s) => div().flex_none().whitespace_nowrap().when(Boolean(s.color), (e) => e.text_color(s.color))
        .when(s.emph && Boolean(tint), (e) => e.bg(tint + "4d").rounded(2)).child(s.text)))
      : div().flex_1().min_w(0).truncate().whitespace_nowrap().child(text || " "));
}

// kind: "hunk" is the bottom of its hunk's card; "file", "outdated" and "round" (a comment you sent last time) stand alone at the top of their file.
export function card(comment, kind, t, height) {
  const where = comment.file ? comment.path : pathAt(comment.path, comment);
  const label = kind === "outdated" ? `Outdated · ${comment.path}:${comment.start}` : kind === "file" ? "File comment · f to edit, x to delete"
    : kind === "round" ? `Last review · ${where} · ${comment.changed ? "changed since" : "untouched"}` : "Comment · c to edit, x to delete";
  const bar = kind === "outdated" ? t.dim : kind === "round" ? (comment.changed ? t.ansi2 : t.blocked) : t.accent;
  return h_flex().min_h(height).bg(t.surface).border_color(t.border).when(kind === "hunk", (e) => e.border_t(1)).when(kind !== "hunk", (e) => e.rounded(6).border_1().overflow_hidden())
    .child(div().w(3).h_full().flex_none().bg(bar))
    .child(v_flex().flex_1().min_w(0).px(12).py(10).gap(4)
      .child(div().text_size(11).text_color(t.muted).child(label))
      .child(div().text_size(13).whitespace_normal().child(comment.text)));
}

// A saved comment or a conversation is its own row under its hunk's lines, so a long one can be scrolled to; `gap` is set on the row that closes the card.
export function below(content, selected, gap, t) {
  const last = gap !== null;
  return div().px(12).child(v_flex().border_x(1).when(last, (e) => e.border_b(1).rounded_b(6)).border_color(selected ? t.muted : t.border).overflow_hidden().child(content)).when(last, (e) => e.child(gapBelow(gap, t)));
}

// A sent comment and the agent's answers, boxed apart from the code like a GitHub review thread; `program` is the agent's, for its avatar.
export function thread(th, program, t) {
  const waiting = th.messages.at(-1)?.from === "you", agent = program?.name ?? th.name ?? "Agent";
  const avatar = (m) => div().w(AVATAR).h(AVATAR).flex_none().rounded(AVATAR / 2).bg(t.raised).flex().items_center().justify_center()
    .child(m.from === "agent" && program ? programIcon(program, t) : svg("mods/Bottleneck/ui/user.svg").size(14).text_color(t.muted));
  const message = (m, i) => h_flex().items_start().gap(10).px(12).py(10).when(i > 0, (e) => e.border_t(1).border_color(t.border))
    .child(avatar(m))
    .child(v_flex().flex_1().min_w(0).gap(4)
      .child(h_flex().h(18).gap(6).items_center().text_size(12)
        .child(div().font_semibold().text_color(t.foreground).child(m.from === "agent" ? agent : "You"))
        .child(div().text_color(t.muted).child(ago(m.at))))
      .child(div().text_size(13).whitespace_normal().child(m.text)));
  return v_flex().rounded(6).border_1().border_color(t.border).bg(t.background).overflow_hidden()
    .when(Boolean(th.loose), (e) => e.child(h_flex().h(28).px(12).items_center().border_b(1).border_color(t.border).bg(t.raised).text_size(12).text_color(t.muted)
      .child(div().truncate().child(th.file ? "Whole file" : linesLabel(th)))))
    .children(th.messages.map(message))
    .child(h_flex().h(30).px(12).gap(8).items_center().border_t(1).border_color(t.border).bg(t.surface).text_size(12)
      .child(div().w(8).h(8).flex_none().rounded(4).bg(waiting ? t.blocked : th.flagged && th.messages.length === 1 ? t.accent : t.ansi2))
      .child(div().flex_1().min_w(0).truncate().text_color(t.muted).child(waiting ? `Waiting for ${agent}` : th.flagged && th.messages.length === 1 ? `${agent} flagged this for you` : `${agent} answered`))
      .child(div().flex_none().text_color(t.muted).child("r reply · x close")));
}
