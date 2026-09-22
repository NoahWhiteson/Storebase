#!/usr/bin/env bash
set -euo pipefail

REPO="${STOREBASE_REPO:-https://github.com/NoahWhiteson/Storebase.git}"
NODE_VER="${STOREBASE_NODE_VERSION:-v22.14.0}"

say() { printf '%s\n' "$*"; }
err() { printf 'error: %s\n' "$*" >&2; exit 1; }

ask() {
  local prompt="$1"
  local default="${2:-}"
  local reply=""
  local out="/dev/tty"
  [ -w /dev/tty ] || out="/dev/stderr"
  if [ -n "$default" ]; then
    printf '%s [%s]: ' "$prompt" "$default" >"$out"
  else
    printf '%s: ' "$prompt" >"$out"
  fi
  if [ -r /dev/tty ]; then
    IFS= read -r reply </dev/tty || true
  else
    IFS= read -r reply || true
  fi
  if [ -z "$reply" ]; then
    reply="$default"
  fi
  printf '%s' "$reply"
}

yesno() {
  local prompt="$1"
  local default="${2:-y}"
  local reply
  reply="$(ask "$prompt" "$default")"
  case "$reply" in
    y|Y|yes|YES) return 0 ;;
    *) return 1 ;;
  esac
}

expand_path() {
  local p="$1"
  case "$p" in
    ~) printf '%s' "$HOME" ;;
    ~/*) printf '%s' "$HOME/${p#~/}" ;;
    *) printf '%s' "$p" ;;
  esac
}

need_cmd() {
  command -v "$1" >/dev/null 2>&1
}

os="$(uname -s | tr '[:upper:]' '[:lower:]')"
arch="$(uname -m)"
case "$arch" in
  x86_64|amd64) arch="x64" ;;
  aarch64|arm64) arch="arm64" ;;
  *) err "Unsupported CPU: $arch" ;;
esac
case "$os" in
  linux|darwin) ;;
  *) err "Unsupported OS: $os" ;;
esac

say "Storebase installer"
say "This clones the repo, installs Node if needed, builds the app, opens a port, and starts the node."
say ""

default_dir="$HOME/storebase"
INSTALL="$(expand_path "$(ask "Install directory" "$default_dir")")"
HOST="$(ask "Listen address (0.0.0.0 = LAN/cloud, 127.0.0.1 = this machine only)" "0.0.0.0")"
PORT="$(ask "Port" "4780")"
if yesno "Auto-update from GitHub when main moves" "y"; then
  AUTO_UPDATE=1
else
  AUTO_UPDATE=0
fi
OPEN_FW=0
if need_cmd ufw || need_cmd firewall-cmd; then
  if yesno "Open firewall for port $PORT" "y"; then
    OPEN_FW=1
  fi
fi
START_NOW=1
if ! yesno "Start Storebase when install finishes" "y"; then
  START_NOW=0
fi

mkdir -p "$INSTALL"
INSTALL="$(cd "$INSTALL" && pwd)"

if [ -d "$INSTALL/.git" ] && [ -f "$INSTALL/server/package.json" ]; then
  say "Using existing clone at $INSTALL"
  git -C "$INSTALL" fetch origin main >/dev/null 2>&1 || git -C "$INSTALL" fetch "$REPO" main >/dev/null 2>&1 || true
  rm -f "$INSTALL/storebase"
  git -C "$INSTALL" reset --hard FETCH_HEAD >/dev/null 2>&1 || git -C "$INSTALL" merge --ff-only origin/main >/dev/null 2>&1 || true
else
  need_cmd git || err "git is required"
  if [ -n "$(ls -A "$INSTALL" 2>/dev/null || true)" ]; then
    err "$INSTALL is not empty and is not a Storebase clone"
  fi
  say "Cloning $REPO"
  git clone --depth 1 --branch main "$REPO" "$INSTALL"
fi

node_ok() {
  need_cmd node || return 1
  local major
  major="$(node -p "process.versions.node.split('.')[0]")"
  [ "$major" -ge 20 ]
}

NODE_BIN="node"
NPM_BIN="npm"
if ! node_ok; then
  say "Node 20+ not found. Fetching $NODE_VER for $os-$arch"
  bundle="$INSTALL/.node"
  mkdir -p "$bundle"
  tarball="node-${NODE_VER}-${os}-${arch}.tar.xz"
  url="https://nodejs.org/dist/${NODE_VER}/${tarball}"
  curl -fsSL "$url" -o "$INSTALL/$tarball"
  tar -xJf "$INSTALL/$tarball" -C "$bundle" --strip-components=1
  rm -f "$INSTALL/$tarball"
  NODE_BIN="$bundle/bin/node"
  NPM_BIN="$bundle/bin/npm"
  export PATH="$bundle/bin:$PATH"
fi

if ! need_cmd clamscan; then
  say "ClamAV was not found. Installing it for optional upload virus checks."
  if [ "$os" = "linux" ] && need_cmd apt-get; then
    sudo apt-get update
    sudo apt-get install -y clamav
  elif [ "$os" = "linux" ] && need_cmd dnf; then
    sudo dnf install -y clamav clamav-update
  elif [ "$os" = "linux" ] && need_cmd yum; then
    sudo yum install -y clamav clamav-update
  elif [ "$os" = "darwin" ] && need_cmd brew; then
    brew install clamav
  else
    say "Could not install ClamAV automatically. Install clamscan before enabling virus checks."
  fi
fi
if need_cmd freshclam; then
  say "Updating ClamAV virus definitions"
  sudo freshclam >/dev/null 2>&1 || freshclam >/dev/null 2>&1 || say "Could not refresh ClamAV definitions yet; the system updater may do it shortly."
fi

say "Installing app dependencies"
(cd "$INSTALL/app" && "$NPM_BIN" install)
say "Installing server dependencies"
(cd "$INSTALL/server" && "$NPM_BIN" install)
say "Building web app"
(cd "$INSTALL/app" && "$NPM_BIN" run build)

ENV_FILE="$INSTALL/.env"
cat > "$ENV_FILE" <<EOF
STOREBASE_HOST=$HOST
STOREBASE_PORT=$PORT
STOREBASE_DATA_DIR=$INSTALL/data
STOREBASE_HOME=$INSTALL
STOREBASE_APP_DIST=$INSTALL/app/dist
STOREBASE_AUTO_UPDATE=$AUTO_UPDATE
PATH=$(dirname "$NODE_BIN"):\$PATH
EOF

START_SH="$INSTALL/start.sh"
cat > "$START_SH" <<EOF
#!/usr/bin/env bash
set -euo pipefail
cd "$INSTALL"
set -a
# shellcheck disable=SC1091
. "$ENV_FILE"
set +a
cd "$INSTALL/server"
exec "$NODE_BIN" "$INSTALL/server/node_modules/tsx/dist/cli.mjs" src/cli.ts start
EOF
chmod +x "$START_SH"

WRAPPER="$INSTALL/storebase"
chmod +x "$WRAPPER"

BIN_DIR="$HOME/.local/bin"
mkdir -p "$BIN_DIR"
ln -sfn "$WRAPPER" "$BIN_DIR/storebase"

if command -v systemctl >/dev/null 2>&1 && [ "$os" = "linux" ]; then
  UNIT_DIR="$HOME/.config/systemd/user"
  mkdir -p "$UNIT_DIR"
  cat > "$UNIT_DIR/storebase.service" <<EOF
[Unit]
Description=Storebase node
After=network.target

[Service]
Type=simple
EnvironmentFile=$ENV_FILE
WorkingDirectory=$INSTALL/server
ExecStart=$NODE_BIN $INSTALL/server/node_modules/tsx/dist/cli.mjs src/cli.ts start
Restart=always
RestartSec=3

[Install]
WantedBy=default.target
EOF
  systemctl --user daemon-reload
  systemctl --user enable storebase.service >/dev/null
  if command -v loginctl >/dev/null 2>&1; then
    loginctl enable-linger "$USER" >/dev/null 2>&1 || true
  fi
elif [ "$os" = "darwin" ]; then
  AGENT_DIR="$HOME/Library/LaunchAgents"
  mkdir -p "$AGENT_DIR"
  cat > "$AGENT_DIR/com.storebase.node.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.storebase.node</string>
  <key>ProgramArguments</key>
  <array>
    <string>$START_SH</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$INSTALL/storebase.log</string>
  <key>StandardErrorPath</key><string>$INSTALL/storebase.log</string>
</dict>
</plist>
EOF
fi

if [ "$OPEN_FW" = "1" ]; then
  if need_cmd ufw; then
    sudo ufw allow "${PORT}/tcp" || say "Could not open ufw. Open TCP $PORT yourself."
    sudo ufw allow 80/tcp || true
    sudo ufw allow 443/tcp || true
  elif need_cmd firewall-cmd; then
    sudo firewall-cmd --permanent --add-port="${PORT}/tcp" || true
    sudo firewall-cmd --permanent --add-port=80/tcp || true
    sudo firewall-cmd --permanent --add-port=443/tcp || true
    sudo firewall-cmd --reload || true
  fi
fi

if [ "$START_NOW" = "1" ]; then
  "$WRAPPER" start
fi

LAN=""
if need_cmd hostname; then
  LAN="$(hostname -I 2>/dev/null | awk '{print $1}')" || true
fi
if [ -z "$LAN" ] && need_cmd ip; then
  LAN="$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{for (i=1;i<=NF;i++) if (\$i==\"src\") print \$(i+1)}')" || true
fi

say ""
say "Storebase is installed at $INSTALL"
say "Command: storebase start | stop | update | logs | status"
if [ "$HOST" = "0.0.0.0" ]; then
  say "Open http://127.0.0.1:${PORT}"
  if [ -n "$LAN" ]; then
    say "On the LAN: http://${LAN}:${PORT}"
  fi
else
  say "Open http://${HOST}:${PORT}"
fi
say "First visit runs onboarding. Each account gets its own drive on this machine."
say "If ~/.local/bin is not on your PATH, add it or run $WRAPPER"
