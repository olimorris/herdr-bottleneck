// The mod imports Herdr's modules by bare name; outside Herdr they resolve to the stand-ins next to this file.
import { register } from "node:module";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Your own git config (signing, hooks, delta's settings) stays out of the tests.
const folder = mkdtempSync(join(tmpdir(), "bottleneck-gitconfig-")), config = join(folder, "gitconfig");
process.on("exit", () => rmSync(folder, { recursive: true, force: true }));
writeFileSync(config, "[user]\n\tname = Test\n\temail = test@example.com\n[init]\n\tdefaultBranch = main\n[commit]\n\tgpgsign = false\n");
process.env.GIT_CONFIG_GLOBAL = config;
process.env.GIT_CONFIG_NOSYSTEM = "1";

register("./resolve.js", import.meta.url);
