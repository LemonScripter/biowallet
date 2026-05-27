#!/bin/bash
# BioWallet → Tokyo deploy
# Futtatás: bash deploy/deploy_tokyo.sh
# Előfeltétel: SSH kulcs hozzáadva a Tokyo szerverhez

TOKYO="lszok@34.146.249.102"
REMOTE_DIR="/var/www/biowallet"
NGINX_CONF="deploy/nginx_biowallet.conf"

echo "=== BioWallet deploy → biowallet.metaspace.bio ==="

# 1. Fájlok feltöltése
echo "[1/3] rsync src/ → $REMOTE_DIR ..."
rsync -avz --delete src/ "$TOKYO:$REMOTE_DIR/"

# 2. Nginx konfig másolása
echo "[2/3] nginx konfig ..."
scp "$NGINX_CONF" "$TOKYO:/tmp/nginx_biowallet.conf"
ssh "$TOKYO" "
  sudo mv /tmp/nginx_biowallet.conf /etc/nginx/sites-available/biowallet.metaspace.bio
  sudo ln -sf /etc/nginx/sites-available/biowallet.metaspace.bio /etc/nginx/sites-enabled/biowallet.metaspace.bio
  sudo nginx -t
  sudo systemctl reload nginx
"

# 3. Let's Encrypt cert
echo "[3/3] certbot ..."
ssh "$TOKYO" "
  sudo certbot --nginx -d biowallet.metaspace.bio --non-interactive --agree-tos -m lszoke@gmail.com
"

echo ""
echo "=== KÉSZ ==="
echo "URL: https://biowallet.metaspace.bio/app/index.html"
