# Threat Model — BioWallet

**Version:** v35.4a · **Date:** 2026-06-04 · **Scope:** browser PWA + Tokyo GCP deployment

---

## 1. Assets

| Asset | Location | Minimum lifetime | Primary protection |
|-------|----------|------------------|--------------------|
| Private key | Worker memory (`signEthTx`) | < 10 s, zeroed via `seed.fill(0)` | DCC auto-lock + Worker isolation |
| Vault seed (32 B) | AES-256-GCM ciphertext, `.biowallet` file | Decrypted → immediately zeroed | BCH fuzzy extractor + AES-256-GCM |
| Biometric embedding | Float32[128], Worker postMessage only | Never stored | Not persisted in DOM or localStorage |
| Face fuzzy secret (R) | Worker, PBKDF2 input | < 30 s (DCC TTL) | BCH error correction + HKDF |
| SSS paper share (x=3) | Physical paper | User's responsibility | SSS 2-of-3: insufficient alone |
| WebAuthn PRF key | Platform authenticator | Never exportable | Hardware enclave |
| Genesis HMAC | `.biowallet` outer JSON | Verified on every open | HMAC-SHA256(HKDF(vault\_key)) |
| Recovery formula (rawA, r) | Paper only, without P value | Locked after display | Obfuscated: c\_j = (i\_j − r\_j) mod 2048 |

---

## 2. Trust Boundaries

```
┌─────────────────────────────────────────────────────────┐
│  Browser main thread  (UNTRUSTED — dApp has access)     │
│  ┌───────────────────────────────────────────────────┐  │
│  │  vault_worker.js  (TRUSTED — same-origin Worker)  │  │
│  │  • Private key never crosses this boundary        │  │
│  │  • DCC causal chain enforced here                 │  │
│  └───────────────────────────────────────────────────┘  │
│  localStorage: encrypted vault JSON + P file (public)   │
└─────────────────────────────────────────────────────────┘
         │ HTTPS + CSP (script-src 'self')
┌────────▼──────────────┐    ┌──────────────────────┐
│  Tokyo GCP / nginx    │    │  WalletConnect Relay  │
│  (static files only)  │    │  (relay only — never  │
│  SRI-hashed bundles   │    │  sees unsigned data)  │
└───────────────────────┘    └──────────────────────┘
```

---

## 3. Attacker Models

| # | Attacker | Capabilities | Target asset | Outcome | Mitigation |
|---|----------|-------------|--------------|---------|------------|
| T1 | Remote attacker | Network access, steals `.biowallet` file | Vault seed | Brute-force infeasible: AES-256-GCM + PBKDF2(300k) | ✅ |
| T2 | Local malware | Reads filesystem and memory | Private key in memory | Exists only in a < 10 s window, Worker-isolated | ⚠️ Partial — OS-level compromise is out of scope |
| T3 | Compromised browser extension | DOM manipulation, fetch intercept | TX data modification | CSP `script-src 'self'` blocks; Worker unreachable from extensions | ✅ |
| T4 | Malicious dApp (WalletConnect) | JSON-RPC requests, metadata injection | Approval abuse, XSS | DCC: every tx requires fresh biometric; `h()` escape on all metadata | ✅ |
| T5 | Stolen device | Physical access, browser session | Vault file + P file | Vault AES-GCM encrypted; not openable without enrolled face | ✅ |
| T6 | Shoulder-surfing | Sees the screen | Seed phrase / recovery formula | Paper formula obfuscated (meaningless without r\_j) | ✅ |
| T7 | Camera spoofing (photo/mask) | 2D photo or 3D face mask | Biometric authentication | ✅ Head-turn liveness challenge (v35.4) — static photo cannot turn head; 3D mask/video replay partially mitigated by SSS 2-of-3 | ✅ Photo blocked; ⚠️ targeted video/mask residual risk |
| T8 | RPC endpoint MITM / compromised node | Modified responses | TX fee, balance | DCC commit + fingerprint; HTTPS; 12 s AbortController timeout (v35.4a); chainId verification on custom networks (v35.4a); Ethereum fallback RPC | ⚠️ No certificate pinning |
| T9 | Supply chain (npm, CDN) | Modified bundle | Everything | No CDN; SRI hash verification; local bundle | ✅ |
| T10 | Brute-force / rainbow table | Offline vault file | Vault key | BCH fuzzy R not reproducible without the enrolled face; 300k PBKDF2 | ✅ |

---

## 4. Out of Scope

| Not protected | Rationale |
|---------------|-----------|
| OS-level compromise via local access | Worker isolation is browser-level only. Note: the canonical deployment at `biowallet.metaspace.bio` runs DCC Ring 0 (eBPF LSM) + `chattr +i` kernel immutable protection — a server-side RCE cannot silently replace the served JavaScript. A local OS compromise on the *user's* device remains out of scope. |
| Jailbroken / rooted device | Trusted Execution Environment assumption violated |
| Physically compromised hardware | TPM / Secure Enclave bypass is out of scope |
| Key voluntarily disclosed by user | Social engineering is not a cryptographic problem |
| Ethereum network / smart contract security | Blockchain layer is not BioWallet's responsibility |
| Browser engine 0-day exploit | Browser vendor's responsibility |

---

## 5. Security Assumptions

1. The browser correctly enforces Worker isolation and CSP.
2. The FaceNet embedding step before BCH provides sufficient entropy — biometric distance is stable on the same device and browser.
3. AES-256-GCM and the WebCrypto API implementation are correct (platform-provided).
4. The user stores the `.biowallet` file and the paper share **physically separated**.
5. The user opens the vault in the same browser used for enrollment (cross-browser embedding variance is not tolerated).

---

## 6. Risk Matrix

| Risk | Likelihood | Impact | Combined | Mitigation status |
|------|-----------|--------|----------|-------------------|
| Photo-based bypass (T7) | Low (liveness blocks static photos) | High | **Medium** | ✅ Head-turn challenge implemented (v35.4); SSS 2-of-3 as second layer |
| Compromised browser extension (T3) | Low (CSP blocks) | High | Medium | ✅ CSP + Worker isolation |
| Stolen `.biowallet` file (T1) | Medium | Low (brute-force infeasible) | Low | ✅ AES-256-GCM |
| RPC MITM (T8) | Low | Medium | Low | ⚠️ HTTPS only; no pinning. Mitigated by timeout (12 s), chainId verify, fallback RPC (v35.4a) |
| Supply chain attack (T9) | Very low | Critical | Medium | ✅ SRI + local bundle |
