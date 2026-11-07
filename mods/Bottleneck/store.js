// Herdr's shared store is the only state the review tab and its dialogs, separate copies of the mod, have in common.
import { shared, setShared } from "herdr";

export const ORIGIN = "bottleneck.origin", COMMENTS = "bottleneck.comments", ROUND = "bottleneck.round", VIEWED = "bottleneck.viewed";
export const DRAFTS = "bottleneck.drafts", LAST_AGENT = "bottleneck.lastAgent", HINTS_SHUT = "bottleneck.hintsCollapsed", DIALOG = "bottleneck.dialog";

// Most keys hold one entry per repo or space.
export const entry = (key, id) => shared(key)?.[id];
export const setEntry = (key, id, value) => setShared(key, { ...(shared(key) ?? {}), [id]: value });

// This mod was called CodeReview: its saved comments, rounds and choices move across once, so a rename loses nothing.
export function migrate() {
  for (const key of [COMMENTS, ROUND, VIEWED, DRAFTS, LAST_AGENT, ORIGIN, HINTS_SHUT]) {
    const old = key.replace(/^bottleneck/, "codereview");
    if (shared(key) === undefined && shared(old) !== undefined) setShared(key, shared(old));
  }
}
