#!/bin/sh
# Installs or updates Bottleneck in Herdr: copies the mod, binds cmd-shift-r, then checks it loads.
set -eu

here=$(cd "$(dirname "$0")" && pwd)
home=${HERDR_APP_HOME:-$HOME/.config/herdr-app}
mod=$home/mods/Bottleneck
keys=$home/keys.json

# A copy, not a symlink: Herdr loads a linked folder but never reloads it.
mkdir -p "$home/mods"
rm -rf "$mod"
cp -R "$here/mods/Bottleneck" "$mod"
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

if command -v herdr-app >/dev/null 2>&1; then
  herdr-app check "$mod"
else
  echo "herdr-app isn't on your PATH, so the mod wasn't checked"
fi
