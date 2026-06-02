# Security policy

## Supported versions

| Version | Status |
|---|---|
| v35.1 (current, `main` branch) | ✅ Actively maintained |
| v35.0 | ✅ Security fixes backported if critical |
| v34 and below | ❌ No security fixes |

---

## Threat model

BioWallet is designed for a specific set of threats. Understanding what it protects against — and what it does not — is essential for evaluating whether it fits your use case.

> **Full threat model:** see [THREAT_MODEL.md](THREAT_MODEL.md) for the complete asset inventory, attacker capability matrix, trust boundaries, and risk matrix.

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
If the browser process itself is controlled by an attacker, Worker isolation provides no protection. Use a dedicated browser profile for high-value wallets. See *Hardened Deployment* below for a kernel-level mitigation.

**Presentation attacks (photo or mask spoofing) — known limitation**
BioWallet uses FaceNet embeddings derived from 2D webcam frames. **There is no liveness detection.** A high-quality photograph or 3D face mask of the enrolled user could potentially bypass face authentication.

*Mitigations available to users:*
- **SSS 2-of-3 (strongly recommended):** enroll the WebAuthn device factor (hardware authenticator as the second SSS share). A photo gives an attacker the face share (x=1) only — without the device factor or paper share, the 2-of-3 threshold is not met and the vault cannot be opened.
- For the highest-value holdings, combine with a hardware wallet (Ledger, Trezor) for transaction signing.

*Roadmap:* liveness/PAD (presentation-attack detection) integration is on the roadmap as a future optional security layer.

**Loss of the `.biowallet` file AND the paper recovery formula**
Without both the encrypted vault file and a valid recovery formula, the funds are unrecoverable. BioWallet cannot help you. Store both independently.

**Key derivation from a different browser**
FaceNet embedding values vary between browser engines (Chrome vs. Firefox) and between GPU/CPU inference. An enrolled face on Chrome may not open a vault on Firefox. Always use the same browser for enrollment and access.

**Large holdings without additional security**
BioWallet is appropriate for daily spending amounts. For significant holdings, consider a hardware wallet (Ledger, Trezor) or enroll the WebAuthn device factor — BioWallet's built-in SSS(2,3) protection (live since v29) makes any single stolen factor insufficient to open the vault.

---

## Security architecture summary

```
Enrollment (native):
  face_video   →  FaceNet  →  embedding (Float32[128])
  embedding    →  BCH fuzzy extractor  →  face_R
  face_R       →  SSS(2,3): faceShare(x=1) + [deviceShare] + paperShare(x=3)
  vault_key    →  AES-256-GCM encrypt (seed)  →  vault JSON
  vault JSON   →  genesis.dna + dna_chain + genesis_hmac (HMAC-SHA256)

Import (seed phrase):
  mnemonic(12–24 words)  →  Mnemonic.fromEntropy().computeSeed()
  →  HDNodeWallet.fromSeed()  →  m/44'/60'/0'/0/0  →  private key
  (keyType: 'bip39' stored in vault — identical derivation to MetaMask)

Import (private key):
  raw 32-byte private key  →  stored as vault seed (keyType: 'privkey')
  →  ethers.Wallet(privkey)  →  address + signing

Authentication:
  face_video  →  FaceNet  →  embedding'
  embedding'  →  BCH correct + verify (Hamming ≤ t=6)  →  face_R
  face_R      →  unwrap faceShare  →  vault_key
  vault_key   →  verify genesis_hmac  →  AES-256-GCM decrypt  →  seed
  seed        →  private key (used once, then zeroed)
```

---

## Responsible disclosure

If you discover a security vulnerability in BioWallet, please **do not open a public GitHub issue**.

### Preferred: GitHub Private Vulnerability Reporting

Use GitHub's built-in private reporting — no email needed, end-to-end encrypted:

**[Report a vulnerability →](https://github.com/LemonScripter/biowallet/security/advisories/new)**

### Alternative: email

**Email:** admin@metaspace.bio  
**Subject:** `[BioWallet Security]`  
**PGP:** not required, but appreciated for critical findings

### What to include

- Description of the vulnerability and affected component
- Steps to reproduce (PoC preferred)
- Potential impact and severity assessment (CVSS estimate if possible)
- Your suggested fix (optional but appreciated)

### Response timeline

| Action | Target |
|--------|--------|
| Acknowledgement | 48 hours |
| Initial triage | 5 business days |
| Fix for critical vulnerabilities | 14 days |
| Fix for high/medium vulnerabilities | 30 days |
| Public disclosure (coordinated) | After fix is deployed |

### Recognition

We do not operate a paid bug bounty program. Researchers who responsibly disclose valid vulnerabilities will receive:

- **Public credit** in the release notes and SECURITY.md (name/handle, with your permission)
- **GitHub Security Advisory** co-authorship credit
- A **Hall of Fame** entry at [biowallet.metaspace.bio](https://biowallet.metaspace.bio) (coming soon)

Findings that are part of the known limitations listed above (e.g. liveness detection, OS-level compromise) are **out of scope** for recognition, but we welcome constructive discussion.

---

## Hardened Deployment: BioWallet + BioOS (experimental)

BioWallet's cryptographic guarantees operate at the browser layer. A fully
compromised OS or browser process can, in principle, bypass Worker isolation.

The **DCC Ring 0** project addresses this attack surface at the Linux kernel
layer using eBPF LSM hooks:

| BPF Program | Hook | Effect |
|---|---|---|
| `dcc_causality_monitor` | `raw_tp/input_event` | Only hardware IRQ events generate causal tokens |
| `dcc_axiom_validator` | `lsm/file_permission` | File writes blocked without a valid causal token |
| `dcc_read_guard` | `lsm/file_open` | File reads blocked for non-whitelisted processes |
| `dcc_network_guard` | `lsm/socket_connect` | Network blocked for non-whitelisted processes |
| `dcc_exec_guard` | `lsm/bprm_check_security` | Exec blocked for non-whitelisted processes |
| `dcc_fork_inherit` | `raw_tp/sched_process_fork` | Token inheritance enforced at fork |

`token_map` is frozen at load time (`bpf_map_freeze`) — fake token injection via
`bpftool` returns `EPERM`.

When BioWallet runs on a BioOS-protected host with DCC Ring 0 active, the causal
chain is enforced at kernel level: a process cannot read, write, or execute without
a hardware-rooted causal token derived from a physical hardware event. This closes
the "fully compromised browser" attack vector described above.

**Current status: experimental — do not rely on this for production deployments yet.**
Known open issues:

- Comm-based whitelist is spoofable via `prctl(PR_SET_NAME)` — inode-based fix planned
- BPF programs are not yet formally verified with Z3
- BioWallet ↔ DCC Ring 0 joint integration not yet end-to-end tested
- No external security audit of the kernel-level components

A fully validated BioWallet + BioOS joint deployment remains experimental — see known open issues above.

---

## Audit status

| Component | Formal verification | Manual audit | Penetration test |
|---|---|---|---|
| DCC protocol | ✅ 7 Z3 properties, 56/56 PASS total | ✅ Internal | — |
| BCH fuzzy extractor | ✅ 4 Z3 properties | ✅ Internal | — |
| GF(2⁸) SSS arithmetic | ✅ 13/13 PASS, 196 608 cases | ✅ Internal | — |
| Vault encryption (AES-256-GCM) | Standard algorithm | ✅ Internal | — |
| Genesis HMAC (v35+) | HMAC-SHA256 via WebCrypto HKDF | ✅ Internal | — |
| BIP39/BIP44 key derivation | Standard — matches MetaMask derivation | ✅ Internal | — |
| Worker isolation | CSP `worker-src 'self'` | ✅ Internal | — |
| XSS / HTML injection (v35.1+) | — | ✅ `h()` escape on all external data | — |
| WalletConnect v2 | — | ✅ Internal | — |
| Paraswap swap integration | — | ✅ Internal | — |
| Liveness / PAD | ❌ Not implemented | ⚠️ Known limitation — SSS mitigates | — |
| External audit | ❌ Not yet performed | | |

We invite independent security researchers to audit the codebase and the formal verification tests.
