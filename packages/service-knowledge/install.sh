#!/usr/bin/env bash
#
# service-knowledge installer.
# Puts `service-knowledge` on PATH via pipx (editable — pulls in this repo
# update the installed CLI automatically). Idempotent; safe to re-run.
#
# Usage:
#   ./install.sh                  # install for the current user
#   ./install.sh --system-pipx    # also apt-install pipx if missing (needs sudo)
#
set -euo pipefail

PKG_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VAULTCTL_DIR="${VAULTCTL_DIR:-$(cd "$PKG_DIR/../../../vaultctl" 2>/dev/null && pwd || true)}"
INSTALL_PIPX=0

for arg in "$@"; do
  case "$arg" in
    --system-pipx) INSTALL_PIPX=1 ;;
    -h|--help)
      sed -n '3,12p' "$0"
      exit 0 ;;
  esac
done

info() { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m!!\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31mxx\033[0m %s\n' "$*" >&2; exit 1; }

# 1. pipx
if ! command -v pipx >/dev/null; then
  if [ "$INSTALL_PIPX" = 1 ]; then
    info "installing pipx via apt (sudo required)"
    sudo apt-get update -qq
    sudo apt-get install -y pipx
  else
    die "pipx not found. Install it (Debian/Ubuntu: 'sudo apt install pipx',
    macOS: 'brew install pipx', other: https://pipx.pypa.io/) then re-run,
    or re-run this script with --system-pipx."
  fi
fi

# 2. vaultctl (only cross-package dep — lives in its own repo)
if [ -z "${VAULTCTL_DIR:-}" ] || [ ! -f "$VAULTCTL_DIR/pyproject.toml" ]; then
  DEFAULT_VAULTCTL="$(cd "$PKG_DIR/../../.." 2>/dev/null && pwd || true)/vaultctl"
  info "vaultctl source not found at $DEFAULT_VAULTCTL — cloning it"
  if ! git clone https://github.com/xtrm-dev/vaultctl "$DEFAULT_VAULTCTL"; then
    die "git clone https://github.com/xtrm-dev/vaultctl failed.
    Clone it manually and either place it at $DEFAULT_VAULTCTL
    or set VAULTCTL_DIR=/your/path and re-run."
  fi
  VAULTCTL_DIR="$DEFAULT_VAULTCTL"
fi

# 3. install (editable so `git pull` here updates the CLI). pyproject.toml
# does NOT declare vaultctl as a dep (it's a sibling local repo, not on PyPI),
# so pipx resolves the remaining PyPI deps cleanly on this step.
info "installing service-knowledge (editable) via pipx"
pipx install --force --editable "$PKG_DIR"

info "injecting vaultctl (editable) into the service-knowledge venv"
pipx inject --force --editable service-knowledge "$VAULTCTL_DIR"

# 4. PATH
pipx ensurepath >/dev/null 2>&1 || true

# 5. verify
if command -v service-knowledge >/dev/null; then
  VER="$(service-knowledge --version 2>&1)"
  info "installed: $VER"
  info "next: cd <your-repo> && service-knowledge install"
else
  warn "service-knowledge not yet on PATH in this shell."
  warn "Open a new shell (or 'exec \$SHELL') and re-check with 'service-knowledge --version'."
  warn "Direct path: ~/.local/bin/service-knowledge"
fi
