#!/bin/sh
# Installs or updates Bottleneck in Herdr: copies the mod, binds cmd-shift-r, then checks it loads.
# With --mcp it also sets up the MCP server, so agents can answer comments and rank the diff; later updates keep it set up.
set -eu

here=$(cd "$(dirname "$0")" && pwd)
home=${HERDR_APP_HOME:-$HOME/.config/herdr-app}
mod=$home/mods/Bottleneck
keys=$home/keys.json
prefs=$home/bottleneck.json

mcp=no
for arg in "$@"; do
  case $arg in
    --mcp) mcp=yes ;;
    *) echo "Usage: ./install.sh [--mcp]" >&2; exit 2 ;;
  esac
done
if [ -f "$prefs" ] && grep -q '"mcp": *true' "$prefs"; then mcp=yes; fi

# A copy, not a symlink: Herdr loads a linked folder but never reloads it.
mkdir -p "$home/mods"
rm -rf "$mod"
cp -R "$here/mods/Bottleneck" "$mod"
# Your clone's own packages may be for another platform or out of date; the server's are installed fresh below.
rm -rf "$mod/mcp/node_modules"
echo "Installed $mod"

bind_by_hand() {
  echo "Add this to $keys yourself:"
  echo '  { "global": { "cmd-shift-r": "mod.open:Bottleneck" } }'
}

if [ ! -f "$keys" ]; then
  printf '{\n  "global": {\n    "cmd-shift-r": "mod.open:Bottleneck"\n  }\n}\n' > "$keys"
  echo "Bound cmd-shift-r in $keys"
elif grep -q '"mod.open:Bottleneck"' "$keys"; then
  echo "cmd-shift-r is already bound"
elif command -v python3 >/dev/null 2>&1; then
  python3 - "$keys" <<'EOF' || bind_by_hand
import json, sys
path = sys.argv[1]
with open(path) as f:
    keys = json.load(f)
taken = keys.get("global", {}).get("cmd-shift-r")
if taken:
    print(f"cmd-shift-r is already bound to {taken}, so it was left alone")
    sys.exit(1)
keys.setdefault("global", {})["cmd-shift-r"] = "mod.open:Bottleneck"
with open(path, "w") as f:
    json.dump(keys, f, indent=2)
    f.write("\n")
print(f"Bound cmd-shift-r in {path}")
EOF
else
  bind_by_hand
fi

if [ "$mcp" = yes ]; then
  if ! command -v npm >/dev/null 2>&1; then
    echo "The MCP server needs Node.js 18 or later, and npm isn't on your PATH" >&2
    exit 1
  fi
  # From inside the folder: with --prefix, npm reads this repo's own package.json and refuses.
  if ! (cd "$mod/mcp" && npm ci --omit=dev --no-audit --no-fund --loglevel=error >/dev/null); then
    echo "Couldn't install the MCP server's packages, so agents can't reach Bottleneck until this is fixed" >&2
    exit 1
  fi
  echo "Installed the MCP server's packages"

  if [ ! -f "$prefs" ]; then
    printf '{\n  "mcp": true\n}\n' > "$prefs"
  elif ! grep -q '"mcp": *true' "$prefs"; then
    python3 - "$prefs" <<'EOF'
import json, sys
path = sys.argv[1]
with open(path) as f:
    prefs = json.load(f)
prefs["mcp"] = True
with open(path, "w") as f:
    json.dump(prefs, f, indent=2)
    f.write("\n")
EOF
  fi

  server="$mod/mcp/server.js"
  if command -v claude >/dev/null 2>&1; then
    if claude mcp get bottleneck >/dev/null 2>&1; then
      echo "Claude Code already has the bottleneck MCP server"
    else
      claude mcp add --scope user bottleneck -- node "$server"
      echo "Added the bottleneck MCP server to Claude Code"
    fi
  fi
  echo "For other agents, add this stdio MCP server:"
  printf '  { "mcpServers": { "bottleneck": { "command": "node", "args": ["%s"] } } }\n' "$server"
fi

if command -v herdr-app >/dev/null 2>&1; then
  herdr-app check "$mod"
else
  echo "herdr-app isn't on your PATH, so the mod wasn't checked"
fi
