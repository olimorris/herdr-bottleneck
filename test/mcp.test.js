import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "../mods/Bottleneck/mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js";
import { StdioClientTransport } from "../mods/Bottleneck/mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js";
import { changes, touches } from "../mods/Bottleneck/git.js";
import { upsert, diffOf, deliver, message } from "../mods/Bottleneck/review.js";
import { threads, placeThreads, reply, receive, order, arrange, mcpReady } from "../mods/Bottleneck/threads.js";
import { publish, collect, folderOf } from "../mods/Bottleneck/channel.js";
import { getComments, replyToComment, setReviewOrder, addComment } from "../mods/Bottleneck/mcp/tools.js";
import { enableMcp, serverPath, serverConfig } from "../mods/Bottleneck/install.js";
import { reset, calls, setAppHome } from "./support/herdr.js";
import { repo, lines, look } from "./support/repo.js";

beforeEach(reset);

const agent = { address: "a1", program: { name: "Claude Code" } };
const server = new URL("../mods/Bottleneck/mcp/server.js", import.meta.url).pathname;

async function sent(t) {
  const r = repo(t, { "a.js": lines(1, 20), "b.js": lines(1, 5) });
  r.write("a.js", lines(1, 20).replace("line 10\n", "line ten\n"));
  r.write("b.js", lines(1, 5).replace("line 2\n", "line two\n"));
  const { files } = await changes(r.root, "HEAD", look), hunk = files[0].hunks[0];
  upsert(r.root, { id: "c1", path: "a.js", anchor: hunk.anchor, start: hunk.start, end: hunk.end, text: "Why ten?", diff: diffOf(hunk) });
  await deliver("submit", agent, r.root, { gitDir: r.gitDir, mcp: true });
  return { r, files, folder: folderOf(r.gitDir) };
}

test("with the MCP server, each sent comment carries its id and the agent is asked to answer it", () => {
  const text = message([{ id: "c1", path: "a.js", start: 3, end: 3, text: "Why?" }], true);
  assert.match(text, /a\.js:3 · id c1/);
  assert.match(text, /reply_to_comment/);
  assert.doesNotMatch(message([{ id: "c1", path: "a.js", start: 3, end: 3, text: "Why?" }]), /id c1|reply_to_comment/);
});

test("sending turns comments into threads the server can read before the agent gets them", async (t) => {
  const { r, folder } = await sent(t);
  assert.deepEqual(threads(r.root).map((th) => [th.id, th.name, th.messages.map((m) => m.from)]), [["c1", "Claude Code", ["you"]]]);
  const read = await getComments(folder);
  assert.match(read, /^Comment c1 on a\.js:10/);
  assert.match(read, /-line 10\n\+line ten/);
  assert.match(read, /Reviewer: Why ten\?/);
});

test("a reply reaches its thread once, and an unknown id is refused", async (t) => {
  const { r, folder } = await sent(t);
  await assert.rejects(replyToComment(folder, { id: "nope", text: "Done" }), /No comment with id nope/);
  await replyToComment(folder, { id: "c1", text: "Renamed it back. " });
  const first = await collect(r.gitDir);
  assert.deepEqual(first, [{ type: "reply", id: "c1", text: "Renamed it back." }]);
  assert.deepEqual(await collect(r.gitDir), []);
  await receive(r.root, r.gitDir, first);
  assert.deepEqual(threads(r.root)[0].messages.map((m) => [m.from, m.text]), [["you", "Why ten?"], ["agent", "Renamed it back."]]);
  assert.match(await getComments(folder), /You: Renamed it back\./);
});

test("replying in Bottleneck nudges the thread's agent with the reply", async (t) => {
  const { r } = await sent(t);
  calls.hc = [];
  assert.equal(await reply(r.root, r.gitDir, "c1", "Use a constant instead", agent), true);
  const [[cmd, to, text]] = calls.hc;
  assert.deepEqual([cmd, to], ["send", "a1"]);
  assert.match(text, /comment c1 \(a\.js:10\)/);
  assert.match(text, /Use a constant instead/);
  assert.equal(threads(r.root)[0].messages.at(-1).text, "Use a constant instead");
});

test("a ranking must name every file in the view exactly once", async (t) => {
  const { r, files, folder } = await sent(t);
  await assert.rejects(setReviewOrder(folder, { files: [] }), /no review open/);
  await publish(r.gitDir, "files.json", { files: files.map((f) => f.path) });
  const rank = (path, risk) => ({ path, risk, reason: `${path} is ${risk}` });
  await assert.rejects(setReviewOrder(folder, { files: [rank("b.js", "high")] }), /Missing: a\.js/);
  await assert.rejects(setReviewOrder(folder, { files: [rank("b.js", "high"), rank("c.js", "low"), rank("a.js", "low")] }), /Not in the diff: c\.js/);
  await assert.rejects(setReviewOrder(folder, { files: [rank("b.js", "high"), rank("b.js", "low"), rank("a.js", "low")] }), /Listed twice: b\.js/);
  await setReviewOrder(folder, { files: [rank("b.js", "high"), rank("a.js", "low")] });
  await receive(r.root, r.gitDir, await collect(r.gitDir));
  assert.deepEqual(order(r.root).files.map((f) => f.path), ["b.js", "a.js"]);
  assert.deepEqual(arrange([{ path: "a.js" }, { path: "new.js" }, { path: "b.js" }], order(r.root)).map((f) => f.path), ["b.js", "a.js", "new.js"]);
});

test("the tab's own files in .git don't refresh the diff, the server's messages do", async (t) => {
  const r = repo(t, { "a.js": "a\n" }), dir = r.gitDir;
  assert.equal(await touches(r.root, dir, [`${dir}/bottleneck/threads.json`, `${dir}/bottleneck/taken-1.json`]), false);
  assert.equal(await touches(r.root, dir, [`${dir}/bottleneck/inbox/1.json`]), true);
  assert.equal(await touches(r.root, dir, [`${dir}/bottleneck.md`]), true);
});

test("publishing the same threads again leaves the file alone", async (t) => {
  const { r, folder } = await sent(t);
  const before = readFileSync(join(folder, "threads.json"), "utf8");
  await publish(r.gitDir, "threads.json", JSON.parse(before));
  assert.equal(readFileSync(join(folder, "threads.json"), "utf8"), before);
  assert.deepEqual(readdirSync(folder).sort(), ["threads.json"]);
});

test("a hunk keeps every thread on it; one whose hunk is gone sits loose in its file", () => {
  const hunk = { anchor: "x", start: 5, end: 9 }, files = [{ path: "a.js", hunks: [hunk] }];
  const list = [{ id: "1", path: "a.js", anchor: "x", start: 5 }, { id: "2", path: "a.js", anchor: "x", start: 6 }, { id: "3", path: "a.js", anchor: "gone", start: 1 }, { id: "4", path: "a.js", file: true }];
  const { byHunk, loose } = placeThreads(files, list);
  assert.deepEqual(byHunk.get(hunk).map((t) => t.id), ["1", "2"]);
  assert.deepEqual(loose.get("a.js").map((t) => t.id), ["3", "4"]);
});

test("the server runs over stdio in the agent's repo and answers through the same files", async (t) => {
  const { r, folder } = await sent(t);
  const client = new Client({ name: "test", version: "1" });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [server], cwd: r.root, stderr: "ignore" }));
  t.after(() => client.close());
  assert.deepEqual((await client.listTools()).tools.map((x) => x.name).sort(), ["add_comment", "get_comments", "reply_to_comment", "set_review_order"]);
  assert.match(client.getInstructions(), /flag each place you're unsure about/);
  const got = await client.callTool({ name: "get_comments", arguments: {} });
  assert.match(got.content[0].text, /Comment c1/);
  const bad = await client.callTool({ name: "reply_to_comment", arguments: { id: "nope", text: "x" } });
  assert.equal(bad.isError, true);
  await client.callTool({ name: "reply_to_comment", arguments: { id: "c1", text: "Fixed" } });
  assert.deepEqual(readdirSync(join(folder, "inbox")).length, 1);
});

test("setting up keeps the rest of bottleneck.json and names the server by its installed path", async (t) => {
  const r = repo(t, {}), home = r.root;
  r.write("bottleneck.json", '{ "font_size": 16 }\n');
  await enableMcp(home);
  assert.deepEqual(JSON.parse(r.read("bottleneck.json")), { font_size: 16, mcp: true });
  assert.deepEqual(JSON.parse(serverConfig(serverPath(home))).mcpServers.bottleneck, { command: "node", args: [`${home}/mods/Bottleneck/mcp/server.js`] });
});

test("the server counts as set up only while its packages are there", async (t) => {
  const r = repo(t, {});
  setAppHome(r.root);
  t.after(() => setAppHome("/nonexistent"));
  assert.equal(await mcpReady(), false);
  r.write("bottleneck.json", '{ "mcp": true }\n');
  assert.equal(await mcpReady(), false);
  r.write("mods/Bottleneck/mcp/node_modules/@modelcontextprotocol/sdk/package.json", "{}\n");
  assert.equal(await mcpReady(), true);
});

test("the agent flags a line it wrote, and it opens a conversation under that line's hunk, named after the agent", async (t) => {
  const { r, files, folder } = await sent(t);
  await assert.rejects(addComment(folder, { path: "nope.js", line: 1, text: "x" }, "claude-code", r.root), /no nope\.js in this repo/);
  await assert.rejects(addComment(folder, { path: "../a.js", line: 1, text: "x" }, "claude-code", r.root), /no \.\.\/a\.js/);
  await assert.rejects(addComment(folder, { path: "a.js", line: 0, text: "x" }, "claude-code", r.root), /line must be/);
  await addComment(folder, { path: "a.js", line: 10, text: "Guessed at the name." }, "claude-code", r.root);
  await addComment(folder, { path: "b.js", text: "Check this whole file." }, "codex", r.root);
  const arrived = await receive(r.root, r.gitDir, await collect(r.gitDir), { files, agents: [agent] });
  const [line, whole] = arrived.map((a) => a.flagged);
  assert.deepEqual([line.path, line.start, line.file, line.name, line.agent, line.flagged], ["a.js", 10, false, "Claude Code", "a1", true]);
  assert.match(line.diff.join("\n"), /\+line ten/);
  assert.deepEqual([whole.path, whole.file, whole.name, whole.agent], ["b.js", true, "codex", null]);
  assert.deepEqual(threads(r.root).at(-1).messages.map((m) => m.from), ["agent"]);
  assert.match(await getComments(folder), /You: Guessed at the name\./);
});

test("a flagged line no hunk holds lands on the file instead", async (t) => {
  const { r, files, folder } = await sent(t);
  await addComment(folder, { path: "a.js", line: 1, text: "Untouched line." }, "claude-code", r.root);
  const [{ flagged }] = await receive(r.root, r.gitDir, await collect(r.gitDir), { files, agents: [agent] });
  assert.equal(flagged.file, true);
});
