#!/usr/bin/env bash
set -euo pipefail

DEPLOY_DIR="${MOLIBOT_DEPLOY_DIR:-$HOME/molibot}"
REPO_URL="${MOLIBOT_GIT_REPO:-https://github.com/gusibi/molibot}"
GIT_REF="${MOLIBOT_GIT_REF:-master}"
SOURCE_DIR="${MOLIBOT_BUILD_SOURCE_DIR:-$DEPLOY_DIR/source}"
RELEASES_DIR="${MOLIBOT_RELEASES_DIR:-$DEPLOY_DIR/releases}"
CURRENT_LINK="${MOLIBOT_CURRENT_LINK:-$DEPLOY_DIR/current}"
SERVICE_SCRIPT="${MOLIBOT_SERVICE_SCRIPT:-$CURRENT_LINK/bin/molibot-service.sh}"
TIMESTAMP="$(date -u +%Y%m%d%H%M%S)"
NEXT_RELEASE="$RELEASES_DIR/$TIMESTAMP"
DEPLOY_MARKER="$DEPLOY_DIR/.molibot-deploy"
TOOL_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ -e "$DEPLOY_DIR" && ! -f "$DEPLOY_MARKER" ]]; then
  if [[ -d "$DEPLOY_DIR" ]] && [[ -z "$(find "$DEPLOY_DIR" -mindepth 1 -maxdepth 1 -print -quit)" ]]; then
    :
  else
    echo "Refusing to use non-empty unmanaged deploy directory: $DEPLOY_DIR" >&2
    echo "Choose a new empty directory, or create $DEPLOY_MARKER after confirming this directory is dedicated to Molibot deployment." >&2
    exit 1
  fi
fi

if [[ -e "$SOURCE_DIR" && ! -d "$SOURCE_DIR/.git" ]]; then
  echo "Refusing to overwrite existing non-git source directory: $SOURCE_DIR" >&2
  exit 1
fi

mkdir -p "$DEPLOY_DIR" "$RELEASES_DIR"
printf "molibot managed deployment\n" > "$DEPLOY_MARKER"

if [[ ! -d "$SOURCE_DIR/.git" ]]; then
  git clone "$REPO_URL" "$SOURCE_DIR"
fi

(
  cd "$SOURCE_DIR"
  git fetch --prune origin
  git checkout "$GIT_REF"
  git reset --hard "origin/$GIT_REF"
  if ! git ls-files --error-unmatch bin/molibot-release.sh >/dev/null 2>&1; then
    echo "Source checkout does not include tracked release tooling; bootstrapping from current installer."
    mkdir -p ./bin
    for script_name in molibot-release.sh molibot-service.sh molibot-update.sh molibot-manage.js; do
      if [[ -f "$TOOL_ROOT/bin/$script_name" ]]; then
        cp "$TOOL_ROOT/bin/$script_name" "./bin/$script_name"
        chmod +x "./bin/$script_name" 2>/dev/null || true
      fi
    done
  fi
  ./bin/molibot-release.sh "$NEXT_RELEASE"
)

ln -sfn "$NEXT_RELEASE" "$CURRENT_LINK"

if [[ -x "$SERVICE_SCRIPT" ]]; then
  MOLIBOT_APP_DIR="$CURRENT_LINK" "$SERVICE_SCRIPT" restart
else
  echo "Release installed at $CURRENT_LINK"
  echo "Service script not executable: $SERVICE_SCRIPT"
  echo "Start manually with: MOLIBOT_APP_DIR=\"$CURRENT_LINK\" \"$CURRENT_LINK/bin/molibot-service.sh\" restart"
fi

echo "Molibot updated to $TIMESTAMP"
