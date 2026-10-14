#!/usr/bin/env bash
# ThePanel server-side setup. Run once on the VDS as root:
#   sudo bash deploy.sh
# Expects the repo (minus node_modules) uploaded to /opt/thepanel.

set -euo pipefail

APP_DIR=/opt/thepanel

echo "==> Node.js check"
if ! command -v node >/dev/null; then
  apt-get update && apt-get install -y nodejs npm build-essential python3
fi
node --version

echo "==> Backend .env"
if [ ! -f "$APP_DIR/backend/.env" ]; then
  echo "WARNING: backend/.env missing — upload it (secrets, not in git) or the backend" >&2
  echo "         will run without Shopify config / APP_ENCRYPTION_KEY." >&2
fi

echo "==> Backend dependencies (native: better-sqlite3 builds here)"
cd "$APP_DIR/backend"
npm ci --omit=dev

echo "==> Database"
mkdir -p database
node migrate-sqlite.js

echo "==> Service user"
id -u thepanel >/dev/null 2>&1 || useradd --system --no-create-home --shell /usr/sbin/nologin thepanel
chown -R thepanel:thepanel "$APP_DIR"

echo "==> systemd unit"
cp "$APP_DIR/deploy/thepanel.service" /etc/systemd/system/thepanel.service
systemctl daemon-reload
systemctl enable --now thepanel
sleep 2
systemctl --no-pager --lines=5 status thepanel || true

echo "==> nginx"
MAIN_CONF=$(grep -rlE 'listen.*(80|default_server)' /etc/nginx/sites-enabled/ /etc/nginx/conf.d/ 2>/dev/null | head -1)
if [ -z "$MAIN_CONF" ]; then
  echo "Could not auto-detect the main server block; add deploy/nginx-thepanel.conf manually." >&2
  exit 1
fi
python3 - "$MAIN_CONF" <<'EOF'
import re, sys
conf = sys.argv[1]
with open(conf) as f:
    body = f.read()
with open('/opt/thepanel/deploy/nginx-thepanel.conf') as f:
    snippet = f.read()
if 'location /thePanel/' in body:
    print('nginx: /thePanel already configured, skipping')
else:
    # insert into the first server { } that listens on 80
    m = re.search(r'(server\s*\{)', body)
    body = body[:m.end()] + '\n' + snippet + body[m.end():]
    with open(conf, 'w') as f:
        f.write(body)
    print('nginx: /thePanel blocks inserted into', conf)
EOF
nginx -t && systemctl reload nginx

echo "==> Done. Check http://<server-ip>/thePanel/"
