#!/usr/bin/env bash
set -Eeuo pipefail

REPOSITORY="${CYBERCODE_REPOSITORY:-wk42worldworld/cybercode}"
INSTALL_DIR="${CYBERCODE_INSTALL_DIR:-${XDG_DATA_HOME:-$HOME/.local/share}/cybercode}"
BIN_DIR="${CYBERCODE_BIN_DIR:-$HOME/.local/bin}"
VERSION="${CYBERCODE_VERSION:-}"
ARCHIVE_URL="${CYBERCODE_ARCHIVE_URL:-}"

log() {
  printf 'CyberCode: %s\n' "$*"
}

fail() {
  printf 'CyberCode installer error: %s\n' "$*" >&2
  exit 1
}

command_exists() {
  command -v "$1" >/dev/null 2>&1
}

case "$(uname -s)" in
  Darwin | Linux) ;;
  *) fail "this installer supports macOS and Linux; use install-cli.ps1 on Windows" ;;
esac

command_exists curl || fail "curl is required"
command_exists tar || fail "tar is required"

if [[ -z "$VERSION" ]]; then
  log "finding the latest stable release"
  latest_url="$(curl -fsSL -o /dev/null -w '%{url_effective}' "https://github.com/$REPOSITORY/releases/latest")"
  VERSION="${latest_url##*/}"
fi

if [[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  VERSION="v$VERSION"
fi

if [[ "$VERSION" == "main" ]]; then
  default_archive_url="https://github.com/$REPOSITORY/archive/refs/heads/main.tar.gz"
elif [[ "$VERSION" =~ ^v[0-9]+\.[0-9]+\.[0-9]+([.-][0-9A-Za-z.-]+)?$ ]]; then
  default_archive_url="https://github.com/$REPOSITORY/archive/refs/tags/$VERSION.tar.gz"
else
  fail "could not resolve a valid release version (received '$VERSION')"
fi

ARCHIVE_URL="${ARCHIVE_URL:-$default_archive_url}"

if command_exists bun; then
  BUN_BIN="$(command -v bun)"
else
  command_exists unzip || fail "unzip is required to install Bun"
  log "installing Bun"
  curl -fsSL https://bun.sh/install | bash
  BUN_BIN="${BUN_INSTALL:-$HOME/.bun}/bin/bun"
  [[ -x "$BUN_BIN" ]] || fail "Bun was installed but its executable was not found"
fi

install_parent="$(dirname "$INSTALL_DIR")"
mkdir -p "$install_parent" "$BIN_DIR"
staging_root="$(mktemp -d "$install_parent/.cybercode-install.XXXXXX")"

cleanup() {
  rm -rf "$staging_root"
}
trap cleanup EXIT

archive_path="$staging_root/cybercode.tar.gz"
unpack_dir="$staging_root/unpacked"
next_dir="$staging_root/next"
mkdir -p "$unpack_dir"

log "downloading $VERSION"
curl -fsSL "$ARCHIVE_URL" -o "$archive_path"
tar -xzf "$archive_path" -C "$unpack_dir"

shopt -s nullglob
archive_entries=("$unpack_dir"/*)
shopt -u nullglob
[[ ${#archive_entries[@]} -eq 1 && -d "${archive_entries[0]}" ]] || fail "the downloaded archive has an unexpected layout"
mv "${archive_entries[0]}" "$next_dir"

if [[ -f "$INSTALL_DIR/.env" ]]; then
  cp "$INSTALL_DIR/.env" "$next_dir/.env"
fi

log "installing runtime dependencies"
(
  cd "$next_dir"
  "$BUN_BIN" install --frozen-lockfile --production
)

[[ -f "$next_dir/bin/cybercode" ]] || fail "the downloaded release does not contain the CLI launcher"
chmod +x "$next_dir/bin/cybercode"

backup_dir="${INSTALL_DIR}.previous"
rm -rf "$backup_dir"
if [[ -e "$INSTALL_DIR" || -L "$INSTALL_DIR" ]]; then
  mv "$INSTALL_DIR" "$backup_dir"
fi

if ! mv "$next_dir" "$INSTALL_DIR"; then
  if [[ -e "$backup_dir" || -L "$backup_dir" ]]; then
    mv "$backup_dir" "$INSTALL_DIR"
  fi
  fail "could not activate the new installation"
fi
rm -rf "$backup_dir"

launcher="$BIN_DIR/cybercode"
rm -f "$launcher"
bun_bin_dir="$(dirname "$BUN_BIN")"
{
  printf '#!/usr/bin/env bash\n'
  printf 'export PATH=%q:"$PATH"\n' "$bun_bin_dir"
  printf 'exec %q "$@"\n' "$INSTALL_DIR/bin/cybercode"
} > "$launcher"
chmod +x "$launcher"

path_added=0
case ":$PATH:" in
  *":$BIN_DIR:"*) ;;
  *)
    case "${SHELL##*/}" in
      zsh) shell_rc="$HOME/.zshrc" ;;
      bash) shell_rc="$HOME/.bashrc" ;;
      *) shell_rc="$HOME/.profile" ;;
    esac
    path_line="export PATH=\"$BIN_DIR:\$PATH\""
    touch "$shell_rc"
    if ! grep -Fqx "$path_line" "$shell_rc"; then
      printf '\n# CyberCode CLI\n%s\n' "$path_line" >> "$shell_rc"
    fi
    path_added=1
    ;;
esac

log "installed $VERSION at $INSTALL_DIR"
if [[ $path_added -eq 1 ]]; then
  printf 'Open a new terminal, or run:\n  export PATH="%s:$PATH"\n' "$BIN_DIR"
fi
printf 'Start CyberCode with:\n  cybercode\n'
