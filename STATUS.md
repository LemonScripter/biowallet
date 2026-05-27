# BioWallet — Státuszjelentés
**Verzió:** v0.6 (Phase 6 — face-api.js lokális bundle)  
**Dátum:** 2026-05-27  
**Git:** `bio-kernel-emu` branch  
**Deploy:** https://biowallet.metaspace.bio  

---

## Összefoglalás

Biometrikailag kötött, OS-független crypto wallet PWA.  
A privát kulcsot kizárólag a tulajdonos arca nyitja meg.  
A DCC kauzális lánc, BCH hibajavítás és Phase 5 biztonsági invariánsok formálisan bizonyítottak: **Z3 33/33 PASS**.  
Phase 5: CDN-mentes (lokális ethers.js), Web Worker sandbox, CSP + biztonsági fejlécek, EIP-1559, megerősítő overlay, egyenleg-ellenőrzés.

---

## Architektúra

```
Arc-scan (kamera)
    │
    ▼
FaceNet embedding (128-dim Float32)
  face-api.js — TinyFaceDetector + faceLandmark68Net + FaceRecognitionNet
    │
    ▼
Fuzzy Extractor (Phase 3 — BCH szindróma)
  Random projekció: b = sign(W·e), W ∈ R^{256×128}
  BCH szindróma: S = BCH_syndrome(b[0..254])  [50 bájt, GF(2^8)]
  Hibajavítás: Berlekamp–Massey + Chien, max 25 bit
  R = SHA-256(b_ref)  ← stabil kulcs  |  b_ref NEM tárolódik nyíltan
    │
    ▼
DCC Kauzális Token
  CausalToken { R, vaultId, issuedAt, consumed }
  TTL: OPEN=30s, SIGN=10s, EXPORT=5s
  Egyszeri felhasználás (TOCTOU zárás)
    │
    ▼
Vault (AES-256-GCM)
  key = PBKDF2(R, salt, 300_000 iter, SHA-256)
  plaintext: { seed: hex32, vaultId, created }
    │
    ▼
BIP39 + BIP32 HD Wallet (ethers.js v6)
  seed → 24 szavas mnemonic
  m/44'/60'/0'/0/0 → Ethereum cím + privát kulcs
```

---

## Fájlszerkezet

```
BioWallet/
├── src/
│   ├── app/
│   │   ├── index.html          — PWA UI (dark theme, kamera, TTL csíkok, küldő form)
│   │   ├── app.js              — App controller (DCC flow, RPC küldés, panel kezelés)
│   │   ├── manifest.json       — PWA manifest
│   │   └── sw.js               — ServiceWorker (dev: unregisztrálva)
│   └── core/
│       ├── bio_capture.js      — FaceNet embedding (face-api.js)
│       ├── fuzzy_extractor.js  — Fuzzy extractor Phase 3 (BCH szindróma)
│       ├── causal_chain.js     — DCC kauzális lánc + CausalToken
│       ├── vault.js            — AES-256-GCM vault (PBKDF2 KDF)
│       ├── wallet.js           — BIP39 + BIP32 + ECDSA (ethers.js v6)
│       └── rpc.js              — JSON-RPC 2.0 réteg (Sepolia + Mainnet, ethToWei)
├── spec/
│   └── biowallet.bio           — MetaSpace formális spec (7 DCC invariáns)
├── tests/
│   ├── verify_biowallet.py     — Z3 formális verifikáció (25/25 PASS)
│   └── test_bch.js             — BCH algoritmus egységtesztek (28/28 PASS)
├── deploy/
│   ├── nginx_biowallet.conf    — nginx vhost konfig
│   └── deploy_tokyo.sh         — deploy script
└── dev.py                      — Lokális dev szerver (port 3333)
```

---

## Formális verifikáció

**Spec:** `spec/biowallet.bio` — MetaSpace .bio DSL  
**Verifier:** `tests/verify_biowallet.py` — Z3 SMT solver  
**BCH teszt:** `tests/test_bch.js` — Node.js egységtesztek  

### DCC invariánsok (P1–P7)

| Invariáns | Leírás | Eredmény |
|-----------|--------|----------|
| P1 bio_gate | bio esemény nélkül SAT lehetetlen | ✅ PASS |
| P2 token_freshness | lejárt token → SAT lehetetlen | ✅ PASS |
| P3 token_single_use | felhasznált token → SAT lehetetlen (TOCTOU) | ✅ PASS |
| P4 vault_binding | vault ID mismatch → SAT lehetetlen | ✅ PASS |
| P5 sign_freshness | SIGN + age≥10s → SAT lehetetlen | ✅ PASS |
| P6 export_gate | EXPORT + age≥5s → SAT lehetetlen | ✅ PASS |
| P7 konzisztencia | összes feltétel → SAT lehetséges | ✅ PASS |

### DATA_FLOW invariánsok (DF1–DF9): **14/14 PASS**

### BCH invariánsok (BCH-P1–BCH-P4)

| Invariáns | Leírás | Eredmény |
|-----------|--------|----------|
| BCH-P1 | b_ref nyílt tárolása lehetetlen (Phase 3) | ✅ PASS |
| BCH-P2 | errors≤25 AND dekódolás sikertelen → lehetetlen | ✅ PASS |
| BCH-P3 | kulcs visszaállítás bio_match nélkül lehetetlen | ✅ PASS |
| BCH-P4 | BCH + DCC feltételek → SAT konzisztens | ✅ PASS |

**Összesített: 25/25 PASS — DCC + DATA_FLOW + BCH FORMÁLISAN BIZONYÍTVA**

### BCH algoritmus egységtesztek: **28/28 PASS**

---

## Deploy

| Elem | Állapot |
|------|---------|
| URL | https://biowallet.metaspace.bio/app/index.html |
| DNS | Netlify: `biowallet A 34.146.249.102` |
| Szerver | Tokyo GCP, nginx/1.22.1 |
| SSL | Let's Encrypt, lejár: 2026-08-24, auto-renew |
| HTTP státusz | 200 OK |
| Redirect | `biowallet.metaspace.bio/` → `/app/index.html` (301) |

---

## Biztonsági szintek

### Phase 3 — ✅ BCH szindróma kódolás aktív

| Támadás | Védelem | Szint |
|---------|---------|-------|
| .biowallet fájl ellopása | AES-256-GCM, kulcs R-től függ | ✅ Biztonságos |
| P.json ellopása | BCH szindróma — b_ref NEM tárolódik nyíltan | ✅ Biztonságos |
| .biowallet + P.json együtt | R csak friss arc-scannel rekonstruálható | ✅ Biztonságos |
| TOCTOU (token újrahasználat) | CausalToken.consumed flag | ✅ Biztonságos |
| Vault ID csere | token.boundTo(vaultId) ellenőrzés | ✅ Biztonságos |
| Replay attack | TTL + consumed flag kombináció | ✅ Biztonságos |
| CDN supply chain (ethers.js) | vendor/ethers.umd.min.js + ethers.bundle.js lokális | ✅ Biztonságos |
| CDN supply chain (face-api.js) | vendor/face-api.min.js + models/ lokális (Phase 6) | ✅ Biztonságos |
| Adatfolyam exfiltráció | CSP 'self' + Worker sandbox (Phase 5) | ✅ Zárt |
| ETH küldés | JSON-RPC 2.0 Sepolia + Mainnet | ✅ Implementálva |

### Phase 5 — ✅ KÉSZ (2026-05-27)

| Feladat | Állapot |
|---------|---------|
| CDN lokális bundle (ethers.js UMD + ESM esbuild) | ✅ KÉSZ |
| CSP header + 6 biztonsági fejléc (nginx) | ✅ KÉSZ |
| Web Worker crypto sandbox (vault_worker.js) | ✅ KÉSZ |
| EIP-1559 (maxFeePerGas + estimateGas) | ✅ KÉSZ |
| Megerősítő overlay + egyenleg-ellenőrzés | ✅ KÉSZ |
| Z3 33/33 PASS + smoke teszt 23/23 PASS | ✅ KÉSZ |

### Phase 6 — ✅ KÉSZ (2026-05-27)

| Feladat | Állapot |
|---------|---------|
| face-api.js lokális bundle (vendor/face-api.min.js, 649KB) | ✅ KÉSZ |
| Modell súlyok lokálisan (models/, 7 fájl, ~6.8MB) | ✅ KÉSZ |
| bio_capture.js CDN eltávolítva, MODELS_URL=/models | ✅ KÉSZ |
| index.html: face-api script tag az ethers előtt | ✅ KÉSZ |
| Teljes CDN-mentesség: CSP script-src 'self' valóban érvényes | ✅ KÉSZ |

### Következő lépések (Phase 6+)

| Prioritás | Feladat | Mit old meg |
|-----------|---------|-------------|
| 🟡 1 | Argon2 KDF (argon2-browser WASM) | Mem-hard KDF biometriai kulcsnál |
| 🟢 2 | QR kód (cím fogadáshoz) | UX |
| 🟢 3 | ERC-20 egyenleg (USDC, USDT) | Multi-token |
| 🟢 4 | ENS feloldás | Human-readable cím |
| 🟢 5 | WalletConnect v2 | dApp integráció |

---

## Fejlesztési napló

| Dátum | Verzió | Változás |
|-------|--------|---------|
| 2026-05-26 | v0.1 | Phase 1: pixel-sampling embedding, alaparchitektúra |
| 2026-05-26 | v0.2 | Phase 2: FaceNet (face-api.js), Tokyo deploy, DCC fix |
| 2026-05-27 | v0.3 | Phase 3: BCH(255,55,25) szindróma — b_ref nem tárolódik nyíltan; Z3 25/25; BCH teszt 28/28 |
| 2026-05-27 | v0.4 | Phase 4: JSON-RPC 2.0 réteg (rpc.js) — egyenleg, nonce, gasPrice, broadcastTx; ETH küldő form; hálózat választó (Sepolia/Mainnet) |
| 2026-05-27 | v0.5 | Phase 5: lokális ethers.js bundle, Web Worker sandbox, CSP+HSTS+biztonsági fejlécek, EIP-1559, megerősítő overlay, egyenleg-check; Z3 33/33; smoke 23/23 |
| 2026-05-27 | v0.6 | Phase 6: face-api.js lokális bundle (vendor/face-api.min.js) + modell súlyok (models/, ~6.8MB); bio_capture.js CDN-mentes; teljes CSP 'self' kompatibilitás |

---

*Feltaláló: Szőke László-Ferenc / Citrom Média LTD*  
*MetaSpace IP — OSIM szabadalom: 20251221-2230*
