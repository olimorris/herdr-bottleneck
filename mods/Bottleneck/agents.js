// Which agent to talk to: shared by the review tab and its dialogs, which are separate copies of the mod.
import { agents } from "herdr";
import { ORIGIN, LAST_AGENT, entry, setEntry } from "./store.js";

export function spaceAgents(space) {
  return agents().filter((a) => a.space === space);
}

export const agentAt = (address) => agents().find((a) => a.address === address) ?? null;

// The last agent you asked in this space if it's still there, else the one in the tab the review came from, else the first.
export function defaultAgent(space) {
  const all = spaceAgents(space), here = all.filter((a) => a.tab === entry(ORIGIN, space)?.tab), last = entry(LAST_AGENT, space);
  return all.find((a) => a.address === last) ?? (here.length === 1 ? here[0] : all[0]) ?? null;
}

export function rememberAgent(space, agent) {
  setEntry(LAST_AGENT, space, agent.address);
}

// ↑/↓ through the list, wrapping round at either end.
export function stepAgent(who, address, down) {
  const i = Math.max(0, who.findIndex((a) => a.address === address));
  return who[(i + (down ? 1 : who.length - 1)) % who.length]?.address ?? null;
}
