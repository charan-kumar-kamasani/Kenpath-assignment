#!/usr/bin/env bash
# Run ON the server, inside the uploaded project folder (~/rythu-seva).
# Installs deps, picks a free port, starts the app under pm2 and prints the URL.
set -euo pipefail

need_node() { command -v node >/dev/null && node -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>22||(a===22&&b>=5)?0:1)'; }
if ! need_node; then
  echo "Node >= 22.5 required (found: $(node -v 2>/dev/null || echo none)). Installing Node 24 via nvm..."
  curl -fsSo- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
  export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"
  nvm install 24 && nvm use 24
fi
command -v pm2 >/dev/null || npm install -g pm2

port_free() { ! (ss -ltn 2>/dev/null | awk '{print $4}' | grep -qE "[:.]$1$"); }
PORT=${PORT:-3000}
while ! port_free "$PORT"; do PORT=$((PORT+1)); done

npm ci --omit=dev
mkdir -p data
PORT=$PORT DATA_DIR="$PWD/data" NODE_ENV=development \
  pm2 start server/index.js --name rythu-seva --node-args="--no-warnings" --update-env
pm2 save
pm2 startup >/dev/null 2>&1 || true

IP=$(curl -s ifconfig.me || hostname -I | awk '{print $1}')
echo; echo "Rythu Seva is running:  http://$IP:$PORT"
echo "Open port $PORT in the firewall if it does not load:  sudo ufw allow $PORT/tcp"
