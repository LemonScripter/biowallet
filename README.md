<p align="center">
  <h1 align="center">BioWallet</h1>
  <p align="center"><strong>Your face is the key. Your secret stays offline.</strong></p>
  <p align="center">
    <a href="https://biowallet.metaspace.bio">Live demo</a> ·
    <a href="../../releases/latest">⬇ Download</a> ·
    <a href="README.hu.md">Magyar</a> ·
    <a href="SECURITY.md">Security policy</a> ·
    <a href="THREAT_MODEL.md">Threat model</a> ·
    <a href="docs/architecture.md">Architecture</a> ·
    <a href="docs/formal-verification.md">Formal verification</a>
  </p>
</p>

<p align="center">
  <a href="https://biowallet.metaspace.bio"><img src="https://img.shields.io/badge/live-biowallet.metaspace.bio-6c63ff" alt="Live" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-Non--Commercial-orange" alt="License: Non-Commercial" /></a>
  <a href="tests/verify_biowallet.py"><img src="https://img.shields.io/badge/Z3%20invariants-56%2F56%20PASS-brightgreen" alt="Z3 56/56" /></a>
  <a href="tests/verify_sss_gf256.py"><img src="https://img.shields.io/badge/SSS%20GF(2%E2%81%B8)-13%2F13%20PASS-brightgreen" alt="SSS GF(2^8)" /></a>
  <img src="https://img.shields.io/badge/CDN%20dependencies-zero-blue" alt="No CDN" />
  <a href="THREAT_MODEL.md"><img src="https://img.shields.io/badge/threat%20model-published-informational" alt="Threat model" /></a>
  <a href="../../releases/latest"><img src="https://img.shields.io/badge/air--gap%20build-11.5%20MB-success" alt="Air-gap build" /></a>
  <a href="https://doi.org/10.5281/zenodo.20517348"><img src="https://img.shields.io/badge/DOI-10.5281%2Fzenodo.20517348-blue" alt="DOI" /></a>
</p>

---

BioWallet is a self-sovereign, biometric Ethereum wallet that runs entirely in the browser. There is no server that handles your key, no account to create, no password to forget. A scan of your face derives the encryption key locally — and that key is discarded after every single operation.

**Import options:** create a new wallet with face enrollment, import an existing wallet from a 12–24-word BIP39 seed phrase, or import a raw private key (e.g. a MetaMask imported account). All three are stored under the same biometric vault — face scan is always required to open.

**Multi-network EVM support:** Ethereum, BNB Chain, Polygon, Arbitrum, Base, Optimism, Avalanche, Sepolia — plus any custom EVM network.

---

## Security — proved, not claimed

Most wallets tell you they are secure. BioWallet shows you the proof.

| Claim | Mechanism | Evidence |
|---|---|---|
| Private key never touches the main thread | Web Worker isolation — all signing in `vault_worker.js` | [src/app/vault_worker.js](src/app/vault_worker.js) |
| Face data cannot be reversed to the key | BCH(255,55,t=25) fuzzy extractor + HKDF — one-way derivation | [src/core/fuzzy_extractor.js](src/core/fuzzy_extractor.js) |
| Vault key erased after every operation | DCC auto-lock: `SIGN → LOCK` in the same causal chain | [DCC-4 formal proof](tests/verify_biowallet.py) |
| Vault cannot open without a fresh biometric token | Token TTL = 30 s, single-use, Z3-verified | [DCC-1, DCC-2](tests/verify_biowallet.py) |
| Cross-device open requires face + PIN | v3 vault: `PBKDF2(face_R ‖ PIN, salt, 300k)` — wrong PIN = wrong key, indistinguishable from wrong face | [src/core/vault.js](src/core/vault.js) |
| Enrolled device opens without PIN | WebAuthn PRF: `HKDF(face_R ‖ device_prf, salt)` — device factor is additional, not instead of biometric | [src/core/vault.js](src/core/vault.js) |
| Shamir GF(2⁸) arithmetic is provably correct | Z3 BitVec, 196 608 exhaustive cases verified | [tests/verify_sss_gf256.py](tests/verify_sss_gf256.py) · [DOI 10.5281/zenodo.20517348](https://doi.org/10.5281/zenodo.20517348) |
| No third-party code fetched at runtime | All vendors bundled locally, SHA-256 build fingerprint, SRI integrity attributes | [src/vendor/](src/vendor/) |
| No XSS via dApp metadata | All WalletConnect-provided strings (dApp name, symbol, image URL, chain name) HTML-escaped via `h()` before DOM injection; `javascript:` URIs blocked in image sources | [src/app/app.js](src/app/app.js) |
| Offline recovery without exposing the seed | Two-step paper formula — P value never enters the app | [recovery\_tool.html](recovery_tool.html) |
| DCC constitution tamper-evident | SHA-256 of `spec/biowallet.bio` anchored on Arbitrum One blockchain | [CONSTITUTION.md](CONSTITUTION.md) |
| Genesis identity chain tamper-evident | `genesis_hmac` = HMAC-SHA256(HKDF(vault\_key, "biowallet-genesis-hmac-v1"), JSON(genesis + dna\_chain)); verified on every vault open | [src/core/vault.js](src/core/vault.js) |
| MetaMask-compatible address derivation | Three key types: `raw` (native), `bip39` (BIP39 PBKDF2 → BIP32, matches MetaMask HD accounts), `privkey` (raw 32-byte key, matches MetaMask imported accounts) | [src/core/wallet.js](src/core/wallet.js) |

### Formal verification results

```
$ python tests/verify_biowallet.py

DCC-1   PASS  vault_open → token_fresh
DCC-2   PASS  ¬(token_consumed ∧ vault_open_again)
DCC-3   PASS  vault_open → causal_chain_valid
DCC-4   PASS  sign → next_state = LOCKED
DCC-5   PASS  no token reuse across sessions
DCC-6   PASS  vault_state ∈ {LOCKED, OPEN, SIGNING}
DCC-7   PASS  bio_mismatch → remain_locked
...
ALKOT-1  PASS  enrolled_factors ≥ 2 → enrollment_complete
ALKOT-6  PASS  face_only ∧ ¬fingerprint ∧ ¬hw_key → ¬vault_open_p10
GENESIS-1  PASS  re-enrollment cannot change genesis.dna
GENESIS-2  PASS  v5 + chain_len=1 + dna_mismatch → sign_blocked
GENESIS-3  PASS  re-enrollment strictly grows chain_len
GENESIS-4  PASS  v5 + chain_len>1 → sign_blocked_genesis=False
GENESIS-OK PASS  v5 + face_open + genesis_match → SAT (consistent)

Result: 56 / 56  PASS ✓

$ python tests/verify_sss_gf256.py

GF-1   PASS  a ⊕ a = 0  (additive inverse)
GF-2   PASS  a · 1 = a  (multiplicative identity)
GF-3   PASS  a · b = b · a  (commutativity)
GF-4   PASS  a · (b · c) = (a · b) · c  (associativity)
GF-5   PASS  distributive law
GF-6   PASS  a ≠ 0 → a · a⁻¹ = 1  (multiplicative inverse)
SSS-1  PASS  reconstruct(split(secret, 2, 3)[0..1]) = secret
SSS-2  PASS  reconstruct(split(secret, 2, 3)[0,2]) = secret
SSS-3  PASS  reconstruct(split(secret, 2, 3)[1,2]) = secret
SSS-4  PASS  single share reveals no information about secret
EXH-1  PASS  196 608 exhaustive GF(2⁸) multiplication cases
EXH-2  PASS  256 exhaustive inverse cases
EXH-3  PASS  256 exhaustive Lagrange interpolation cases

Result: 13 / 13  PASS ✓
```

---

## Competitive comparison

BioWallet, Ledger, Trezor and MetaMask rated across 8 threat categories (scale 1–4):

<p align="center">
  <img src="docs/radar_chart.svg" alt="Security radar chart — BioWallet vs Ledger vs Trezor vs MetaMask" width="560"/>
</p>

Full analysis with data tables and bar charts: <a href="https://biowallet.metaspace.bio/docs/security_comparison_en.html" target="_blank" rel="noopener">English</a> · <a href="https://biowallet.metaspace.bio/docs/security_comparison_hu.html" target="_blank" rel="noopener">Magyar</a>

---

## How it works

```
┌─────────────────────────────────────────────────────────────────┐
│  Browser main thread                                            │
│                                                                 │
│  face scan  ──►  Float32Array embedding                         │
│                         │                                       │
│           postMessage() │  (embedding never stored)            │
│                         ▼                                       │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  vault_worker.js  (isolated Worker thread)               │   │
│  │                                                          │   │
│  │  embedding ──► BCH fuzzy extractor ──► vault_key         │   │
│  │  vault_key ──► AES-256-GCM decrypt ──► BIP39 seed        │   │
│  │  seed      ──► m/44'/60'/0'/0/0    ──► private key       │   │
│  │  private key ──► sign TX           ──► signed bytes      │   │
│  │  DCC auto-lock: private key erased immediately after     │   │
│  └─────────────────────────────────┬────────────────────────┘   │
│                                    │ signed bytes only          │
│                postMessage() ◄─────┘                           │
│                         │                                       │
│  signed TX  ──►  JSON-RPC  ──►  EVM node (public endpoint)     │
└─────────────────────────────────────────────────────────────────┘
```

**Key invariant:** the private key is derived, used, and discarded inside the Worker — it never appears in the main thread, the DOM, or any network request to BioWallet's infrastructure (there is none).

---

## Features

| Phase | Feature |
|---|---|
| Phase 1–3 | FaceNet biometrics, BCH fuzzy extractor, BIP39/BIP44 HD wallet |
| Phase 4–5 | AES-256-GCM vault, EIP-1559 fee estimation, ETH send |
| Phase 6 | DCC (Digital Causal Closure) auto-lock protocol |
| Phase 9.0 | Two-step paper recovery — P value never stored digitally |
| Phase 9.1 | PWA / offline support, verifiable SHA-256 build fingerprint |
| C1 | QR code for receive address |
| C2 | ERC-20 balances and transfers (USDC, USDT, WETH, …) |
| C3 | ENS resolution (name.eth → 0x…) |
| C5 | Brute-force cooldown (3 mismatches → exponential backoff) |
| C6 | WalletConnect v2 — dApp sessions, `eth_sendTransaction`, `personal_sign`, `wallet_switchEthereumChain` |
| C7 | Transaction history via Blockscout API v2 |
| v13 | Multi-network: 8 built-in EVM chains + custom network support |
| v22 | Bilingual UI (HU / EN) — language toggle in the header |
| v23 | P6 TX Commitment Invariant — 8-char fingerprint bound to transaction hash; user types first 4 chars before the second scan |
| v25 | WebAuthn PRF device factor — platform authenticator (fingerprint / Face ID) enrolled per device; opens vault without PIN on enrolled device |
| v26 | PIN mandatory 2FA — v3 vault: `PBKDF2(face_R ‖ PIN, salt, 300k)`; PIN required on new/unenrolled devices; device path is always PIN-free |
| v27 | Mobile camera compatibility (Samsung ideal constraints, Firefox file picker fix, WebAuthn 60 s timeout) |
| v28 | Named wallet save modal (`showSaveFilePicker`), scientific background docs (EN + HU), SW cache v12 |
| v29 | DCC constitution on-chain anchor (Arbitrum One), SRI integrity on vendor JS, CSP headers, Non-Commercial license, PWA auto-update banner; **Phase 10 SSS(2,3)** — Shamir 2-of-3: face share (x=1), WebAuthn device share (x=2), paper share (x=3); any 2-of-3 sufficient to open vault |
| v30 | Mobile compatibility: vault file picker fix (user gesture preserved), `visibilitychange` camera restart, vault pre-validation (`salt` + `vaultId` check) |
| v31 | Security comparison pages (radar chart + EN/HU bar-chart analyses), header comparison link |
| v32 | Vault v5: genesis.dna identity anchor, dna_chain re-enrollment history, genesis_backup (face-only emergency recovery); mandatory face re-enrollment after SSS paper+device open (`re_enrollment_via_sss` chain entry); annual re-enrollment reminder banner (365 / 730 day thresholds) |
| v33 | Paraswap swap integration (ERC-20 → any token, approve+swap, gas speed selector Slow/Normal/Fast, 5-4-3-2-1 countdown camera overlay, USD price display via DeFi Llama, 0.15% protocol fee) |
| v34 | **MetaMask import fix:** correct BIP39 seed derivation for HD accounts (`keyType: bip39`); **private key import** for MetaMask imported accounts (`keyType: privkey`); bilingual import UI (12–24-word tab / Private key tab); full i18n on import panel |
| v35 | **Genesis HMAC:** `genesis_hmac` field in vault JSON — HMAC-SHA256(HKDF(vault\_key), genesis+dna\_chain) verified on every open; `ignoreChecks` removed from Paraswap — balance verified before broadcast; **production-ready** |
| v35.1 | **Paper formula fix:** 12-word (16-byte) entropy support in `entropyToIndices`; `privkey` vault guard before DCC gate; split try-catch in `btnPaper`. **Worker self-healing:** `onerror`/`onmessageerror` reject all pending promises, 30 s timeout, `unhandledrejection` → scanning reset. **XSS hardening:** `h()` escape + `safeImgSrc()` on all WalletConnect-sourced HTML. **Mobile:** paper grid `minmax(0,1fr)`. **PWA fix:** nginx `sw.js no-cache`, `reg.update()` on load. **Docs:** `THREAT_MODEL.md` published, `SECURITY.md` liveness disclosure, GitHub Private Vulnerability Reporting enabled |
| v35.2 | **Multi-wallet UI:** `biowallet_wallets` index + per-wallet storage; wallet switcher modal with NATIVE / SEED / PRIVKEY type badges; address preview; add/delete wallets. **TX ABI decode:** `_decodeCalldata()` — common ERC-20 selectors (`transfer`, `approve`, `transferFrom`) shown in confirm dialog. **Paper recovery 12-word:** `recovery_tool.html` now accepts 12 or 24 numbers; length mismatch guard. **Paper share CRC-8:** `_crc8()` + `_paperHexWithCrc()` — 66-char codes, backward compatible with 64-char. **Audit:** `INTERNAL_AUDIT_V1.md` published, 15 flows 0 WARN. **User guide:** full rewrite HU+EN — import section, multi-wallet section, type badges, 12/24-word recovery |
| v35.3 | **Argon2id KDF (vault v6):** `@noble/hashes` pure-JS Argon2id replaces PBKDF2 for face-share key wrapping — m=65536 (64 MB), t=3, p=1, OWASP offline minimum; `noble-argon2.js` vendor bundle (12 KB, no WASM); all new vaults use v6; `upgradeToV6()` migration for existing v5 vaults; full backward compat (v1–v5 open unchanged). **WC session expiry:** countdown in session bar (`23h` / `45m` / `⚠ 3m`), 60 s interval, auto-refresh on expiry. **APP_VERSION v35.3** |

---

## Architecture

See [docs/architecture.md](docs/architecture.md) for a complete technical description including the vault format, the DCC state machine, and the worker message protocol.

---

## Cryptography

See [docs/cryptography.md](docs/cryptography.md) for the full cryptographic specification:
- BCH(255,55,t=25) fuzzy extractor with HKDF-SHA-256
- AES-256-GCM vault encryption (vault format p3)
- BIP39 mnemonic → BIP44 HD key derivation
- Shamir Secret Sharing over GF(2⁸) (Phase 10)
- DCC causal token protocol

---

## Air-gapped / offline use

BioWallet ships as a **single self-contained HTML file** with every asset inlined — no internet required after download.

**[⬇ Download biowallet.html from the latest release](../../releases/latest)**

```bash
# Verify before opening (optional but recommended)
sha256sum biowallet.html
# Compare against the fingerprint published in HASHES.md
```

| Property | Value |
|----------|-------|
| File size | ~11.5 MB |
| Contents | All JS, CSS, face-api models, ethers.js, WalletConnect — all inlined |
| Network | Zero outbound connections (no CDN, no telemetry) |
| Works offline | ✅ — open as `file://` or serve locally |
| Build from source | `python build_single.py` in the repo root |

> **Note:** the WalletConnect dApp integration requires internet. All other features (create wallet, import, sign, paper recovery) work fully offline.

---

## Self-hosting

BioWallet is a static site — no backend required.

```bash
# Clone
git clone https://github.com/LemonScripter/biowallet.git
cd biowallet

# Serve from src/
# Any static file server works. Example with Python:
cd src && python3 -m http.server 8080

# Or with nginx — see docs/architecture.md for the recommended
# Content-Security-Policy headers (no unsafe-inline for scripts).
```

**Requirements:** HTTPS (required by WebCrypto API and camera access), modern browser (Chrome 90+, Firefox 88+, Safari 15+).

---

## Running the formal verification

```bash
pip install z3-solver
python tests/verify_biowallet.py
python tests/verify_sss_gf256.py
```

Both scripts are self-contained and produce human-readable PASS/FAIL output for every property.

**Citable archive:** [DOI 10.5281/zenodo.20517348](https://doi.org/10.5281/zenodo.20517348)

---

## Roadmap

- [ ] **Argon2id KDF** — replace PBKDF2 with memory-hard KDF (vault format v6)
- [x] **Multi-wallet UI** — wallet switcher, NATIVE/SEED/PRIVKEY type badges, add/delete *(LIVE since v35.2)*
- [x] **TX ABI decode** — ERC-20 function names shown in confirm dialog *(LIVE since v35.2)*
- [x] **Argon2id KDF** — vault v6, m=64 MB, t=3, p=1; upgrade button for existing v5 vaults *(LIVE since v35.3)*
- [x] **WC session expiry** — countdown in session bar *(LIVE since v35.3)*
- [ ] **Liveness / PAD** — presentation-attack detection (photo/video replay mitigation)
- [x] **Phase 10 SSS(2,3)** — face + WebAuthn hardware key + paper, any 2-of-3 sufficient *(LIVE since v29)*
- [x] **MetaMask import** — BIP39 seed phrase (12–24 words) and raw private key, correct HD derivation *(LIVE since v34)*
- [x] **Paraswap swap** — ERC-20 token swaps with gas speed selector, balance-checked *(LIVE since v35)*
- [x] **Genesis HMAC** — tamper-evident identity chain, verified on every vault open *(LIVE since v35)*
- [x] **Single-file build** — air-gapped `biowallet.html` (~11.5 MB, all assets inlined) — [download latest release](../../releases/latest)
- [ ] **Liveness / PAD** — presentation-attack detection (photo/mask spoofing mitigation)
- [ ] **External security audit** — independent third-party review (Trail of Bits / Least Authority)

---

## Project structure

```
biowallet/
├── src/
│   ├── app/            # UI layer (index.html, app.js, sw.js)
│   ├── core/           # Business logic (vault, rpc, wc2, bio_capture, …)
│   └── vendor/         # Bundled third-party libraries (no CDN)
├── tests/
│   ├── verify_biowallet.py   # 56 Z3 formal properties
│   └── verify_sss_gf256.py   # 13 GF(2^8) SSS proofs
├── tools/
│   └── build_wc2_entry.js    # WalletConnect v2 bundle entry point
├── recovery_tool.html         # Offline paper recovery decoder
├── docs/
├── README.md
├── README.hu.md
├── SECURITY.md            # Responsible disclosure, audit status, liveness disclaimer
├── THREAT_MODEL.md        # Asset inventory, attacker models, trust boundaries, risk matrix
├── HASHES.md              # SHA-256 build fingerprints (verified by app footer)
└── checksums.txt          # sha256sum -c verifiable file hashes
```

---

## License

MIT + Commons Clause (Non-Commercial) © 2025–2026 Szőke László-Ferenc — [MetaSpace.Bio Logic Engine](https://metaspace.bio) | admin@metaspace.bio

BioWallet is open source. You are free to audit, fork, and self-host for personal or research use. Commercial use requires written permission. If you find a security issue, please read [SECURITY.md](SECURITY.md) before disclosing publicly.
