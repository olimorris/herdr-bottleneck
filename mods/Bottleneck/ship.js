// Getting staged work out: the commit, the push, and the pull request.
import { exec } from "herdr";
import { git, must, defaultBranch } from "./git.js";

const SHOWN = 8;

export async function commit(root, message) {
  const out = await must(root, "git", ["commit", "-q", "-m", message]);
  const sha = (await git(root, ["rev-parse", "--short", "HEAD"])).stdout.trim();
  return { out, sha };
}

const currentBranch = async (root) => (await git(root, ["rev-parse", "--abbrev-ref", "HEAD"])).stdout.trim();

// The upstream if there is one, else a new branch of the same name on origin, carrying the commits no remote has yet.
export async function pushPlan(root) {
  const branch = await currentBranch(root);
  if (!branch || branch === "HEAD") return { error: "Not on a branch, so there's nothing to push." };
  const up = await git(root, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]);
  const upstream = up.code === 0 ? up.stdout.trim() : null;
  const range = upstream ? [`${upstream}..HEAD`] : ["HEAD", "--not", "--remotes"];
  const [count, log] = await Promise.all([git(root, ["rev-list", "--count", ...range]), git(root, ["log", "--format=%h%x09%s", "-n", String(SHOWN), ...range])]);
  const commits = log.stdout.split("\n").filter(Boolean).map((l) => { const [sha, ...rest] = l.split("\t"); return { sha, subject: rest.join("\t") }; });
  return { branch, upstream, ahead: +count.stdout.trim(), commits, remote: upstream ? upstream.split("/")[0] : "origin" };
}

export function push(root, plan) {
  return must(root, "git", plan.upstream ? ["push"] : ["push", "-u", plan.remote, "HEAD"]);
}

// Offered when gh is installed and the branch isn't the default one; `url` is its open pull request, if it has one.
export async function prPlan(root) {
  const [gh, branch, main] = await Promise.all([exec("gh", ["--version"]).catch(() => null), currentBranch(root), defaultBranch(root)]);
  const base = main?.replace(/^origin\//, "");
  if (gh?.code !== 0 || !branch || branch === "HEAD" || branch === base) return null;
  // A merged or closed pull request for the branch shouldn't stop you opening a new one.
  const open = await exec("gh", ["pr", "view", "--json", "url,state", "-q", 'select(.state == "OPEN") | .url'], { cwd: root }).catch(() => null);
  return { branch, base, url: (open?.code === 0 && open.stdout.trim()) || null };
}

// gh prints the new pull request's URL last.
export async function createPr(root, title, body) {
  const out = await must(root, "gh", ["pr", "create", "--title", title, "--body", body]);
  return out.trim().split("\n").pop();
}
