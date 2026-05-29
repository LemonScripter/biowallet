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

## Vault format (p3)

The `.biowallet` file is an AES-256-GCM encrypted blob. Its structure:

```
.biowallet =
  GCM_IV (12 bytes)  ||
  AES-256-GCM( vault_key, plaintext )

plaintext =
  JSON {
    version: "p3",
    vaultId: uuid,
    mnemonic: "<24 BIP39 words>",
    embedding: Float32Array[128]   // enrolled face vector
  }

vault_key =
  HKDF-SHA-256(
    ikm  = BCH_correct(embedding_live, W_seed),
    salt = syndrome,
    info = "biowallet-v3"
  )
```

The `P` file (`.P.json`) contains only the BCH helper values (`W_seed`, `syndrome`) — never the vault key or the mnemonic.

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
  INIT_VAULT   { vaultId }              → void
  ENROLL       { embedding }            → { vaultId, P, encryptedVault }
  IMPORT       { mnemonic, embedding }  → { vaultId, P, encryptedVault }
  BIO_CAPTURE  { embedding, P }         → void (issues DCC token)
  OPEN         { encryptedVault, P }    → { address }
  SIGN         { tx }                   → { signed }
  PERSONAL_SIGN { message }             → { signature }
  RECOVERY_FORMULA {}                   → { rawA, r }
  LOCK         {}                       → void
  STATUS       {}                       → { state, age }
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
