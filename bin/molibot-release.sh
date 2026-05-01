#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
OUTPUT_DIR="${1:-$ROOT_DIR/dist/molibot-release}"
MARKER_FILE=".molibot-release"

if [[ -e "$OUTPUT_DIR" && ! -f "$OUTPUT_DIR/$MARKER_FILE" ]]; then
  if [[ -d "$OUTPUT_DIR" ]] && [[ -z "$(find "$OUTPUT_DIR" -mindepth 1 -maxdepth 1 -print -quit)" ]]; then
    :
  else
    echo "Refusing to overwrite non-release directory: $OUTPUT_DIR" >&2
    echo "Choose an empty directory or an existing Molibot release directory containing $MARKER_FILE." >&2
    exit 1
  fi
fi

ensure_root_dependency() {
  local package_name="$1"
  local package_spec="$2"
  local has_dependency
  has_dependency="$(node -e "const p=require('./package.json'); const deps={...(p.dependencies||{}), ...(p.optionalDependencies||{})}; process.stdout.write(deps[process.argv[1]] ? '1' : '0')" "$package_name")"
  if [[ "$has_dependency" == "1" ]]; then
    return 0
  fi
  echo "Adding missing root production dependency: $package_spec"
  npm install --package-lock-only --save "$package_spec"
}

(
  cd "$ROOT_DIR"
  ensure_root_dependency "qrcode-terminal" "qrcode-terminal@^0.12.0"
  ensure_root_dependency "mpg123-decoder" "mpg123-decoder@^1.0.3"
)

if [[ "${MOLIBOT_RELEASE_SKIP_BUILD:-0}" != "1" ]]; then
  (
    cd "$ROOT_DIR"
    npm ci
    npm run build
  )
fi

rm -rf "$OUTPUT_DIR"
mkdir -p "$OUTPUT_DIR/bin"
printf "molibot release bundle\n" > "$OUTPUT_DIR/$MARKER_FILE"

cp -R "$ROOT_DIR/build" "$OUTPUT_DIR/build"
cp "$ROOT_DIR/package.json" "$OUTPUT_DIR/package.json"
cp "$ROOT_DIR/package-lock.json" "$OUTPUT_DIR/package-lock.json"
cp "$ROOT_DIR/.env.example" "$OUTPUT_DIR/.env.example"

for script_name in molibot.js molibot-release.sh molibot-manage.js molibot-service.sh molibot-update.sh; do
  if [[ -f "$ROOT_DIR/bin/$script_name" ]]; then
    cp "$ROOT_DIR/bin/$script_name" "$OUTPUT_DIR/bin/$script_name"
  fi
done

if [[ -d "$ROOT_DIR/assets/test-images" ]]; then
  mkdir -p "$OUTPUT_DIR/assets"
  cp -R "$ROOT_DIR/assets/test-images" "$OUTPUT_DIR/assets/test-images"
fi

if [[ -d "$ROOT_DIR/src/lib/server/agent/prompts" ]]; then
  mkdir -p "$OUTPUT_DIR/src/lib/server/agent"
  cp -R "$ROOT_DIR/src/lib/server/agent/prompts" "$OUTPUT_DIR/src/lib/server/agent/prompts"
fi

if [[ -d "$ROOT_DIR/src/lib/server/agent/tools/subagent-agents" ]]; then
  mkdir -p "$OUTPUT_DIR/build/server/chunks"
  cp -R "$ROOT_DIR/src/lib/server/agent/tools/subagent-agents" "$OUTPUT_DIR/build/server/chunks/subagent-agents"
fi

(
  cd "$OUTPUT_DIR"
  npm ci --omit=dev
)

cat > "$OUTPUT_DIR/README.release.md" <<'EOF'
# Molibot Release Bundle

This directory is a production runtime artifact. Start it with:

```bash
NODE_ENV=production node build
```

For background process management:

```bash
MOLIBOT_APP_DIR="$(pwd)" ./bin/molibot-service.sh start
```

Keep `.env` and `DATA_DIR` outside this directory so releases can be replaced safely.
EOF

echo "Molibot release bundle created: $OUTPUT_DIR"
