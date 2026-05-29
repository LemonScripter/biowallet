# BioWallet — Open Vault Format Specification

Version: 1.0  
Author: Szőke László-Ferenc | MetaSpace.Bio Logic Engine project | metaspace.bio, biowallet.metaspace.bio | admin@metaspace.bio  
Purpose: Sovereignty guarantee — any developer can implement wallet recovery
without the BioWallet service. If BioWallet shuts down, your funds remain
accessible using the files, the math below, and your biometrics.

---

## Files

### `<uuid>.biowallet` — Encrypted vault (binary)

Raw `ArrayBuffer`. No file header, no magic bytes — pure binary.

| Offset | Length   | Field      | Description                                   |
|--------|----------|------------|-----------------------------------------------|
| 0      | 32       | `salt`     | PBKDF2 salt (cryptographically random)        |
| 32     | 12       | `iv`       | AES-GCM IV (cryptographically random)         |
| 44     | n + 16   | `ciphertext` | AES-256-GCM ciphertext + 16-byte auth tag   |

The WebCrypto `SubtleCrypto.encrypt` output appends the 16-byte GCM
authentication tag to the ciphertext automatically.

**Decrypted JSON payload:**

```json
{
  "seed":     "<hex string — 32 bytes = 256-bit BIP39 entropy>",
  "accounts": [],
  "vaultId":  "<UUID v4>",
  "created":  1234567890000
}
```

The `seed` field is the **BIP39 entropy** (not the BIP39 seed derived via
PBKDF2-HMAC-SHA512). It maps directly to 24 BIP39 words via
`Mnemonic.fromEntropy(seed_hex)` in ethers.js v6.

### `<uuid>.P.json` — BCH helper data (public)

BCH(255, 55, 25) error-correcting syndrome data. This file is NOT a face
image or biometric template. It is required to reconstruct the stable key `R`
from a fresh face scan.

Structure defined by `src/core/fuzzy_extractor.js`. The `vaultId` field
inside `.P.json` must match the vault file name.

---

## Key Derivation Chain

```
Face scan (live video)
  │
  ▼ FaceNet 512-dim embedding (Float32Array)
  │
  ▼ BCH(255,55,25) fuzzy extraction  ← P from .P.json
  │   corrects up to 25-bit deviation between enrollment and current scan
  │
  R  (Uint8Array, 32 bytes) — stable biometric key
  │
  ▼ PBKDF2-SHA256(password=R, salt=salt[0:32], iterations=300_000)
  │
  CryptoKey (AES-256-GCM, non-extractable)
  │
  ▼ AES-GCM decrypt(iv=iv[32:44], ciphertext=file[44:])
  │   auth tag verification included
  │
  JSON { seed: "hex32" }
  │
  ▼ Uint8Array.from hex  →  32-byte BIP39 entropy
  │
  ▼ Mnemonic.fromEntropy(entropy)  →  24-word BIP39 phrase
  │
  ▼ HDNodeWallet.fromSeed(mnemonic).derivePath("m/44'/60'/0'/0/0")
  │
  Ethereum private key + address
```

---

## Offline Recovery (no BioWallet service)

Requirements:
1. The `.biowallet` file
2. The `.P.json` file
3. A working biometric (face scan) — must be the **same browser + GPU** used
   during enrollment due to FaceNet GPU-backend differences
4. A compatible BCH(255,55,25) fuzzy extractor implementation
5. ethers.js v6 (or any BIP39 + secp256k1 library)

Reference implementation: `src/core/` (Apache 2.0 / MIT — to be confirmed).

---

## Phase 9 — Paper Formula (planned)

The goal: the 24-word seed phrase **never appears in any digital system**.
Recovery is possible offline, by hand, on paper.

### Math

Let `i_j` be the BIP39 word index (0–2047) for word j (j = 1..24).

**Encoding (server-assisted, Ring 0 protected):**

```
c_j = (i_j  −  r_j  −  hash(P)[j])  mod 2048
```

Where:
- `r_j` = server-generated secure-random offset for word j (Paper B, kept by user)
- `P`   = personal episodic number (never stored anywhere, memorized only)
- `hash(P)` = SHA-256(P) used as 24 integer offsets mod 2048
- `c_j` = obfuscated word code (Paper A, kept by user)

**Recovery (offline, by hand):**

```
i_j = (c_j  +  r_j  +  hash(P)[j])  mod 2048
```

Look up `i_j` in the public BIP39 word list → 24-word phrase → MetaMask import.

### Properties

| Property | Value |
|----------|-------|
| 24 words visible in software | Never |
| Paper A alone sufficient | No (needs B + P) |
| Paper B alone sufficient | No (needs A + P) |
| P alone sufficient | No (needs A + B) |
| Server can recover wallet | No (only has r_j, never seed) |
| Works after service shutdown | Yes (A + B + P + BIP39 word list) |

### Files (planned)

- `src/core/recovery_formula.js` — browser-side c_j computation
- `server/recovery_api.py` — r_j generation, secure print, fill(0)

---

## Versioning

| Version | Changes |
|---------|---------|
| 1.0 | Initial format (PBKDF2 + AES-256-GCM, single biometric factor) |
| 2.0 | Planned: Shamir 2-of-3 (Phase 7), Argon2 KDF (Phase 6) |
