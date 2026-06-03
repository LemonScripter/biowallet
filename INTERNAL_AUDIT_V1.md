# BioWallet — Internal Security Audit v1.1

**Version:** 1.1  
**Date:** 2026-06-03  
**Codebase:** v35.1 (final commit of this audit cycle, SW v68)  
**Scope:** 15 critical flows, static code analysis  
**Method:** Manual source review — app.js, vault.js, vault_worker.js, causal_chain.js, recovery_formula.js  
**Status:** All findings resolved

---

## Summary

| Flow | Correctness | Freeze-free | Security | Verdict |
|------|-------------|-------------|----------|---------|
| F01 — Native wallet creation | ✅ | ✅ | ✅ | **PASS** |
| F02 — BIP39 seed import (12/24 words) | ✅ | ✅ | ✅ | **PASS** |
| F03 — Private key import | ✅ | ✅ | ✅ | **PASS** |
| F04 — Vault open (face scan) | ✅ | ✅ | ✅ | **PASS** *(WARN-01 resolved)* |
| F05 — ETH transaction signing | ✅ | ✅ | ✅ | **PASS** |
| F06 — Paper recovery formula | ✅ | ✅ | ✅ | **PASS** |
| F07 — Face re-enrollment (v5) | ✅ | ✅ | ✅ | **PASS** |
| F08 — SSS paper recovery | ✅ | ✅ | ✅ | **PASS** *(WARN-02 resolved)* |
| F09 — Genesis emergency recovery | ✅ | ✅ | ✅ | **PASS** |
| F10 — Device enrollment (WebAuthn PRF) | ✅ | ✅ | ✅ | **PASS** |
| F11 — WalletConnect pairing + TX | ✅ | ✅ | ✅ | **PASS** |
| F12 — Paraswap swap | ✅ | ✅ | ✅ | **PASS** *(WARN-03 resolved)* |
| F13 — Lock / auto-lock (P7) | ✅ | ✅ | ✅ | **PASS** |
| F14 — Vault file restore | ✅ | ✅ | ✅ | **PASS** *(WARN-04 resolved)* |
| F15 — PWA update (SW) | ✅ | ✅ | ✅ | **PASS** |

**Final result: 15 PASS / 0 WARN / 0 FAIL** *(after fixes in SW v68)*

---

## Findings — Detail

### ~~WARN-01~~ → FIXED · F04 — SSS device+paper fallback too permissive (v4 / legacy v5)

**Severity:** Medium  
**Affected code:** `vault.js:443–507`, `app.js:1270–1278`

**Description:**  
In old-style v4 / legacy v5 vaults (where the SSS device share lives in `sss.deviceShare`, not `deviceWrap`), the device+paper combination opens the vault without a face scan. The new v5 structure (`deviceWrap`) handles this correctly with mandatory re-enrollment, but the legacy path had no equivalent warning.

**Existing mitigation:**  
`app.js:1270–1272`: `!usedFace && isV5` → `_mandatoryReenroll()` forced. This covers v5.

**Fix applied:**  
Added `!usedFace && isV4` branch: shows `msg.vault.v4.no.face.warn` UI warning after vault opens, prompting user to update their face profile.

**Status:** ✅ FIXED — `app.js` (SW v68)

---

### ~~WARN-02~~ → FIXED · F08 — Paper share input has no checksum

**Severity:** Medium  
**Affected code:** `app.js:1252–1255`, `vault.js:380–391`

**Description:**  
The paper share hex input was format-validated (length + hex chars) but had no error-detection code. A single typo would cause SSS combine() to reconstruct the wrong vault key, leading to AES-GCM decrypt failure. This is not a cryptographic vulnerability (the ciphertext integrity protects against it), but the resulting `BIO_MISMATCH` error was misleading — it looked like a face recognition failure rather than a key input error.

**Existing mitigation:**  
AES-GCM authentication tag — wrong share → decrypt fail → locked. No data leakage.

**Fix applied:**  
- `_crc8()` — CRC-8/SMBUS (poly=0x07) helper
- `_paperHexWithCrc(shareBytes)` — appends 2-hex-char CRC to all generated paper codes (64→66 chars)
- Input validation: 66-char input → CRC verified before use; 64-char legacy input → accepted silently (backward compatible)
- `err.paper.crc` i18n key added (EN + HU)

**Status:** ✅ FIXED — `app.js` (SW v68)

---

### ~~WARN-03~~ → FIXED · F12 — Vault re-open in swap does not reset scanning state on exception

**Severity:** Medium  
**Affected code:** `app.js:3130–3151` — `_reopenVaultForSwap()`

**Description:**  
During a Paraswap swap, after P7 auto-lock closes the vault following the first signing operation, the swap flow calls `_reopenVaultForSwap()` to re-open the vault for the next signing step. If this function threw (camera error, BIO_CAPTURE failure, OPEN failure), `setScanning(false)` was never called → the scanning indicator would spin indefinitely → UI freeze.

**Reproduction:**  
1. Start swap → sign first TX → vault auto-locks  
2. Camera error during re-open (e.g. tab blur) → exception  
3. Scanning UI stuck

**Fix applied:**  
Wrapped the async body in `try { ... } finally { setScanning(false); }`.

**Status:** ✅ FIXED — `app.js` (SW v68)

---

### ~~WARN-04~~ → FIXED · F14 — No pre-open warning for legacy vault format

**Severity:** Low  
**Affected code:** `app.js:2105–2124` — `_applyVaultJson()`

**Description:**  
Loaded `.biowallet` files undergo a minimal structural check (JSON parse, required fields) but no format-level user notification. v5 vaults have a genesis HMAC verified on every open; older vaults do not. Loading an older vault gave no indication to the user that it had weaker tamper protection, and the face re-enrollment button was hidden from them.

**Existing mitigation:**  
v5 genesis HMAC verification in `vault.js:406–412` covers the current vault format. Older vaults are a legacy concern.

**Fix applied:**  
`_applyVaultJson()`: when vault version is older than v5, shows `msg.vault.v4.legacy.warn` with a suggestion to use the Update Face Profile button (800 ms delay to avoid collision with other messages).

**Status:** ✅ FIXED — `app.js` (SW v68)

---

## Confirmed Security Properties

| Property | Evidence |
|----------|----------|
| Private key never leaves the Worker | `vault_worker.js` — only `{ signed, from }` returned to main thread |
| DCC gate on every sensitive operation | `causal_chain.js:gate()` called in OPEN, SIGN, EXPORT |
| AES-GCM nonce never reused | `vault.js:aesEncrypt()` — `crypto.getRandomValues(12)` per call |
| Seed/key zeroed after use | `seed.fill(0)`, `#vaultKeyRaw.fill(0)`, `#faceR.fill(0)` throughout `vault.js` |
| TX hash binding | `commitTx()` → fingerprint → user confirms first 4 chars → `BIO_CAPTURE` userInput |
| Worker isolation | `worker-src 'self'` CSP; same-origin Worker constructor |
| XSS prevention | `h()` + `safeImgSrc()` on all WalletConnect-sourced strings |
| Paper formula obfuscation | rawA = (indices − r) mod 2048; seed never shown in plain text |
| Worker crash protection | `onerror`/`onmessageerror` reject all pending promises |
| Worker hang protection | `callWorker` 30 s timeout |

---

## Audit Version History

| Version | Date | Codebase | Changes |
|---------|------|----------|---------|
| 1.0 | 2026-06-03 | v35.1 `40efe07` | Initial audit — 15 flows, static analysis: 11 PASS / 4 WARN |
| 1.1 | 2026-06-03 | v35.1 SW v68 | All 4 WARNs resolved → **15 PASS / 0 WARN** |

---

*This document represents an internal development-stage audit. It does not substitute an independent third-party security review.*  
*Next audit: before v36.0 release, or when the open finding count rises above 0.*
