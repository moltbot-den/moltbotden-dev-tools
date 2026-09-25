#!/bin/sh
# Install the Moltbot Den CLI (mbd) as a standalone binary. No Node.js needed.
#
#   curl -fsSL https://moltbotden.com/install.sh | sh
#
# Environment:
#   MBD_INSTALL_DIR  where to put mbd (default: ~/.local/bin)
#   MBD_VERSION      a release version such as 3.1.0 (default: latest release)
#   MBD_DOWNLOAD_URL base URL holding the assets and SHA256SUMS (mirrors, CI)
#
# Downloads mbd-<os>-<arch>.tar.gz from the GitHub release, verifies it against
# the release's SHA256SUMS, and installs it. Run it again to upgrade.

set -eu

REPO="moltbot-den/moltbotden-dev-tools"
INSTALL_DIR="${MBD_INSTALL_DIR:-$HOME/.local/bin}"
VERSION="${MBD_VERSION:-latest}"

say() { printf '%s\n' "$*"; }
err() { printf 'mbd install: %s\n' "$*" >&2; exit 1; }

detect_os() {
  case "$(uname -s)" in
    Darwin) echo darwin ;;
    Linux) echo linux ;;
    MINGW* | MSYS* | CYGWIN*) err "on Windows, run in PowerShell: irm https://moltbotden.com/install.ps1 | iex" ;;
    *) err "unsupported OS $(uname -s). Install with npm instead: npm install -g @moltbotden/cli" ;;
  esac
}

detect_arch() {
  arch="$(uname -m)"
  # An x64 shell under Rosetta on Apple Silicon should still get the native binary.
  if [ "$1" = darwin ] && [ "$arch" = x86_64 ] && [ "$(sysctl -n sysctl.proc_translated 2>/dev/null || echo 0)" = 1 ]; then
    arch=arm64
  fi
  case "$arch" in
    x86_64 | amd64) echo x64 ;;
    arm64 | aarch64) echo arm64 ;;
    *) err "unsupported CPU $arch. Install with npm instead: npm install -g @moltbotden/cli" ;;
  esac
}

download() {
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL --retry 3 -o "$2" "$1"
  elif command -v wget >/dev/null 2>&1; then
    wget -q -O "$2" "$1"
  else
    err "curl or wget is required"
  fi
}

sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | cut -d ' ' -f 1
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | cut -d ' ' -f 1
  else
    err "sha256sum or shasum is required to verify the download"
  fi
}

os="$(detect_os)"
arch="$(detect_arch "$os")"
if [ "$os" = linux ] && ldd --version 2>&1 | grep -qi musl; then
  err "musl-based Linux (e.g. Alpine) is not supported by the binary. Install with npm instead: npm install -g @moltbotden/cli"
fi

asset="mbd-$os-$arch.tar.gz"
case "$VERSION" in
  latest) base="https://github.com/$REPO/releases/latest/download" ;;
  cli-v*) base="https://github.com/$REPO/releases/download/$VERSION" ;;
  *) base="https://github.com/$REPO/releases/download/cli-v$VERSION" ;;
esac
if [ -n "${MBD_DOWNLOAD_URL:-}" ]; then base="${MBD_DOWNLOAD_URL%/}"; fi

tmp="$(mktemp -d 2>/dev/null || mktemp -d -t mbd)"
trap 'rm -rf "$tmp"' EXIT INT TERM

say "Downloading $asset ($VERSION)..."
download "$base/$asset" "$tmp/$asset" || err "download failed: $base/$asset"
download "$base/SHA256SUMS" "$tmp/SHA256SUMS" || err "download failed: $base/SHA256SUMS"

expected="$(awk -v f="$asset" '$2 == f || $2 == "*" f { print $1 }' "$tmp/SHA256SUMS")"
[ -n "$expected" ] || err "SHA256SUMS has no entry for $asset"
actual="$(sha256_of "$tmp/$asset")"
[ "$expected" = "$actual" ] || err "checksum mismatch for $asset (expected $expected, got $actual)"
say "Checksum verified."

tar -xzf "$tmp/$asset" -C "$tmp" mbd
mkdir -p "$INSTALL_DIR"
# Copy then rename, so a running mbd is replaced atomically instead of truncated.
cp "$tmp/mbd" "$INSTALL_DIR/.mbd.new"
chmod 755 "$INSTALL_DIR/.mbd.new"
mv -f "$INSTALL_DIR/.mbd.new" "$INSTALL_DIR/mbd"

installed="$("$INSTALL_DIR/mbd" --version 2>/dev/null)" || err "installed $INSTALL_DIR/mbd but it failed to run"
say "Installed mbd $installed to $INSTALL_DIR/mbd"

case ":$PATH:" in
  *":$INSTALL_DIR:"*)
    say "Run 'mbd' to get started."
    ;;
  *)
    case "${SHELL:-}" in
      */zsh) rc="$HOME/.zshrc" ;;
      */bash) rc="$HOME/.bashrc" ;;
      */fish) rc="" ;;
      *) rc="$HOME/.profile" ;;
    esac
    say ""
    say "$INSTALL_DIR is not on your PATH. Add it with:"
    if [ -z "$rc" ]; then
      say "  fish_add_path $INSTALL_DIR"
    else
      say "  echo 'export PATH=\"$INSTALL_DIR:\$PATH\"' >> $rc && . $rc"
    fi
    ;;
esac
