// Plain letters live here rather than in keys.json, which would take them from the comment box too.
export const KEYS = {
  h: "prev_mode", l: "next_mode", j: "next_hunk", k: "prev_hunk", "shift-j": "next_file", "shift-k": "prev_file", c: "comment", f: "comment_file", x: "delete", s: "send",
  space: "stage", "shift-space": "stage_file", d: "discard", "shift-d": "discard_file", "shift-c": "commit", "shift-p": "push", z: "fold",
  e: "explain", a: "ask", v: "viewed",
  "/": "search", n: "next_match", "shift-n": "prev_match", "+": "more_context", "-": "less_context",
};

// Typed symbols arrive as whatever key makes them (shift-= for +), so these go by the character.
const SYMBOLS = { "+": "more_context", "=": "more_context", "-": "less_context", "/": "search" };

export function commandFor({ key, key_char, modifiers: m }) {
  if (m.platform || m.control || m.alt) return null;
  return SYMBOLS[key_char] ?? KEYS[(m.shift ? "shift-" : "") + key.toLowerCase()] ?? null;
}

// By command, so the footer always shows the keys KEYS really binds.
export const HINTS = [
  [["prev_mode", "next_mode"], "previous / next view"], [["next_hunk", "prev_hunk"], "next / previous hunk"], [["next_file", "prev_file"], "next / previous file"],
  [["comment"], "comment on hunk"], [["comment_file"], "comment on file"], [["delete"], "delete comment"], [["send"], "send comments"],
  [["stage"], "stage hunk"], [["stage_file"], "stage file"], [["discard"], "discard hunk"], [["discard_file"], "discard file"],
  [["commit"], "commit"], [["push"], "push"], [["fold"], "fold file"], [["viewed"], "mark file viewed"],
  [["explain"], "agent explains diff"], [["ask"], "ask about hunk"],
  [["search"], "search the diff"], [["next_match", "prev_match"], "next / previous match"], [["more_context", "less_context"], "more / less context"],
];

const KEY_OF = Object.fromEntries(Object.entries(KEYS).map(([k, c]) => [c, k]));

// "shift-j" and "shift-k" become ⇧ J K: shift once, then each key; with some shifted and some not (n, shift-n), each shifted key gets its own ⇧.
export function caps(commands) {
  const keys = commands.map((c) => KEY_OF[c]).filter(Boolean), upper = (k) => (k.length === 1 ? k.toUpperCase() : k);
  if (keys.every((k) => k.startsWith("shift-"))) return ["⇧", ...keys.map((k) => upper(k.slice(6)))];
  return keys.map((k) => (k.startsWith("shift-") ? `⇧${upper(k.slice(6))}` : k));
}
