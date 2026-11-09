#!/usr/bin/env node
// Bottleneck's MCP server: the agent reads review comments, replies to them and ranks the diff by risk, in the repo it was started in.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { readFileSync } from "node:fs";
import { RISKS, folderOf, getComments, replyToComment, setReviewOrder, addComment } from "./tools.js";

const { version } = JSON.parse(readFileSync(new URL("../mod.json", import.meta.url), "utf8"));
// Agents only flag their own code if they're told to; Claude Code puts a server's instructions in the agent's context.
const instructions = "Bottleneck is the user's code review tool. When you change code, flag each place you're unsure about, guessed at, or the reviewer should look at closely with add_comment, on the line in question. Keep each to a sentence or two. Answer review comments with reply_to_comment.";
const server = new McpServer({ name: "bottleneck", version }, { instructions });

// The agent sees a failed call's message and can correct itself, rather than the call crashing the server.
const tool = (job) => async (args) => {
  try { return { content: [{ type: "text", text: await job(await folderOf(process.cwd()), args) }] }; }
  catch (e) { return { content: [{ type: "text", text: String(e?.message ?? e) }], isError: true }; }
};

server.registerTool("get_comments", {
  description: "Read the code review comments the user left in Bottleneck, each with its id, the diff it's about and the conversation so far.",
}, tool((folder) => getComments(folder)));

server.registerTool("reply_to_comment", {
  description: "Answer a review comment in Bottleneck, where the user sees it under the code. Say what you changed, or why you didn't.",
  inputSchema: { id: z.string().describe("The comment's id"), text: z.string().describe("Your reply") },
}, tool(replyToComment));

server.registerTool("set_review_order", {
  description: "Rank every file in the diff by how risky it is to get wrong, riskiest first, so the user reviews those first in Bottleneck.",
  inputSchema: {
    files: z.array(z.object({
      path: z.string().describe("The file's path, as Bottleneck listed it"),
      risk: z.enum(RISKS),
      reason: z.string().describe("One short sentence on why"),
    })).describe("Every file in the diff, riskiest first"),
  },
}, tool(setReviewOrder));

server.registerTool("add_comment", {
  description: "Flag a place in your changes for the user's code review, such as something you're unsure about or guessed at. It shows under that code in Bottleneck, and the user can reply.",
  inputSchema: {
    path: z.string().describe("The file's path from the repo root"),
    line: z.number().int().optional().describe("A line in the file as it is now; leave it out to comment on the whole file"),
    text: z.string().describe("What the reviewer should know, in a sentence or two"),
  },
}, tool((folder, args) => addComment(folder, args, server.server.getClientVersion()?.name)));

await server.connect(new StdioServerTransport());
