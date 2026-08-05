#!/usr/bin/env bash
# Installs scrumboard-cli: clones the repo, installs dependencies and the
# Chromium build Playwright needs, then links the `scrumboard` command onto
# your PATH.
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/ethanelliot/scrumboard-cli/main/install.sh | bash
#
# Re-running this script later updates an existing install in place.
set -euo pipefail

REPO_URL="https://github.com/RJDonnison/scrumboard-cli.git"
INSTALL_DIR="${SCRUMBOARD_INSTALL_DIR:-$HOME/.scrumboard-cli/src}"
CONFIG_DIR="${SCRUMBOARD_CONFIG_DIR:-$HOME/.scrumboard-cli}"
CONFIG_FILE="$CONFIG_DIR/config.json"

info() { printf '\033[1;34m==>\033[0m %s\n' "$1"; }
error() { printf '\033[1;31mError:\033[0m %s\n' "$1" >&2; }
require() {
  if ! command -v "$1" >/dev/null 2>&1; then
    error "\`$1\` is required but wasn't found on your PATH."
    exit 1
  fi
}
is_supported_os() {
  case "$(uname -s)" in
  Darwin)
    return 0
    ;;
  Linux)
    if [ -f /etc/os-release ]; then
      . /etc/os-release
      case "${ID:-}" in
      ubuntu | debian) return 0 ;;
      esac
      case "${ID_LIKE:-}" in
      *debian*) return 0 ;;
      esac
    fi
    return 1
    ;;
  MINGW* | MSYS* | CYGWIN*)
    return 0
    ;;
  *)
    return 1
    ;;
  esac
}

find_system_chromium() {
  local candidates=(chromium chromium-browser google-chrome google-chrome-stable)
  local bin
  for bin in "${candidates[@]}"; do
    if command -v "$bin" >/dev/null 2>&1; then
      command -v "$bin"
      return 0
    fi
  done
  return 1
}

write_chromium_path() {
  local chromium_path="$1"
  mkdir -p "$CONFIG_DIR"
  node -e '
    const fs = require("fs");
    const [chromiumPath, file] = process.argv.slice(1);
    let config = {};
    try { config = JSON.parse(fs.readFileSync(file, "utf8")); } catch {}
    config.chromiumPath = chromiumPath;
    fs.writeFileSync(file, JSON.stringify(config, null, 2));
  ' "$chromium_path" "$CONFIG_FILE"
}

require git
require node
require npm

node_major="$(node -e 'console.log(process.versions.node.split(".")[0])')"
if [ "$node_major" -lt 18 ]; then
  error "Node.js >= 18 is required (found $(node -v))."
  exit 1
fi

if [ -d "$INSTALL_DIR/.git" ]; then
  info "Updating existing install in $INSTALL_DIR"
  git -C "$INSTALL_DIR" pull --ff-only
else
  info "Cloning scrumboard-cli into $INSTALL_DIR"
  mkdir -p "$(dirname "$INSTALL_DIR")"
  git clone "$REPO_URL" "$INSTALL_DIR"
fi

cd "$INSTALL_DIR"

info "Installing dependencies"
npm install

if is_supported_os; then
  info "Installing Chromium for Playwright"
  npm run install-browser
else
  info "This OS isn't one Playwright ships a bundled Chromium build for - looking for a system install instead"
  if chromium_path="$(find_system_chromium)"; then
    info "Found Chromium at $chromium_path"
    write_chromium_path "$chromium_path"
  else
    error "No Chromium/Chrome install found on your PATH."
    echo "Install one and re-run this script, e.g.:" >&2
    echo "  sudo pacman -S chromium     # Arch" >&2
    echo "  sudo dnf install chromium   # Fedora" >&2
    exit 1
  fi
fi

info "Linking the scrumboard command"
if npm link 2>/dev/null; then
  :
else
  info "npm link needs elevated permissions, retrying with sudo"
  sudo npm link
fi

echo
info "Done! Try: scrumboard login"
