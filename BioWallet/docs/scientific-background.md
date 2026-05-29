# BioWallet — Scientific Background

> **Hungarian version:** [scientific-background.hu.md](scientific-background.hu.md)

BioWallet combines several cryptographic and formal-verification techniques to achieve a wallet that has no stored password and no stored private key. This document explains the underlying science without disclosing implementation internals.

---

## 1. Biometric key derivation — BCH fuzzy extractor

### Problem

A face scan produces a `Float32Array[128]` embedding vector (FaceNet / face-api.js). Two scans of the same face produce *slightly different* vectors — lighting, angle, and camera noise all introduce variation. A symmetric key derivation function requires *identical* input. A raw face embedding cannot be used directly as key material.

### Solution: BCH error-correcting fuzzy extractor

BioWallet quantises the 128-dimensional embedding to a compact binary string and applies a **BCH error-correcting code** to bridge the gap between enrollment and authentication scans.

| Parameter | Value | Meaning |
|-----------|-------|---------|
| Code length | n = 63 | 63-bit codeword |
| Message length | k = 51 | 51 bits of biometric entropy |
| Error correction | t = 6 | Tolerates up to 6 bit-flips between scans |
| Min. Hamming distance | d = 13 | Two different faces must differ by ≥ 13 bits |

**Enrollment:** the quantised codeword `b` is BCH-encoded to produce a syndrome `s`. The syndrome is stored in the `.P.json` helper file.

**Authentication:** the live embedding is quantised to `b'`; BCH decoding with the stored syndrome corrects up to `t` bit errors and recovers the original `b`. HKDF then derives a deterministic 256-bit secret `face_R` from `b`.

**Security property:** the `.P.json` file contains the syndrome `s` and a seed `W_seed`. These are BCH helper data — analogous to a password salt. They enable re-derivation of `face_R` only when a biometrically matching face is presented; they do not expose `face_R` on their own.

---

## 2. Vault encryption — wrapped-key architecture

### Key separation

BioWallet never derives the vault key directly from the biometric. Instead:

1. A **random 32-byte vault key** is generated at enrollment and never stored.
2. The vault key is **AES-GCM wrapped** by one or two derived keys:
   - **faceWrap key** (always present): `PBKDF2-SHA-256(face_R ‖ PIN_bytes, salt, 300 000 iterations)`
   - **deviceWrap key** (optional): `HKDF-SHA-256(face_R ‖ device_prf, salt, info="biowallet-device-v2")`

This separation means the device factor can be added or revoked without re-enrolling biometrics.

### Why PBKDF2 with 300 000 iterations?

The 300 000-iteration PBKDF2 stretch makes offline brute-force of a stolen `.biowallet` file computationally expensive even if an attacker has both the file and the `.P.json` helper data. The PIN concatenated to `face_R` before PBKDF2 adds an independent second factor: a wrong PIN changes every output bit of the derived key, so biometric mismatch and PIN mismatch are indistinguishable to an attacker.

### AES-256-GCM authentication

AES-GCM provides both confidentiality and authenticity. A wrong face, wrong PIN, or wrong device PRF produces a wrong derived key; the GCM authentication tag fails *before* any plaintext is exposed. There is no separate "wrong password" check — the GCM tag failure is the only signal.

All cryptographic operations use `crypto.subtle` — the browser's native Web Cryptography API. No custom AES implementation.

---

## 3. WebAuthn PRF — device second factor

When a platform authenticator (fingerprint sensor, Windows Hello, Touch ID) is enrolled, BioWallet uses the **WebAuthn PRF extension** to obtain a 32-byte authenticator-bound deterministic secret `device_prf`. This secret is:

- **Bound to the specific credential ID** — cannot be reproduced on a different authenticator
- **Combined with `face_R`** before HKDF: `HKDF(face_R ‖ device_prf, salt, info="biowallet-device-v2")` → device vault key
- **Not sufficient alone**: the face scan is still required because `face_R` is part of the HKDF input

On a device with a registered authenticator, the vault opens with face scan + platform biometrics only, without a PIN. On any other device, face scan + PIN is required.

---

## 4. DCC Causal Chain — token protocol

The **Digital Causal Closure (DCC)** protocol enforces that every vault operation is causally linked to a fresh biometric event. The invariants are:

| Property | Description |
|----------|-------------|
| P1 — Issued-after-scan | A DCC token exists only if a biometric scan just completed |
| P2 — Single-use | A token is consumed after one signing operation |
| P3 — Time-bounded | Token expires 30 s after issuance |
| P4 — Vault-bound | Token is tied to a specific vault ID |
| P5 — No re-issue without re-scan | A locked vault cannot reuse a previous token |

Token lifecycle: `BIO_CAPTURE → OPEN (check token_fresh) → SIGN (consume token) → LOCK (private key = null)`

The DCC specification is expressed in the `.bio` domain-specific language (Turing-incomplete by design), which guarantees that the state machine terminates and is fully enumerable by a formal verifier.

---

## 5. Formal verification

BioWallet's DCC invariants and the broader BioOS Causal Constitution are formally verified using the **Z3 SMT solver**. The `.bio` DSL is deliberately Turing-incomplete — it cannot express infinite loops — which makes the complete state space finitely enumerable and mechanically provable.

The formal model, proofs, and the kernel-level instantiation of the causal chain principle are described in the following academic reference:

---

### Reference

**Szőke, L.-F.** (2026). *BioOS Causal Constitution: A Turing-Incomplete Kernel Safety Layer for Digital Causal Closure.* Working Paper v0.2.  
DOI: [10.5281/zenodo.20384701](https://doi.org/10.5281/zenodo.20384701)  
MetaSpace.bio Logic Engine · [metaspace.bio](https://metaspace.bio)

---

## 6. HD wallet — BIP39 + BIP44

The seed phrase and Ethereum key derivation follow established open standards:

```
Entropy (128–256 bit)
  → BIP39 mnemonic (12–24 words)
  → PBKDF2-HMAC-SHA-512 (2048 rounds) → 512-bit seed
  → BIP32 master key
  → m/44'/60'/0'/0/0 → Ethereum private key (secp256k1)
  → keccak256(public_key[1:])[-20:] → Ethereum address
```

The same derivation path produces identical addresses on all EVM-compatible chains (Ethereum, Polygon, BNB Chain, Arbitrum, etc.).

All BIP32/BIP39/BIP44 operations run inside a dedicated **Web Worker** (`vault_worker.js`) that is isolated from the main browser thread. The private key is held in Worker memory only during the 30-second DCC window and is explicitly zeroed on lock.

---

## 7. Further reading

| Topic | Source |
|-------|--------|
| BIP39 mnemonic wordlist | [github.com/bitcoin/bips/blob/master/bip-0039](https://github.com/bitcoin/bips/blob/master/bip-0039.mediawiki) |
| BIP44 derivation paths | [github.com/bitcoin/bips/blob/master/bip-0044](https://github.com/bitcoin/bips/blob/master/bip-0044.mediawiki) |
| face-api.js (FaceNet) | [github.com/justadudewhohacks/face-api.js](https://github.com/justadudewhohacks/face-api.js) |
| WebAuthn PRF extension | [w3c.github.io/webauthn/#prf-extension](https://w3c.github.io/webauthn/#prf-extension) |
| Web Cryptography API | [w3.org/TR/WebCryptoAPI](https://www.w3.org/TR/WebCryptoAPI/) |
| BioOS Causal Constitution (formal paper) | [doi.org/10.5281/zenodo.20384701](https://doi.org/10.5281/zenodo.20384701) |
