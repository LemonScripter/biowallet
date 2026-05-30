# Security policy

## Supported versions

| Version | Status |
|---|---|
| v29 (current, `main` branch) | ✅ Actively maintained |
| v28 and below | ❌ No security fixes |

---

## Threat model

BioWallet is designed for a specific set of threats. Understanding what it protects against — and what it does not — is essential for evaluating whether it fits your use case.

### What BioWallet protects against

**Malware on the device (partial)**
The private key exists in memory only inside `vault_worker.js` for the duration of a single operation (< 30 seconds). A memory-scraping attack would need to target the Worker thread at exactly the right moment. The DCC auto-lock ensures the key is not resident across idle periods.

**Stolen `.biowallet` file**
The vault is encrypted with AES-256-GCM using a key derived from the user's face embedding via a BCH(255,55,t=25) fuzzy extractor. An attacker with the file but without the enrolled face cannot decrypt it by brute force.

**Phishing and credential theft**
There are no credentials to steal. No password, no seed phrase stored on the device or transmitted over any network.

**Weak passwords / credential stuffing**
Not applicable — BioWallet has no passwords.

**Replay attacks on biometric data**
The DCC token is single-use and expires after 30 seconds. Replaying a captured embedding does not reopen the vault.

**Unauthorized access from a different browser profile**
The fuzzy extractor tolerates small biometric variations; however, a face scan from a different person (or a significantly different browser's image pipeline) will produce an embedding that is too far from the enrolled one to pass BCH correction.

**CDN supply chain attacks**
All vendor libraries (FaceNet, ethers.js, WalletConnect, QRCode) are bundled at build time and served from the same origin. No runtime CDN fetch occurs. All four vendor files carry SHA-384 SRI integrity attributes — a tampered file is rejected by the browser before execution.

---

### What BioWallet does NOT protect against

**A fully compromised browser**
If the browser process itself is controlled by an attacker, Worker isolation provides no protection. Use a dedicated browser profile for high-value wallets.

**The enrolled face itself being replicated**
BioWallet uses FaceNet embeddings, which are based on 2D video frames from a webcam. A high-quality photograph or a 3D face mask could potentially bypass liveness detection. For high-value holdings, combine BioWallet with a hardware recovery key (Phase 10 roadmap).

**Loss of the `.biowallet` file AND the paper recovery formula**
Without both the encrypted vault file and a valid recovery formula, the funds are unrecoverable. BioWallet cannot help you. Store both independently.

**Key derivation from a different browser**
FaceNet embedding values vary between browser engines (Chrome vs. Firefox) and between GPU/CPU inference. An enrolled face on Chrome may not open a vault on Firefox. Always use the same browser for enrollment and access.

**Large holdings without additional security**
BioWallet is appropriate for daily spending amounts. For significant holdings, consider a hardware wallet (Ledger, Trezor) or wait for Phase 10 SSS(2,3) which adds a hardware key factor.

---

## Security architecture summary

```
Enrollment:
  face_video  →  FaceNet  →  embedding (Float32[128])
  embedding   →  BCH fuzzy extractor  →  vault_key
  vault_key   →  AES-256-GCM encrypt (BIP39 seed)  →  .biowallet

Authentication:
  face_video  →  FaceNet  →  embedding'
  embedding'  →  BCH correct + verify (Hamming ≤ t=6)  →  vault_key
  vault_key   →  AES-256-GCM decrypt  →  BIP39 seed  →  private key
  private key →  (used once, then zeroed)
```

---

## Responsible disclosure

If you discover a security vulnerability in BioWallet, please **do not open a public GitHub issue**.

**Email:** admin@metaspace.bio  
**Subject:** `[BioWallet Security]`

Please include:
- A description of the vulnerability
- Steps to reproduce
- Potential impact assessment
- Your suggested fix (if any)

We will acknowledge your report within 48 hours and aim to release a fix within 14 days for critical vulnerabilities.

We do not currently offer a bug bounty program, but we will publicly credit responsible disclosure in the release notes.

---

## Audit status

| Component | Formal verification | Manual audit | Penetration test |
|---|---|---|---|
| DCC protocol | ✅ 7 Z3 properties, 51/51 PASS | ✅ Internal | — |
| BCH fuzzy extractor | ✅ 4 Z3 properties | ✅ Internal | — |
| GF(2⁸) SSS arithmetic | ✅ 13/13 PASS, 196 608 cases | ✅ Internal | — |
| Vault encryption (AES-256-GCM) | Standard algorithm | ✅ Internal | — |
| Worker isolation | CSP `worker-src 'self'` | ✅ Internal | — |
| WalletConnect v2 | — | ✅ Internal | — |
| External audit | ❌ Not yet performed | | |

We invite independent security researchers to audit the codebase and the formal verification tests.
