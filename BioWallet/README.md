<p align="center">
  <h1 align="center">BioWallet</h1>
  <p align="center"><strong>Your face is the key. Your secret stays offline.</strong></p>
  <p align="center">
    <a href="https://biowallet.metaspace.bio">Live demo</a> ·
    <a href="README.hu.md">Magyar</a> ·
    <a href="SECURITY.md">Security policy</a> ·
    <a href="docs/architecture.md">Architecture</a> ·
    <a href="docs/formal-verification.md">Formal verification</a>
  </p>
</p>

<p align="center">
  <a href="https://biowallet.metaspace.bio"><img src="https://img.shields.io/badge/live-biowallet.metaspace.bio-6c63ff" alt="Live" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-green" alt="License: MIT" /></a>
  <a href="tests/verify_biowallet.py"><img src="https://img.shields.io/badge/Z3%20invariants-51%2F51%20PASS-brightgreen" alt="Z3 51/51" /></a>
  <a href="tests/verify_sss_gf256.py"><img src="https://img.shields.io/badge/SSS%20GF(2%E2%81%B8)-13%2F13%20PASS-brightgreen" alt="SSS GF(2^8)" /></a>
  <img src="https://img.shields.io/badge/CDN%20dependencies-zero-blue" alt="No CDN" />
</p>

---

BioWallet is a self-sovereign, biometric Ethereum wallet that runs entirely in the browser. There is no server that handles your key, no account to create, no password to forget. A scan of your face derives the encryption key locally — and that key is discarded after every single operation.

**Multi-network EVM support:** Ethereum, BNB Chain, Polygon, Arbitrum, Base, Optimism, Avalanche, Sepolia — plus any custom EVM network.

---

## Security — proved, not claimed

Most wallets tell you they are secure. BioWallet shows you the proof.

| Claim | Mechanism | Evidence |
|---|---|---|
| Private key never touches the main thread | Web Worker isolation — all signing in `vault_worker.js` | [src/app/vault_worker.js](src/app/vault_worker.js) |
| Face data cannot be reversed to the key | BCH(63,51,t=6) fuzzy extractor + HKDF — one-way derivation | [src/core/fuzzy_extractor.js](src/core/fuzzy_extractor.js) |
| Vault key erased after every operation | DCC auto-lock: `SIGN → LOCK` in the same causal chain | [DCC-4 formal proof](tests/verify_biowallet.py) |
| Vault cannot open without a fresh biometric token | Token TTL = 30 s, single-use, Z3-verified | [DCC-1, DCC-2](tests/verify_biowallet.py) |
| Shamir GF(2⁸) arithmetic is provably correct | Z3 BitVec, 196 608 exhaustive cases verified | [tests/verify_sss_gf256.py](tests/verify_sss_gf256.py) |
| No third-party code fetched at runtime | All vendors bundled locally, SHA-256 build fingerprint | [src/vendor/](src/vendor/) |
| Offline recovery without exposing the seed | Two-step paper formula — P value never enters the app | [recovery\_tool.html](recovery_tool.html) |

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

Result: 51 / 51  PASS ✓

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

---

## Architecture

See [docs/architecture.md](docs/architecture.md) for a complete technical description including the vault format, the DCC state machine, and the worker message protocol.

---

## Cryptography

See [docs/cryptography.md](docs/cryptography.md) for the full cryptographic specification:
- BCH(63,51,t=6) fuzzy extractor with HKDF-SHA-256
- AES-256-GCM vault encryption (vault format p3)
- BIP39 mnemonic → BIP44 HD key derivation
- Shamir Secret Sharing over GF(2⁸) (Phase 10)
- DCC causal token protocol

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

---

## Roadmap

- [ ] **Argon2id KDF** — replace PBKDF2 with memory-hard KDF (vault format v4)
- [ ] **Multi-account** — BIP44 `m/44'/60'/0'/0/n`, multiple addresses
- [ ] **Phase 10 SSS(2,3)** — face + WebAuthn hardware key + paper, any 2-of-3 sufficient
- [ ] **Single-file build** — air-gapped `biowallet.html` (~11 MB, all assets inlined)
- [ ] **Protocol fee** — optional 0.1 % developer fee on direct sends

---

## Project structure

```
biowallet/
├── src/
│   ├── app/            # UI layer (index.html, app.js, sw.js)
│   ├── core/           # Business logic (vault, rpc, wc2, bio_capture, …)
│   └── vendor/         # Bundled third-party libraries (no CDN)
├── tests/
│   ├── verify_biowallet.py   # 51 Z3 formal properties
│   └── verify_sss_gf256.py   # 13 GF(2^8) SSS proofs
├── tools/
│   └── build_wc2_entry.js    # WalletConnect v2 bundle entry point
├── recovery_tool.html         # Offline paper recovery decoder
├── docs/
├── README.md
├── README.hu.md
└── SECURITY.md
```

---

## License

MIT © 2025–2026 [Laszlo SZOKE](https://github.com/LemonScripter) / Citrom Média LTD

BioWallet is open source. You are free to audit, fork, and self-host. If you find a security issue, please read [SECURITY.md](SECURITY.md) before disclosing publicly.
