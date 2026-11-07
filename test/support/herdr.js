// Herdr's functions as the mod uses them, backed by Node: real processes and files, in-memory shared state.
import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";

export const calls = { hc: [], run: [], notify: [] };
let store = {};

export function reset() {
  store = {};
  for (const k of Object.keys(calls)) calls[k] = [];
}

export const exec = (command, args = [], options = {}) => new Promise((resolve, reject) =>
  execFile(command, args, { cwd: options.cwd, maxBuffer: 1 << 28 }, (error, stdout, stderr) => {
    if (error && typeof error.code === "string") return reject(error);
    resolve({ code: error ? error.code ?? 1 : 0, stdout, stderr });
  }));

export const readTextFile = async (path) => readFile(path, "utf8").catch(() => null);

// Like Herdr's: refuses to write when the file isn't what the caller last read.
export async function writeTextFile(path, text, expected) {
  const now = await readTextFile(path);
  if ((now ?? null) !== (expected ?? null)) throw new Error(`${path} changed since it was read`);
  await writeFile(path, text);
}

export const shared = (key) => store[key];
export const setShared = (key, value) => { store[key] = value; };
export const hc = async (args) => { calls.hc.push(args); return { code: 0, stdout: "", stderr: "" }; };
export const run = (command, args) => { calls.run.push([command, args]); };
export const notify = (n) => { calls.notify.push(n); };
export const agents = () => [];
export const watchFolder = () => new Promise(() => {});

// Imported by modules the tests load, but only used by the UI.
export const settings = () => ({}), theme = () => ({}), props = () => ({}), focused = () => null, panes = () => [], spaces = () => [];
export const openOverlay = () => {}, closeOverlay = () => {}, nextCommand = () => new Promise(() => {});
