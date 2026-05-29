# Self-hosting BioWallet

**Author:** Szőke László-Ferenc | MetaSpace.Bio Logic Engine project
**Contact:** admin@metaspace.bio | metaspace.bio · biowallet.metaspace.bio

---

## Requirements

- Linux server with nginx and certbot installed
- A domain pointing to your server's IP (e.g. `biowallet.example.com`)
- Node.js is **not** required — BioWallet is a static site

---

## 1. Upload the app

Copy the contents of `src/` to your web root:

```bash
rsync -avz src/ user@your-server:/var/www/biowallet/
```

The directory structure on the server should be:

```
/var/www/biowallet/
├── app/
│   ├── index.html
│   ├── app.js
│   └── vault_worker.js
├── core/
│   ├── vault.js
│   ├── rpc.js
│   ├── wc2.js
│   └── ...
├── vendor/
│   ├── ethers.bundle.js
│   ├── face-api.min.js
│   └── wc2.min.js
└── models/
    └── (face-api weight files)
```

---

## 2. Nginx configuration

Create `/etc/nginx/sites-available/biowallet.example.com`:

```nginx
server {
    listen 80;
    server_name biowallet.example.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl;
    server_name biowallet.example.com;

    root /var/www/biowallet;
    index app/index.html;

    ssl_certificate     /etc/letsencrypt/live/biowallet.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/biowallet.example.com/privkey.pem;

    # Security headers
    # NOTE: if a location block also uses add_header, it overrides the parent.
    # Use expires directives for cache control inside locations instead.
    add_header Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; media-src 'self'; connect-src 'self' https://ethereum-sepolia-rpc.publicnode.com https://eth.llamarpc.com; worker-src 'self'; frame-src 'none'; object-src 'none'; base-uri 'self'; form-action 'none';" always;
    add_header X-Content-Type-Options   "nosniff" always;
    add_header X-Frame-Options          "DENY" always;
    add_header X-XSS-Protection         "1; mode=block" always;
    add_header Referrer-Policy          "no-referrer" always;
    add_header Strict-Transport-Security "max-age=15768000; includeSubDomains" always;
    add_header Permissions-Policy       "camera=(self)" always;

    # Vendor JS: 30 days — versioned files, content-hashed
    location ^~ /vendor/ {
        expires 30d;
    }

    # Core app logic: no-cache — may change on every release
    location ^~ /core/ {
        expires -1;
    }

    # Face-api model weights: 7 days
    location ^~ /models/ {
        expires 7d;
    }

    # Static assets: 7 days
    location ~* \.(js|css|png|ico|woff2?)$ {
        expires 7d;
    }

    location / {
        try_files $uri $uri/ /app/index.html;
        expires -1;
    }
}
```

Enable it and reload nginx:

```bash
ln -s /etc/nginx/sites-available/biowallet.example.com \
      /etc/nginx/sites-enabled/biowallet.example.com
nginx -t && systemctl reload nginx
```

---

## 3. TLS certificate (Let's Encrypt)

```bash
certbot --nginx -d biowallet.example.com \
  --non-interactive --agree-tos -m your@email.com
```

Auto-renewal is configured by certbot automatically via a systemd timer or cron job.

---

## 4. Content-Security-Policy and WalletConnect

The CSP above allows connections only to the two built-in public RPC endpoints.
If you add custom networks that use other RPC URLs, you must extend the `connect-src` directive accordingly.

WalletConnect v2 requires an outbound WebSocket connection to `relay.walletconnect.com`.
Add it to `connect-src` if you enable WalletConnect:

```
connect-src 'self' https://ethereum-sepolia-rpc.publicnode.com https://eth.llamarpc.com wss://relay.walletconnect.com;
```

---

## 5. recovery_tool.html

The offline recovery tool is a standalone file with no server-side dependencies.
It can be opened directly from the filesystem (`file://`) — it does not need a web server.

Store it separately from the main app and open it only on an air-gapped machine.
