// Bottleneck's folder in .git, shared with its MCP server (mcp/tools.js): the mod writes threads.json and files.json for the agent to read, the server leaves messages in inbox/.
import { exec, readTextFile, writeTextFile } from "herdr";

export const folderOf = (gitDir) => `${gitDir}/bottleneck`;

// Unchanged content isn't written again, so two review tabs on one repo can't keep rewriting each other's file.
export async function publish(gitDir, name, value) {
  const path = `${folderOf(gitDir)}/${name}`, text = JSON.stringify(value, null, 2) + "\n", now = await readTextFile(path);
  if (now === text) return;
  await exec("mkdir", ["-p", folderOf(gitDir)]);
  await writeTextFile(path, text, now);
}

// Each message is moved out of inbox/ before it's read, so when two tabs share a repo only one of them takes it.
export async function collect(gitDir) {
  const inbox = `${folderOf(gitDir)}/inbox`, listed = await exec("ls", ["-1", inbox]);
  if (listed.code !== 0) return [];
  const out = [];
  for (const name of listed.stdout.split("\n").filter((n) => /^[^.].*\.json$/.test(n)).sort()) {
    const mine = `${folderOf(gitDir)}/taken-${name}`;
    if ((await exec("mv", [`${inbox}/${name}`, mine])).code !== 0) continue;
    try { out.push(JSON.parse((await readTextFile(mine)) ?? "null")); } catch {}
    await exec("rm", ["-f", mine]);
  }
  return out.filter((m) => m && typeof m.type === "string");
}
