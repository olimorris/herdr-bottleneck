// Installing the MCP server from inside Bottleneck, the same steps as install.sh --mcp, so nobody has to find the repo to run a script.
import { exec, appHome, readTextFile, writeTextFile } from "herdr";

export const serverPath = (home = appHome()) => `${home}/mods/Bottleneck/mcp/server.js`;

export const serverConfig = (path) => JSON.stringify({ mcpServers: { bottleneck: { command: "node", args: [path] } } }, null, 2);

const has = async (program) => (await exec("sh", ["-c", `command -v ${program}`]).catch(() => ({ code: 1 }))).code === 0;

// Keeps whatever else bottleneck.json holds, like font_size.
export async function enableMcp(home = appHome()) {
  const path = `${home}/bottleneck.json`, now = await readTextFile(path);
  let prefs = {};
  try { prefs = JSON.parse(now ?? "{}") ?? {}; } catch {}
  await writeTextFile(path, JSON.stringify({ ...prefs, mcp: true }, null, 2) + "\n", now);
}

// `step(text)` reports progress. Returns whether Claude Code has the server: "added", "already" or "missing" (not installed).
export async function setUp(step, home = appHome()) {
  if (!(await has("npm"))) throw new Error("The MCP server needs Node.js 18 or later, and npm isn't on your PATH");
  step("Installing the server's packages…");
  const npm = await exec("npm", ["ci", "--omit=dev", "--no-audit", "--no-fund"], { cwd: `${home}/mods/Bottleneck/mcp` });
  if (npm.code !== 0) throw new Error(`npm ci: ${(npm.stderr || npm.stdout).trim()}`);
  let claude = "missing";
  if (await has("claude")) {
    step("Adding it to Claude Code…");
    if ((await exec("claude", ["mcp", "get", "bottleneck"])).code === 0) claude = "already";
    else {
      const add = await exec("claude", ["mcp", "add", "--scope", "user", "bottleneck", "--", "node", serverPath(home)]);
      if (add.code !== 0) throw new Error(`claude mcp add: ${(add.stderr || add.stdout).trim()}`);
      claude = "added";
    }
  }
  await enableMcp(home);
  return claude;
}
