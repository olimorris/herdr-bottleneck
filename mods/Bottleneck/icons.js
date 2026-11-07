// File type icons from Material Icon Theme (MIT, see icons/LICENSE-material-icon-theme.txt), a common subset.
const BY_NAME = {
  "package.json": "nodejs", "package-lock.json": "nodejs", dockerfile: "docker", makefile: "makefile", "readme.md": "readme", readme: "readme",
  license: "license", "license.md": "license", "license.txt": "license", ".gitignore": "git", ".gitattributes": "git", ".gitmodules": "git", ".env": "tune",
};

const BY_EXT = {
  lua: "lua", json: "json", jsonc: "json", js: "javascript", mjs: "javascript", cjs: "javascript", ts: "typescript", mts: "typescript", cts: "typescript",
  jsx: "react", tsx: "react_ts", py: "python", go: "go", rs: "rust", rb: "ruby", java: "java", kt: "kotlin", kts: "kotlin", swift: "swift",
  c: "c", h: "h", cc: "cpp", cpp: "cpp", cxx: "cpp", hpp: "hpp", cs: "csharp", php: "php", html: "html", htm: "html", css: "css", scss: "sass",
  sass: "sass", less: "less", md: "markdown", markdown: "markdown", mdx: "markdown", yml: "yaml", yaml: "yaml", toml: "toml", xml: "xml", svg: "svg",
  png: "image", jpg: "image", jpeg: "image", gif: "image", webp: "image", ico: "image", bmp: "image", sh: "console", bash: "console", zsh: "console",
  fish: "console", ps1: "powershell", nix: "nix", vue: "vue", svelte: "svelte", sql: "database", sqlite: "database", db: "database", graphql: "graphql",
  gql: "graphql", ex: "elixir", exs: "elixir", erl: "erlang", hs: "haskell", clj: "clojure", cljs: "clojure", edn: "clojure", zig: "zig", vim: "vim",
  txt: "document", lock: "lock", ini: "settings", conf: "settings", cfg: "settings", env: "tune", dart: "dart", scala: "scala", r: "r", jl: "julia",
  ml: "ocaml", mli: "ocaml", pl: "perl", pm: "perl", tf: "terraform", proto: "proto", pdf: "pdf", zip: "zip", gz: "zip", tar: "zip", tgz: "zip",
  ttf: "font", otf: "font", woff: "font", woff2: "font",
};

export function iconFor(path) {
  const name = path.split("/").pop().toLowerCase();
  const icon = BY_NAME[name] ?? (name.endsWith(".d.ts") ? "typescript-def" : BY_EXT[name.includes(".") ? name.split(".").pop() : ""]) ?? "document";
  return `mods/Bottleneck/icons/${icon}.svg`;
}
