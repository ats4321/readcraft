#!/usr/bin/env bash
set -euo pipefail

REPO="${REPO:-ats4321/readcraft}"
BIN_NAME="${BIN_NAME:-readcraft}"
NPM_PACKAGE="${NPM_PACKAGE:-readme-gen}"
NPM_BIN="${NPM_BIN:-readme-gen}"
INSTALL_METHOD="${INSTALL_METHOD:-auto}" # auto|binary|npm
INSTALL_DIR="${INSTALL_DIR:-$HOME/.local/bin}"

log() { printf '%s\n' "$*"; }
warn() { printf 'Warning: %s\n' "$*" >&2; }
fail() { printf 'Error: %s\n' "$*" >&2; exit 1; }

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || fail "Required command not found: $1"
}

detect_os() {
  case "$(uname -s)" in
    Linux) echo "linux" ;;
    Darwin) echo "darwin" ;;
    *) fail "Unsupported OS: $(uname -s)" ;;
  esac
}

detect_arch() {
  case "$(uname -m)" in
    x86_64|amd64) echo "amd64" ;;
    arm64|aarch64) echo "arm64" ;;
    *) fail "Unsupported architecture: $(uname -m)" ;;
  esac
}

resolve_download_url() {
  local os="$1"
  local arch="$2"
  echo "https://github.com/${REPO}/releases/latest/download/${BIN_NAME}-${os}-${arch}.tar.gz"
}

install_binary() {
  need_cmd curl
  need_cmd tar

  local os arch url tmpdir archive_path extracted_bin
  os="$(detect_os)"
  arch="$(detect_arch)"
  url="$(resolve_download_url "$os" "$arch")"
  tmpdir="$(mktemp -d)"
  archive_path="$tmpdir/${BIN_NAME}.tar.gz"

  log "Installing ${BIN_NAME} (${os}/${arch}) from GitHub releases..."
  if ! curl -fsSL "$url" -o "$archive_path"; then
    rm -rf "$tmpdir"
    return 1
  fi

  mkdir -p "$tmpdir/extract"
  tar -xzf "$archive_path" -C "$tmpdir/extract"

  if [ -f "$tmpdir/extract/$BIN_NAME" ]; then
    extracted_bin="$tmpdir/extract/$BIN_NAME"
  else
    extracted_bin="$(find "$tmpdir/extract" -type f -name "$BIN_NAME" | head -n 1 || true)"
  fi

  [ -n "$extracted_bin" ] || fail "Archive downloaded but no ${BIN_NAME} binary was found."

  mkdir -p "$INSTALL_DIR"
  install -m 0755 "$extracted_bin" "$INSTALL_DIR/$BIN_NAME"
  rm -rf "$tmpdir"

  log "Installed to: $INSTALL_DIR/$BIN_NAME"
  return 0
}

install_npm() {
  need_cmd npm
  log "Installing ${NPM_PACKAGE} with npm..."
  npm install -g "$NPM_PACKAGE"
}

print_path_hint() {
  case ":$PATH:" in
    *":$INSTALL_DIR:"*) ;;
    *)
      warn "$INSTALL_DIR is not in your PATH."
      log "Add this to your shell profile:"
      log "  export PATH=\"$INSTALL_DIR:\$PATH\""
      ;;
  esac
}

main() {
  case "$INSTALL_METHOD" in
    binary)
      install_binary || fail "Binary install failed."
      print_path_hint
      "$INSTALL_DIR/$BIN_NAME" --help >/dev/null 2>&1 || warn "Installed binary did not run with --help."
      ;;
    npm)
      install_npm
      command -v "$NPM_BIN" >/dev/null 2>&1 || warn "${NPM_BIN} not found on PATH yet."
      ;;
    auto)
      if install_binary; then
        print_path_hint
        "$INSTALL_DIR/$BIN_NAME" --help >/dev/null 2>&1 || warn "Installed binary did not run with --help."
      else
        warn "Binary release not found. Falling back to npm."
        install_npm
        command -v "$NPM_BIN" >/dev/null 2>&1 || warn "${NPM_BIN} not found on PATH yet."
      fi
      ;;
    *)
      fail "Invalid INSTALL_METHOD: $INSTALL_METHOD (expected auto|binary|npm)"
      ;;
  esac

  log "Done."
}

main "$@"
