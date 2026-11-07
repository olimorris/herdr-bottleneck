import { exec, readTextFile, writeTextFile } from "herdr";
import { git, must } from "./git.js";

const lines = (text) => {
  const all = text.split("\n");
  if (text.endsWith("\n")) all.pop();
  return all;
};

// Whole files go through git itself: new, deleted and binary files included.
export async function stageFile(root, path, on) {
  if (on) return must(root, "git", ["add", "-A", "--", path]);
  const hasHead = (await git(root, ["rev-parse", "--verify", "--quiet", "HEAD"])).code === 0;
  return must(root, "git", hasHead ? ["reset", "-q", "HEAD", "--", path] : ["rm", "--cached", "-q", "-r", "--", path]);
}

// HEAD's text plus exactly the changes in `keys`, so staging or discarding one part can never disturb another.
async function compose(root, file, keys) {
  const fromHead = await git(root, ["show", `HEAD:${file.path}`]);
  const headText = fromHead.code === 0 ? fromHead.stdout : "";
  const workText = (await readTextFile(`${root}/${file.path}`)) ?? "";
  const head = lines(headText), work = lines(workText);
  // A commit or an edit since the diff was read would shift its line numbers, and the wrong lines would be staged or undone.
  const stale = (l) => (l.kind === "+" && work[l.number - 1] !== l.text) || (l.kind === "-" && head[l.old - 1] !== l.text);
  if (file.lines.some(stale)) throw new Error("The file changed since the diff was read. Try again.");
  const out = [];
  let ptr = 1, last = null;
  const fromHeadLine = (n) => { out.push(head[n - 1]); last = n === head.length ? "head-end" : "head"; };
  for (const line of file.lines) {
    while (ptr < line.old) fromHeadLine(ptr++);
    if (line.kind === " ") fromHeadLine(ptr++);
    else if (line.kind === "-") { if (!keys.has(line.key)) fromHeadLine(line.old); ptr = line.old + 1; }
    else if (keys.has(line.key)) { out.push(work[line.number - 1]); last = line.number === work.length ? "work-end" : "work"; }
  }
  while (ptr <= head.length) fromHeadLine(ptr++);
  const newline = last === "head-end" ? headText.endsWith("\n") : last === "work-end" ? workText.endsWith("\n") : out.length > 0;
  return { text: out.join("\n") + (newline ? "\n" : ""), inHead: fromHead.code === 0, workText };
}

export async function stageLines(root, gitDir, file, keys) {
  const { text, inHead } = await compose(root, file, keys);
  if (!inHead && keys.size === 0) return must(root, "git", ["update-index", "--force-remove", "--", file.path]);

  const tmp = `${gitDir}/bottleneck-stage.tmp`;
  await writeTextFile(tmp, text, await readTextFile(tmp));
  try {
    const [sha, listed, inTree, exe] = await Promise.all([
      must(root, "git", ["hash-object", "-w", `--path=${file.path}`, tmp]),
      git(root, ["ls-files", "-s", "--", file.path]),
      inHead ? git(root, ["ls-tree", "HEAD", "--", file.path]) : null,
      exec("test", ["-x", `${root}/${file.path}`]),
    ]);
    const mode = listed.stdout.split(" ")[0] || inTree?.stdout.split(" ")[0] || (exe.code === 0 ? "100755" : "100644");
    await must(root, "git", ["update-index", "--add", "--cacheinfo", `${mode},${sha.trim()},${file.path}`]);
  } finally {
    await exec("rm", ["-f", tmp]);
  }
}

// The working tree file keeps only the changes in `keep`; the rest go back to what HEAD has.
export async function discardLines(root, file, keep) {
  const { text, workText } = await compose(root, file, keep);
  await writeTextFile(`${root}/${file.path}`, text, workText);
}

// Back to HEAD in the index and the working tree; a file HEAD doesn't have is removed from both.
export async function discardFile(root, file) {
  const inHead = (await git(root, ["cat-file", "-e", `HEAD:${file.path}`])).code === 0;
  if (inHead) return must(root, "git", ["restore", "--source=HEAD", "--staged", "--worktree", "--", file.path]);
  if (!file.untracked) await must(root, "git", ["rm", "-q", "-f", "--cached", "--", file.path]);
  return must(root, "rm", ["-f", "--", `${root}/${file.path}`]);
}
