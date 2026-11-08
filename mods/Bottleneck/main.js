// Review an agent's changes hunk by hunk, comment on hunks, then hand the comments to an agent or a markdown file.
import { View, div } from "gpui-kit";
import { spaces, panes, focused, run, notify, props, closeOverlay } from "herdr";
import { repoRoot } from "./git.js";
import { ORIGIN, migrate, setEntry } from "./store.js";
import { ReviewTab } from "./tab.js";
import { SendDialog } from "./send.js";
import { CommitDialog } from "./commit.js";
import { PushDialog } from "./push.js";
import { SetupDialog } from "./setup.js";

// Opened by mod.open: note the tab you came from, then show the space's review tab.
function launch(cx) {
  cx.spawn(async () => {
    try {
      const f = focused(), space = spaces().find((s) => s.id === f?.space);
      if (!space) return;
      if (space.machine) return notify({ title: "Bottleneck works on this computer only", level: "warning" });
      const here = panes().filter((p) => p.tab === f.tab);
      if (here.some((p) => p.mod === "Bottleneck")) return;
      const cwd = here.find((p) => p.focused)?.cwd ?? here.find((p) => p.cwd)?.cwd ?? space.folder;
      const root = cwd && (await repoRoot(cwd));
      if (!root) return notify({ title: "Not a git repository", body: cwd ?? "", level: "warning" });
      setEntry(ORIGIN, space.id, { tab: f.tab, root });
      const tabs = new Set(space.tabs.map((t) => t.id)), open = panes().find((p) => p.mod === "Bottleneck" && tabs.has(p.tab));
      if (open) run("tab.select", { id: open.tab });
      else run("tab.new", { space: space.id, name: "Code review", mod: "Bottleneck", props: { space: space.id } });
    } finally {
      if (props()?.overlay) closeOverlay(props().overlay);
      else run("overlay.close", {});
    }
  });
  return null;
}

// One mod, chosen by what it was opened with: the launcher, the review tab, or one of its dialogs.
export default class Bottleneck extends View {
  init(_p, cx) {
    migrate();
    const p = props() ?? {};
    this.role = p.send ? new SendDialog(p.send, cx)
      : p.commit ? new CommitDialog(p.commit, cx)
      : p.push ? new PushDialog(p.push, cx)
      : p.setup ? new SetupDialog(p.setup, cx)
      : p.space ? new ReviewTab(p.space, cx)
      : launch(cx);
  }

  render(cx) {
    return this.role?.render(cx) ?? div();
  }

  close() {
    this.role?.close?.();
  }
}
