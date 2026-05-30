# BioWallet — Open Vault Format Specification

Version: 5.0  
Author: Szőke László-Ferenc | MetaSpace.Bio Logic Engine | metaspace.bio | admin@metaspace.bio  
Purpose: Sovereignty guarantee — any developer can implement wallet recovery
without the BioWallet service. If BioWallet shuts down, your funds remain
accessible using the files, the math below, and your biometrics.

---

## Files

### `<uuid>.biowallet` — Encrypted vault (JSON, UTF-8)

All current vault versions (v3–v5) use a JSON file. The `v` field identifies the
format version. Older binary-format vaults (v1/v2) are no longer produced.

#### Common fields (all versions ≥ 3)

| Field | Type | Description |
|---|---|---|
| `v` | integer | Vault format version (3, 4, or 5) |
| `vaultId` | string (UUID v4) | Stable wallet identifier |
| `salt` | hex string (64 chars = 32 bytes) | PBKDF2/HKDF salt |
| `iv` | hex string (24 chars = 12 bytes) | AES-GCM IV |
| `ct` | hex string | AES-256-GCM ciphertext + 16-byte auth tag |

#### v3 vault

```json
{
  "v": 3,
  "vaultId": "<uuid>",
  "salt": "<64 hex chars>",
  "iv": "<24 hex chars>",
  "ct": "<hex — AES-256-GCM of seed JSON>"
}
```

Key derivation: `PBKDF2-SHA256(face_R ‖ PIN, salt, 300 000 iterations)`.  
On an enrolled device the `device_prf` from WebAuthn PRF replaces PIN:
`HKDF-SHA256(face_R ‖ device_prf, salt)`.

#### v4 vault (Phase 10 SSS — LIVE since v29)

Adds Shamir 2-of-3 secret sharing. The BIP39 seed is split into three shares
over GF(2⁸); any two shares reconstruct it.

```json
{
  "v": 4,
  "vaultId": "<uuid>",
  "salt": "<64 hex chars>",
  "iv": "<24 hex chars>",
  "ct": "<hex>",
  "sss": {
    "faceShare":   { "x": 1, "y": "<hex>" },
    "deviceShare": { "x": 2, "y": "<hex>" } | null,
    "paperX":      3
  }
}
```

- `faceShare` — share x=1, encrypted in `ct` alongside the seed; recovered via face biometric
- `deviceShare` — share x=2, bound to the WebAuthn PRF of the enrolled device; `null` if no device enrolled
- `paperX` — share x=3 is printed as 64 hex characters on paper; never stored digitally

To reconstruct the seed, any two of the three shares are sufficient.

#### v5 vault (vault v5 genesis DNA — branch v32)

Extends v4 with a biometric identity anchor (`genesis.dna`) and an emergency
face-only recovery path (`genesis_backup`).

```json
{
  "v": 5,
  "vaultId": "<uuid>",
  "salt": "<64 hex chars>",
  "iv": "<24 hex chars>",
  "ct": "<hex>",
  "sss": {
    "faceShare":   { "x": 1, "y": "<hex>" },
    "deviceShare": { "x": 2, "y": "<hex>" } | null,
    "paperX":      3
  },
  "genesis": {
    "dna": "<64 hex chars — SHA-256(face_R_0 ‖ ts_u64be)>",
    "ts":  1748563200000
  },
  "dna_chain": [
    { "gen": 0, "hash": "<64 hex>", "ts": 1748563200000, "method": "initial_enrollment" },
    { "gen": 1, "hash": "<64 hex>", "ts": 1748600000000, "method": "re_enrollment" }
  ],
  "genesis_backup": {
    "gbSalt": "<64 hex>",
    "gbIv":   "<24 hex>",
    "gbCt":   "<hex — AES-256-GCM of seed JSON, key = PBKDF2(R_genesis, gbSalt, 300k)>"
  }
}
```

**`genesis.dna`** — immutable identity anchor, set at first enrollment:
`SHA-256(face_R_0 ‖ ts_u64be)` where `ts_u64be` is the enrollment timestamp as
a big-endian 8-byte integer. Stored in plaintext; not a secret.

**`dna_chain`** — ordered list of re-enrollment events. Each entry is
`SHA-256(prev_hash ‖ genesis.dna ‖ ts.toString())`. The chain can only grow;
`genesis.dna` is checked against `chain[0]` at SIGN time (unless `chain_len > 1`
which means re-enrollment has occurred).

**`genesis_backup`** — emergency recovery path: the seed is re-encrypted
with a key derived from the face alone (no PIN, no device):

```
R_genesis = SHA-256(project(embedding, FIXED_W))
key       = PBKDF2-SHA256(R_genesis, gbSalt, 300 000 iterations)
gbCt      = AES-256-GCM(key, seed_json, gbIv)
```

`FIXED_W` is built from an all-zeros 32-byte seed — a public constant, not a
secret. `R_genesis` is one-way: knowing `FIXED_W` does not help reconstruct the
face embedding.

`genesis_backup` is only present on freshly created v5 vaults and after
`reEnrollFace`. Upgraded v4→v5 vaults do not have it until re-enrollment.

---

### `<uuid>.P.json` — BCH helper data (public)

Contains the BCH syndrome needed to reconstruct the stable biometric key `R`
from a fresh face scan. Not a biometric template; does not allow face reconstruction.

The `vaultId` inside `.P.json` must match the vault file name.

#### v3/v4 P.json

```json
{
  "vaultId": "<uuid>",
  "syndrome": "<hex — BCH syndrome>",
  "extraBit": 0
}
```

#### v5 P.json (additional genesis fields)

```json
{
  "vaultId":          "<uuid>",
  "syndrome":         "<hex — BCH syndrome for normal unlock key>",
  "extraBit":         0,
  "genesisS":         "<hex — BCH syndrome for deterministic FIXED_W projection>",
  "genesisExtraBit":  0
}
```

`genesisS` + `genesisExtraBit` are used exclusively for `genesis_backup` recovery.
They are derived from the same face scan as `syndrome` but using the fixed all-zeros
projection matrix instead of the randomly seeded one.

---

## Decrypted JSON payload (all versions)

```json
{
  "seed":     "<hex string — 32 bytes = 256-bit BIP39 entropy>",
  "accounts": [],
  "vaultId":  "<UUID v4>",
  "created":  1234567890000
}
```

`seed` is the BIP39 entropy (not the BIP39 seed derived via PBKDF2-HMAC-SHA512).
Maps directly to 24 BIP39 words via `Mnemonic.fromEntropy(seed_hex)` in ethers.js v6.

---

## Key Derivation Chain

```
Face scan (live video)
  │
  ▼ FaceNet 128-dim embedding (Float32Array)
  │
  ▼ BCH(255,55,25) fuzzy extraction  ← syndrome + extraBit from .P.json
  │   corrects up to 25-bit deviation between enrollment and current scan
  │
  R  (Uint8Array, 32 bytes) — stable biometric key
  │
  ├── v3: PBKDF2-SHA256(R ‖ PIN, salt, 300 000) → AES-256-GCM key
  │
  ├── v3 device: HKDF-SHA256(R ‖ device_prf, salt) → AES-256-GCM key
  │
  ├── v4/v5 face: SSS reconstruct(faceShare(y=R), paperShare(y=paper_hex)) → seed
  │              or SSS reconstruct(faceShare, deviceShare) → seed
  │
  └── v5 genesis backup:
        R_genesis = SHA-256(project(embedding, FIXED_W))
        PBKDF2-SHA256(R_genesis, gbSalt, 300 000) → AES-256-GCM key
        AES-GCM decrypt(gbCt, gbIv) → seed JSON

  ▼
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

## Offline Recovery

### Standard path (v3/v4/v5 — face + paper or device)

Requirements:
1. The `.biowallet` file
2. The `.P.json` file
3. A working biometric scan — **must use the same browser + GPU** as enrollment
   due to FaceNet GPU-backend differences
4. A compatible BCH(255,55,25) fuzzy extractor implementation
5. ethers.js v6 (or any BIP39 + secp256k1 library)
6. For v4/v5: paper share (64 hex chars) or enrolled device

Reference implementation: `src/core/` (Non-Commercial license).

### Emergency genesis recovery (v5 only — face alone, no paper share)

Requirements:
1. The `.biowallet` file (must contain `genesis_backup`)
2. The `.P.json` file (must contain `genesisS` + `genesisExtraBit`)
3. A working face scan in the same browser + GPU
4. No paper share or device needed

The `genesis_backup.gbCt` field is decrypted using only the face embedding.
This path is available via the "Visszaállítás arccal" button on the lock screen
(visible for v5 vaults with `genesisS` present in P.json).

---

## Paper Formula (Phase 9 — LIVE)

The 24-word seed phrase never appears in any digital system. Recovery is possible
offline, by hand, on paper.

### Math

Let `i_j` be the BIP39 word index (0–2047) for word j (j = 1..24).

**Encoding:**

```
c_j = (i_j  −  r_j  −  hash(P)[j])  mod 2048
```

- `r_j` = secure-random offset for word j (Paper B, kept by user)
- `P`   = personal episodic number (memorized; never stored)
- `hash(P)` = SHA-256(P) used as 24 integer offsets mod 2048
- `c_j` = obfuscated word code (Paper A, kept by user)

**Recovery:**

```
i_j = (c_j  +  r_j  +  hash(P)[j])  mod 2048
```

Look up `i_j` in the public BIP39 word list → 24-word phrase → import.

| Property | Value |
|---|---|
| 24 words visible in software | Never |
| Paper A alone sufficient | No (needs B + P) |
| Paper B alone sufficient | No (needs A + P) |
| P alone sufficient | No (needs A + B) |
| Works after service shutdown | Yes (A + B + P + BIP39 word list) |

---

## Versioning

| Version | Changes |
|---|---|
| 1.0 | Binary format (PBKDF2 + AES-256-GCM, single biometric factor) — legacy, not produced |
| 3.0 | JSON format; cross-device PIN path (`PBKDF2(face_R ‖ PIN)`); WebAuthn PRF device factor |
| 4.0 | Shamir 2-of-3 SSS over GF(2⁸); paper share (x=3) never stored digitally |
| 5.0 | Genesis DNA anchor (`genesis.dna`), re-enrollment chain (`dna_chain`), face-only emergency recovery (`genesis_backup`); P.json adds `genesisS` + `genesisExtraBit` |
