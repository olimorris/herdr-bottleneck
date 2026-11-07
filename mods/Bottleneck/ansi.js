const OSC = /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g;
const SGR = /\x1b\[([0-9;]*)([A-Za-z])/g;

const hex = (r, g, b) => "#" + [r, g, b].map((n) => n.toString(16).padStart(2, "0")).join("");

function xterm(n, ansi) {
  if (n < 16) return ansi[n];
  if (n >= 232) { const v = 8 + (n - 232) * 10; return hex(v, v, v); }
  const i = n - 16, level = (c) => (c ? 55 + c * 40 : 0);
  return hex(level(Math.floor(i / 36)), level(Math.floor(i / 6) % 6), level(i % 6));
}

export const strip = (line) => line.replace(OSC, "").replace(SGR, "");

// Cut where the foreground color changes; backgrounds are dropped so the diff's own tint shows, but kept as `emph`, delta's mark for changed words.
export function spans(line, ansi) {
  const out = [];
  let color = null, emph = false, at = 0, m;
  const text = line.replace(OSC, "");
  const push = (s) => {
    if (!s) return;
    const last = out[out.length - 1];
    if (last && last.color === color && last.emph === emph) last.text += s;
    else out.push({ text: s, color, emph });
  };
  SGR.lastIndex = 0;
  while ((m = SGR.exec(text))) {
    push(text.slice(at, m.index));
    at = SGR.lastIndex;
    if (m[2] !== "m") continue;
    const codes = m[1] === "" ? [0] : m[1].split(";").map(Number);
    for (let i = 0; i < codes.length; i++) {
      const c = codes[i];
      if (c === 0) { color = null; emph = false; }
      else if (c === 39) color = null;
      else if (c === 49) emph = false;
      else if (c >= 30 && c <= 37) color = ansi[c - 30];
      else if (c >= 90 && c <= 97) color = ansi[c - 82];
      else if (c === 38 && codes[i + 1] === 5) { color = xterm(codes[i + 2], ansi); i += 2; }
      else if (c === 38 && codes[i + 1] === 2) { color = hex(codes[i + 2], codes[i + 3], codes[i + 4]); i += 4; }
      else if (c === 48 && codes[i + 1] === 5) { emph = true; i += 2; }
      else if (c === 48 && codes[i + 1] === 2) { emph = true; i += 4; }
      else if ((c >= 40 && c <= 47) || (c >= 100 && c <= 107)) emph = true;
      else if (c === 58 && codes[i + 1] === 5) i += 2;
      else if (c === 58 && codes[i + 1] === 2) i += 4;
    }
  }
  push(text.slice(at));
  return out;
}
