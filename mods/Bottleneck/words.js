export const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

// A hunk's or comment's lines as people write them: "6-10", or "6" for one line.
export const lineRange = ({ start, end }) => (end > start ? `${start}-${end}` : `${start}`);
export const pathAt = (path, lines) => `${path}:${lineRange(lines)}`;
export const linesLabel = (lines) => `${lines.end > lines.start ? "lines" : "line"} ${lineRange(lines)}`;
