#!/bin/bash
# BioWallet Phase 5 — Biztonsági verifikáció
# Futtatás: bash tests/test_phase5.sh
# Előfeltétel: az app deployálva van biowallet.metaspace.bio-ra

BASE="https://biowallet.metaspace.bio"
PASS=0; FAIL=0

ok()   { echo "[PASS] $1"; ((PASS++)); }
fail() { echo "[FAIL] $1"; ((FAIL++)); }

# ── 1. HTTP → HTTPS redirect ─────────────────────────────────────────────
echo "=== 1. HTTP redirect ==="
REDIR=$(curl -sI "http://biowallet.metaspace.bio/" | grep -i "location:" | head -1)
if echo "$REDIR" | grep -q "https://"; then
  ok "HTTP → HTTPS redirect aktív"
else
  fail "HTTP → HTTPS redirect HIÁNYZIK: $REDIR"
fi

# ── 2. HTTPS válasz 200 ──────────────────────────────────────────────────
echo "=== 2. HTTPS elérhetőség ==="
STATUS=$(curl -so /dev/null -w "%{http_code}" "$BASE/app/index.html")
[ "$STATUS" = "200" ] && ok "HTTPS 200 OK" || fail "HTTPS státusz: $STATUS"

# ── 3. Content-Security-Policy header ────────────────────────────────────
echo "=== 3. CSP header ==="
HEADERS=$(curl -sI "$BASE/app/index.html")

echo "$HEADERS" | grep -qi "content-security-policy" \
  && ok "CSP header jelen van" \
  || fail "CSP header HIÁNYZIK"

# CDN URL-ek nem engedélyezhetők
echo "$HEADERS" | grep -i "content-security-policy" | grep -q "cdn.jsdelivr" \
  && fail "CSP engedélyezi a CDN-t (szivárgás!)" \
  || ok "CSP nem engedélyez CDN URL-t"

# connect-src tartalmazza a két RPC-t
echo "$HEADERS" | grep -i "content-security-policy" | grep -q "ethereum-sepolia-rpc.publicnode.com" \
  && ok "CSP connect-src: Sepolia RPC engedélyezett" \
  || fail "CSP connect-src: Sepolia RPC HIÁNYZIK"

echo "$HEADERS" | grep -i "content-security-policy" | grep -q "eth.llamarpc.com" \
  && ok "CSP connect-src: Mainnet RPC engedélyezett" \
  || fail "CSP connect-src: Mainnet RPC HIÁNYZIK"

# ── 4. Biztonsági fejlécek ────────────────────────────────────────────────
echo "=== 4. Biztonsági fejlécek ==="
echo "$HEADERS" | grep -qi "x-content-type-options.*nosniff" \
  && ok "X-Content-Type-Options: nosniff" \
  || fail "X-Content-Type-Options hiányzik"

echo "$HEADERS" | grep -qi "x-frame-options.*deny" \
  && ok "X-Frame-Options: DENY" \
  || fail "X-Frame-Options hiányzik"

echo "$HEADERS" | grep -qi "strict-transport-security" \
  && ok "HSTS header jelen van" \
  || fail "HSTS hiányzik"

echo "$HEADERS" | grep -qi "referrer-policy.*no-referrer" \
  && ok "Referrer-Policy: no-referrer" \
  || fail "Referrer-Policy hiányzik"

# ── 5. Lokális ethers.js — CDN referencia nincs az index.html-ben ─────────
echo "=== 5. CDN mentesség ==="
HTML=$(curl -s "$BASE/app/index.html")
echo "$HTML" | grep -q "cdn.jsdelivr.net" \
  && fail "index.html CDN hivatkozást tartalmaz!" \
  || ok "index.html CDN-mentes"

echo "$HTML" | grep -q "vendor/ethers.umd.min.js" \
  && ok "vendor/ethers.umd.min.js hivatkozás megtalálható" \
  || fail "vendor/ethers.umd.min.js hivatkozás HIÁNYZIK"

# ── 6. Lokális vendor fájlok elérhetősége ────────────────────────────────
echo "=== 6. Vendor fájlok ==="
UMD_STATUS=$(curl -so /dev/null -w "%{http_code}" "$BASE/vendor/ethers.umd.min.js")
[ "$UMD_STATUS" = "200" ] && ok "ethers.umd.min.js elérhető (200)" || fail "ethers.umd.min.js HIÁNYZIK ($UMD_STATUS)"

BUNDLE_STATUS=$(curl -so /dev/null -w "%{http_code}" "$BASE/vendor/ethers.bundle.js")
[ "$BUNDLE_STATUS" = "200" ] && ok "ethers.bundle.js elérhető (200)" || fail "ethers.bundle.js HIÁNYZIK ($BUNDLE_STATUS)"

# ── 7. Worker fájl elérhetősége ───────────────────────────────────────────
echo "=== 7. Worker ==="
WORKER_STATUS=$(curl -so /dev/null -w "%{http_code}" "$BASE/app/vault_worker.js")
[ "$WORKER_STATUS" = "200" ] && ok "vault_worker.js elérhető (200)" || fail "vault_worker.js HIÁNYZIK ($WORKER_STATUS)"

# vault_worker.js nem tartalmaz CDN URL-t
WORKER=$(curl -s "$BASE/app/vault_worker.js")
echo "$WORKER" | grep -q "cdn.jsdelivr" \
  && fail "vault_worker.js CDN URL-t tartalmaz!" \
  || ok "vault_worker.js CDN-mentes"

# ── 8. Core fájlok ───────────────────────────────────────────────────────
echo "=== 8. Core fájlok ==="
for f in bio_capture.js fuzzy_extractor.js causal_chain.js vault.js wallet.js rpc.js; do
  S=$(curl -so /dev/null -w "%{http_code}" "$BASE/core/$f")
  [ "$S" = "200" ] && ok "$f (200)" || fail "$f HIÁNYZIK ($S)"
done

# ── 9. wallet.js CDN-mentes ──────────────────────────────────────────────
echo "=== 9. wallet.js CDN ellenőrzés ==="
WALLET=$(curl -s "$BASE/core/wallet.js")
echo "$WALLET" | grep -q "cdn.jsdelivr\|ethers_CDN\|import.*http" \
  && fail "wallet.js CDN importot tartalmaz!" \
  || ok "wallet.js CDN-mentes"

# ── Összefoglalás ─────────────────────────────────────────────────────────
echo ""
echo "═══════════════════════════════════"
echo "Phase 5 Biztonsági Teszt Eredmény"
echo "PASS: $PASS  |  FAIL: $FAIL"
echo "═══════════════════════════════════"
[ "$FAIL" -eq 0 ] && echo "✓ MINDEN TESZT PASSED" && exit 0 || echo "✗ $FAIL TESZT FAILED" && exit 1
