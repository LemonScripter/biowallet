# Architecture

## Overview

BioWallet is a single-origin, static web application. There is no BioWallet server that participates in key management. The complete key lifecycle — derivation, decryption, signing, erasure — takes place inside a Web Worker thread in the user's browser.

---

## Layer model

```
┌─────────────────────────────────────────────────────────────┐
│  Layer 4 — UI (index.html + app.js)                         │
│  Handles: panels, modals, camera, balance display           │
│  Security boundary: never receives the private key          │
├─────────────────────────────────────────────────────────────┤
│  Layer 3 — RPC (rpc.js)                                     │
│  Handles: JSON-RPC 2.0, EIP-1559 fees, Blockscout history   │
│  Data: signed transaction bytes only (key already gone)     │
├─────────────────────────────────────────────────────────────┤
│  Layer 2 — Worker (vault_worker.js)  ◄── TRUST BOUNDARY     │
│  Handles: biometric verification, key derivation,           │
│           AES-GCM decrypt, HD derivation, signing, erasure  │
│  DCC protocol enforced here                                 │
├─────────────────────────────────────────────────────────────┤
│  Layer 1 — Vault storage (localStorage + .biowallet file)   │
│  Handles: encrypted vault persistence, P metadata           │
│  Data: AES-256-GCM ciphertext only                          │
└─────────────────────────────────────────────────────────────┘
```

---

## Vault format

The `.biowallet` file holds the encrypted seed. Three formats are in use; the parser auto-detects by checking whether the first byte is `{` (0x7b = JSON) or not (legacy binary).

### v1 — legacy binary

```
.biowallet = salt (32 B) || IV (12 B) || AES-256-GCM( vault_key, plaintext )

vault_key = PBKDF2-SHA-256( ikm=face_R, salt, iterations=300 000 )
```

Still opened transparently. Upgraded to v2 on device enrollment.

### v2 — JSON wrapped key (introduced v25)

```json
{
  "v": 2,
  "vaultId": "<uuid>",
  "salt":  "<hex 32 B>",
  "iv":    "<hex 12 B>",
  "ct":    "<hex ciphertext>",
  "faceWrap":   { "wIv": "<hex 12 B>", "wCt": "<hex 48 B>" },
  "deviceWrap": { "wIv": "<hex>", "wCt": "<hex>",
                  "credentialId": "<hex>", "prfSalt": "<hex>" }
}
```

`vault_key` is a random 32-byte secret generated at enrollment. It is never stored directly — only AES-GCM wrapped by one of two derived keys:

```
faceWrap_key   = PBKDF2-SHA-256( ikm=face_R,               salt, 300 000 )
deviceWrap_key = HKDF-SHA-256  ( ikm=face_R ‖ device_prf,  salt, info="biowallet-device-v2" )
```

`deviceWrap` is optional. If present, the vault can be opened via the device path without a PIN.

### v3 — PIN mandatory (introduced v26, default for all new wallets)

Identical JSON structure to v2 (`"v": 3`). The sole difference is in `faceWrap_key`:

```
faceWrap_key = PBKDF2-SHA-256( ikm=face_R ‖ PIN_bytes, salt, 300 000 )
```

The PIN is concatenated with `face_R` before key derivation. A wrong PIN produces a different AES key; the GCM tag fails identically to a wrong face scan. There is no separate PIN check and no PIN stored anywhere.

### Plaintext structure (all versions)

```json
{ "seed": "<hex 32 B>", "accounts": [], "vaultId": "<uuid>", "created": <ms> }
```

The `P` file (`.P.json`) contains only the BCH helper values (`W_seed`, `syndrome`) — never the vault key, PIN, or seed.

---

## DCC state machine

Digital Causal Closure (DCC) enforces that the private key can only exist in a narrow, predictable operational window.

```
        ┌─────────────────────────────────────────────┐
        │              LOCKED state                   │
        │  private_key = null                         │
        └──────────────────┬──────────────────────────┘
                           │ BIO_CAPTURE + OPEN
                           │ (fresh token issued, TTL=30s)
                           ▼
        ┌─────────────────────────────────────────────┐
        │               OPEN state                    │
        │  private_key ∈ Worker memory                │
        │  token: {issued_at, consumed: false}        │
        └──┬──────────────────────────────────────────┘
           │ SIGN / PERSONAL_SIGN / RECOVERY_FORMULA
           │ (token consumed immediately)
           ▼
        ┌─────────────────────────────────────────────┐
        │             SIGNING state                   │
        │  private_key ∈ Worker memory                │
        │  token: {consumed: true}                    │
        └──┬──────────────────────────────────────────┘
           │ operation complete → LOCK
           ▼
        (back to LOCKED — private_key zeroed)
```

Z3-verified invariants (see `tests/verify_biowallet.py`):
- A token cannot be used twice within a single session
- `OPEN` state requires a token issued within the last 30 seconds
- After `SIGN`, the next state is always `LOCKED`
- `BIO_MISMATCH` leaves the vault in `LOCKED` state

---

## Worker message protocol

```
Main thread  →  Worker
{ id, type, payload }

Worker  →  Main thread
{ id, ok: true,  result: {...} }
{ id, ok: false, error: "message" }

Types:
  INIT_VAULT      { vaultId }                                    → void
  ENROLL          { embedding, pin? }                            → { vaultId, P, encryptedVault }
  IMPORT          { mnemonic, embedding, pin? }                  → { vaultId, P, encryptedVault }
  COMMIT_TX       { tx }                                         → { fingerprint }   // 8-char SHA-256 prefix
  CANCEL_TX       {}                                             → void
  BIO_CAPTURE     { embedding, P, userInput? }                   → void  // issues DCC token; checks fingerprint if userInput present
  OPEN            { encryptedVault, P, devicePrf?, pin? }        → { address, hasDevice, usedDevice }
  ENROLL_DEVICE   { devicePrf, credentialId, prfSalt }           → { encryptedVault }
  SIGN            { tx }                                         → { signed, from }
  PERSONAL_SIGN   { message }                                    → { signature }
  RECOVERY_FORMULA {}                                            → { rawA, r }
  LOCK            {}                                             → void
  STATUS          {}                                             → { state }
```

The `embedding` (`Float32Array`) is transferred — not copied — via `postMessage(..., [embedding.buffer])`. After transfer the main thread's buffer is neutered (zero-length), making it impossible to retain the biometric data on the main side.

---

## Multi-network EVM

All EVM-compatible networks share the same BIP44 derivation path (`m/44'/60'/0'/0/0`) and the same key format. Adding a new network requires only a configuration entry — no vault format change, no re-enrollment.

```js
// src/core/rpc.js
export const BUILTIN_NETWORKS = [
  { key: 'mainnet',   chainId: 1,        ... },
  { key: 'bsc',       chainId: 56,       ... },
  { key: 'polygon',   chainId: 137,      ... },
  { key: 'arbitrum',  chainId: 42161,    ... },
  { key: 'base',      chainId: 8453,     ... },
  { key: 'optimism',  chainId: 10,       ... },
  { key: 'avalanche', chainId: 43114,    ... },
  { key: 'sepolia',   chainId: 11155111, testnet: true },
];
```

Custom networks are stored in `localStorage` under `biowallet_custom_networks` and merged at runtime via `getAllNetworks()`.

---

## Content Security Policy

The nginx CSP is configured to enforce:
- `script-src 'self'` — no inline scripts, no external scripts
- `connect-src 'self' <explicit RPC origins> <WalletConnect relay> <Blockscout>` — no unrestricted outbound
- `worker-src 'self'` — Worker can only load from same origin
- `frame-src 'none'` — no iframes
- `form-action 'none'` — no form submissions

This means that even if an attacker could inject HTML into a response, they could not execute scripts, load external resources, or exfiltrate data via form submission.

---

## Service worker and offline support

`sw.js` implements a cache-first strategy for all same-origin GET requests. On install, all application files are fetched with `cache: 'reload'` (bypassing the HTTP cache) to ensure the cached version always matches the latest deployment.

The WalletConnect relay (`wss://relay.walletconnect.com`) and external RPC endpoints are explicitly excluded from the service worker cache and always fetched from the network.
