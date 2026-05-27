#!/bin/bash
# BioWallet → Tokyo deploy
# Futtatás a _MetaSpace_CPU gyökérből: bash BioWallet/deploy/deploy_tokyo.sh

TOKYO="root@34.146.249.102"
REMOTE_DIR="/var/www/biowallet"
# Relatív út a _MetaSpace_CPU gyökérhez képest
SRC_DIR="BioWallet/src"
NGINX_CONF="BioWallet/deploy/nginx_biowallet.conf"

echo "=== BioWallet deploy → biowallet.metaspace.bio ==="

# 1. Fájlok feltöltése (scp -r, rsync nincs Windows-on)
echo "[1/3] Fájlok feltöltése $REMOTE_DIR ..."
# Célmappa létrehozása, ha nem létezik
ssh "$TOKYO" "mkdir -p $REMOTE_DIR"
scp -r "$SRC_DIR"/* "$TOKYO:$REMOTE_DIR/"

# 2. Nginx konfig másolása
echo "[2/3] nginx konfig ..."
scp "$NGINX_CONF" "$TOKYO:/tmp/nginx_biowallet.conf"
ssh "$TOKYO" "
  mv /tmp/nginx_biowallet.conf /etc/nginx/sites-available/biowallet.metaspace.bio
  ln -sf /etc/nginx/sites-available/biowallet.metaspace.bio /etc/nginx/sites-enabled/biowallet.metaspace.bio
  nginx -t && systemctl reload nginx
"

# 3. Certbot (csak ha még nincs cert)
echo "[3/3] certbot check ..."
ssh "$TOKYO" "
  if [ ! -f /etc/letsencrypt/live/biowallet.metaspace.bio/fullchain.pem ]; then
    certbot --nginx -d biowallet.metaspace.bio --non-interactive --agree-tos -m lszoke@gmail.com
  else
    echo 'Cert már megvan, kihagyva.'
  fi
"

echo ""
echo "=== KÉSZ ==="
echo "URL: https://biowallet.metaspace.bio"
