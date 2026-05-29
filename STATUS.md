# BioWallet — Státuszjelentés
**Verzió:** v0.8 (Phase 9.0 COMPLETE — recovery_tool.html kész)  
**Dátum:** 2026-05-28  
**Git:** `bio-kernel-emu` branch  
**Deploy:** https://biowallet.metaspace.bio  

---

## Összefoglalás

Biometrikailag kötött, OS-független crypto wallet PWA.  
A privát kulcsot kizárólag a tulajdonos arca nyitja meg.  
A DCC kauzális lánc, BCH hibajavítás és Phase 9 biztonsági invariánsok formálisan bizonyítottak: **Z3 38/38 PASS**.  
Phase 9.0: A 24 szavas seed SOHA nem jelenik meg digitálisan. Helyette obfuszkált papír-képlet (c_j, r_j) generálódik.

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

### BCH invariánsok (BCH-P1–BCH-P4): **4/4 PASS**

### Phase 9 invariánsok (REC1–REC4): **5/5 PASS**

**Összesített: 38/38 PASS — DCC + DATA_FLOW + BCH + PHASE 9 FORMÁLISAN BIZONYÍTVA**

### BCH algoritmus egységtesztek: **28/28 PASS**

### Phase 9.0 Matematikai E2E teszt: **SUCCESS**

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

### Phase 9.0 — ✅ TELJES (2026-05-28, v0.8)

| Feladat | Állapot | Mit old meg |
|-----------|---------|-------------|
| EXPORT gomb eltávolítása | ✅ KÉSZ | Seed soha nem kerül a main thread-be |
| Papír-képlet generátor (c_j, r_j) | ✅ KÉSZ | Offline, papír-alapú visszaállítás |
| Z3 Verifikáció (38/38) | ✅ KÉSZ | Matematikai bizonyíték a biztonságra |
| E2E Matematikai teszt | ✅ KÉSZ | Visszafejtési képlet helyessége igazolva |
| recovery_tool.html (offline visszafejtő) | ✅ KÉSZ | 2048-szó BIP39 szólista beágyazva, production-ready |

> ⚠ **BIZTONSÁGI FIGYELMEZTETÉS (Digital Exposure Risk):**  
> A `recovery_tool.html` használata során a 24 szó digitálisan megjelenik a képernyőn. Ez sérülékenységet jelenthet képernyőfigyelő malware-ekkel szemben.  
> **KÖTELEZŐ PROTOKOLL:** Az eszközt csak **OFFLINE (Air-gap)** környezetben használja. A szavak felírása után zárja be a böngészőt, és törölje a gyorsítótárat, mielőtt újra csatlakozna az internetre.
>
> **URL:** https://biowallet.metaspace.bio/recovery_tool.html (letöltendő, offline futtatandó)

### Stratégiai irány — "Trustless by Design" (2026-05-28 döntés)

**Alapelv:** A felhasználónak nem kell megbíznia a BioWallet fejlesztőiben.
A rendszer úgy van tervezve, hogy nincs mit ellopni — és ez ellenőrizhető.

#### A három fenyegetés és megoldásuk

| Fenyegetés | Megoldás | Hogyan ellenőrizhető |
|-----------|---------|---------------------|
| Kompromittált szerver | Letölthető egyfájlos app + SHA-256 hash | `sha256sum biowallet.html` == GitHub hash |
| App rosszindulatú kódja | Nyílt forrás + Z3 formális bizonyíték | Bárki reprodukálhatja a Z3 tesztet |
| Papírtolvaj (A+B papír megvan) | P fejben — soha nem kerül az app-ba | Kétfázisú papírgenerálás |

#### Mit kommunikál az app a hálózaton?

```
BioWallet szervere ← SEMMI (letöltés után örökre)
Ethereum RPC node ← Csak aláírt tranzakció broadcast + egyenleg
  (eth.llamarpc.com, publicnode.com — publikus, decentralizált)

Bizonyíték: Böngésző DevTools → Network tab → biowallet.metaspace.bio
            egyetlen hívás sem jelenik meg tranzakció közben
```

### Fejlesztési ütemterv (2026-05-28 állapot)

#### Phase 9.1 — Trustless architektúra (következő)

| # | Feladat | Leírás |
|---|---------|--------|
| 9.1a | **Service Worker bekapcsolása** | PWA mode: app kód cache-elve, szerver nélkül fut |
| 9.1b | **Kétfázisú papírgenerálás** | P soha nem kerül az app-ba: raw_A_j app-ban, P-alkalmazás offline |
| 9.1c | **recovery_tool.html ENCODE mód** | Raw Paper A + P → Végleges Paper A (offline) |
| 9.1d | **recovery_tool.html DECODE mód átírás** | Papírok + P → .biowallet.tmp (szavak soha nem látszanak) |
| 9.1e | **Verzió hash a UI-ban** | Verifiable build: app mutatja saját SHA-256 hash-ét |
| 9.1f | **IMPORT flow felülvizsgálata** | Csak PWA-ból ajánlott + post-import protokoll útmutató |

#### Phase 9.2 — Letölthető önálló fájl

| # | Feladat | Leírás |
|---|---------|--------|
| 9.2a | **biowallet.html single-file build** | face-api + ethers + modellek beágyazva (~15 MB) |
| 9.2b | **SHA-256 hash GitHub README-ben** | Publikusan dokumentált, reprodukálható |
| 9.2c | **"Offline mód" UI jelzés** | App jelzi, ha hálózat nélkül fut (csak aláírás, nem broadcast) |

#### Phase C — UX funkciók (Phase 9.1 után)

| Prioritás | Feladat | Mit old meg |
|-----------|---------|-------------|
| 🟢 1 | QR kód (saját cím fogadáshoz) | UX — fogadás egyszerűsítése |
| 🟢 2 | ERC-20 egyenleg (USDC, USDT) | Multi-token megjelenítés |
| 🟢 3 | ENS feloldás (`vitalik.eth` → `0x...`) | Küldés egyszerűsítése |
| 🟢 4 | Multi-account (`m/44'/60'/0'/0/n`) | Több cím egy vaultból |
| 🟢 5 | Brute-force védelem (cooldown) | Biztonság |
| 🔵 6 | WalletConnect v2 | dApp integráció |

#### Phase 10 — 2-of-3 Küszöb-P (hosszú táv, tervezett)

**Alapelv:** P nem memorizált szám, hanem Shamir Secret Sharing (2-of-3) küszöbrendszer.  
Bármelyik kettő elegendő a 3 faktorból; az elveszett faktor pótolható a másik kettővel.

```
Faktor 1 — ARC         biometria  (már implementálva: face-api.js fuzzy extractor)
Faktor 2 — UJJLENYOMAT biometria  (WebAuthn platform authenticator: Touch ID, Windows Hello)
Faktor 3 — VAS         hardware   (WebAuthn roaming authenticator: YubiKey, FIDO2 token)

2-of-3 kombináció → Shamir reconstruct → P
```

| Kombináció | Vault nyitható? | Paper recovery? |
|---|---|---|
| Arc + Ujj | ✓ | ✓ |
| Arc + Vas | ✓ | ✓ |
| Ujj + Vas | ✓ (arc nélkül is) | ✓ |
| Csak Arc | ✗ (Phase 10-ben) | ✗ |

**Trade-off:** „Csak papír" (eszköz nélküli) recovery megszűnik — cserébe memorizált P sem kell.  
**Megjegyzés:** A papír visszafejtéshez is 2 faktor kell. Tudatos döntés.

**Implementációs terv:**

| # | Feladat | Részlet |
|---|---------|---------|
| P10.1 | **SSS (2,3) könyvtár** | Pure-JS Shamir (pl. `secrets.js`) — CDN-mentes bundle |
| P10.2 | **WebAuthn enrollment** | `navigator.credentials.create()` — ujj + vas regisztráció |
| P10.3 | **Share titkosítás** | S_ujj és S_vas WebAuthn assertion-nel védve |
| P10.4 | **vault formátum v4** | `.biowallet` kibővítve: 3 titkosított share + WebAuthn credential IDs |
| P10.5 | **recovery_tool.html** | WebAuthn mód: 2-of-3 faktorral P rekonstruálás → offline decode |
| P10.6 | **Z3 invariánsok** | SSS-P1: 1 share → P nem rekonstruálható; SSS-P2: 2 share → igen |
| P10.7 | **Faktor-pótlás flow** | Ha vas elvész: arc + ujj → P → új vas share generálás |

#### Phase D — Hitelességi réteg (hosszú táv)

| # | Feladat |
|---|---------|
| D1 | Független biztonsági audit (neves cég) |
| D2 | Bug bounty program |
| D3 | MetaSpace OSIM szabadalom hivatkozás a dokumentációban |

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
| 2026-05-27 | v0.7 | Phase 9.0: Papír-képlet generátor (c_j, r_j) implementálva; EXPORT gomb és seed-kijelzés eltávolítva; Z3 38/38 PASS; E2E math teszt PASS |
| 2026-05-28 | v0.8 | Phase 9.0 COMPLETE: recovery_tool.html offline visszafejtő, teljes 2048-szavas BIP39 szólista beágyazva (ethers.js verifikált); .gitignore fix; Gemini-katasztrófa utáni visszaállítás |
| 2026-05-28 | v0.9 | Phase 9.1a: SW bekapcsolva (PWA offline, biowallet-v2 cache, 22 fájl); Phase 9.1b: kétfázisú papír (P soha nem kerül app-ba, rawA+r → recovery_tool ENCODE); Z3 39/39 PASS |

---

*Feltaláló: Szőke László-Ferenc / Citrom Média LTD*  
*MetaSpace IP — OSIM szabadalom: 20251221-2230*
