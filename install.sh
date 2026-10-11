#!/usr/bin/env bash
# com-factory installer (macOS). Idempotent: safe to re-run.
#   bash install.sh [--openrouter-key KEY] [--port 4777] [--no-service]
set -euo pipefail
cd "$(dirname "$0")"
ROOT="$(pwd)"
KEY=""; PORT=""; SERVICE=1
while [ $# -gt 0 ]; do
  case "$1" in
    --openrouter-key) KEY="$2"; shift 2;;
    --port) PORT="$2"; shift 2;;
    --no-service) SERVICE=0; shift;;
    -h|--help) sed -n '2,4p' "$0"; exit 0;;
    *) echo "unknown option $1"; exit 1;;
  esac
done
say() { printf '\033[1;34m→\033[0m %s\n' "$*"; }
ok()  { printf '\033[1;32m✓\033[0m %s\n' "$*"; }
die() { printf '\033[1;31m✗\033[0m %s\n' "$*"; exit 1; }

export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"

# 1. Node >= 23.6 (24+ recommended)
if ! command -v node >/dev/null; then die "Node.js not found. Install Node 24+ (https://nodejs.org or: brew install node) and re-run."; fi
NODE_V="$(node -p 'process.versions.node')"
node -e 'const [a,b]=process.versions.node.split(".").map(Number); process.exit(a>23||(a===23&&b>=6)?0:1)' || die "Node $NODE_V is too old, need >= 23.6 (24+ recommended)."
ok "Node $NODE_V"

# 2. Aside CLI
if ! command -v aside >/dev/null; then
  say "Aside CLI not found. Installing it (official installer)…"
  curl -fsSL https://releases.aside.com/install.sh | bash || die "Aside install failed. Install Aside Browser from https://aside.com, then re-run."
fi
ok "Aside CLI $(aside --version 2>/dev/null | head -1)"

# 3. Dependencies
say "Installing npm dependencies…"
npm install --no-audit --no-fund --silent
ok "dependencies installed"

# 4. .env
if [ ! -f .env ]; then cp .env.example .env; fi
if [ -n "$KEY" ]; then sed -i '' "s|^OPENROUTER_API_KEY=.*|OPENROUTER_API_KEY=$KEY|" .env; fi
if [ -n "$PORT" ]; then sed -i '' "s|^PANEL_PORT=.*|PANEL_PORT=$PORT|" .env; fi
if ! grep -q '^OPENROUTER_API_KEY=.\+' .env; then
  if [ -t 0 ]; then read -r -p "OpenRouter API key (sk-or-…): " KEY; sed -i '' "s|^OPENROUTER_API_KEY=.*|OPENROUTER_API_KEY=$KEY|" .env; else echo "OPENROUTER_API_KEY is empty: pass --openrouter-key or edit .env"; fi
fi
sed -i '' "s|^ASIDE_BIN=.*|ASIDE_BIN=$(command -v aside)|" .env
chmod 600 .env
TZ_NOW="$(node -p 'Intl.DateTimeFormat().resolvedOptions().timeZone')"
grep -q '^TZ=.\+' .env || sed -i '' "s|^TZ=.*|TZ=$TZ_NOW|" .env
ok ".env ready"
mkdir -p data

# 5. launchd service (macOS)
PORT_NOW="$(grep '^PANEL_PORT=' .env | cut -d= -f2)"; PORT_NOW="${PORT_NOW:-4777}"
if [ "$SERVICE" = 1 ] && [ "$(uname)" = "Darwin" ]; then
  LABEL="com.com-factory.panel"
  PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
  mkdir -p "$HOME/Library/LaunchAgents"
  NODE_BIN="$(command -v node)"
  cat > "$PLIST" <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key><array><string>$NODE_BIN</string><string>--no-warnings</string><string>$ROOT/src/cli.ts</string><string>serve</string></array>
  <key>WorkingDirectory</key><string>$ROOT</string>
  <key>EnvironmentVariables</key><dict><key>PATH</key><string>$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string><key>HOME</key><string>$HOME</string></dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>15</integer>
  <key>StandardOutPath</key><string>$ROOT/data/panel.out.log</string>
  <key>StandardErrorPath</key><string>$ROOT/data/panel.err.log</string>
</dict></plist>
PL
  launchctl bootout "gui/$(id -u)/$LABEL" >/dev/null 2>&1 || true
  launchctl bootstrap "gui/$(id -u)" "$PLIST"
  launchctl kickstart -k "gui/$(id -u)/$LABEL" >/dev/null 2>&1 || true
  ok "launchd service $LABEL installed (starts at login, restarts on crash)"
else
  say "service not installed; start manually with: npm start"
fi

# 6. Doctor
say "Running doctor…"
sleep 2
node --no-warnings src/cli.ts doctor || true
echo
ok "Panel: http://127.0.0.1:$PORT_NOW  (log: data/com-factory.log)"
echo "Next: open the panel, fill in your product on /products, check limits on /platforms."
