export const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

// A hunk's or comment's lines as people write them: "6-10", or "6" for one line.
export const lineRange = ({ start, end }) => (end > start ? `${start}-${end}` : `${start}`);
export const pathAt = (path, lines) => `${path}:${lineRange(lines)}`;
export const linesLabel = (lines) => `${lines.end > lines.start ? "lines" : "line"} ${lineRange(lines)}`;

export const ago = (at) => { const m = Math.round((Date.now() - at) / 60000); return m < 1 ? "just now" : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`; };
