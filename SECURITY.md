# Security policy

## Supported versions

| Version | Status |
|---|---|
| v35.4 (current, `main` branch) | ✅ Actively maintained |
| v35.0–v35.3 | ✅ Security fixes backported if critical |
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

**Server-side supply chain attacks**
The canonical deployment at `biowallet.metaspace.bio` operates under two independent kernel-level protections that prevent the served JavaScript from being silently replaced:

1. **`ext4 immutable flag` (`chattr +i`)** — all critical source files carry the Linux immutable attribute. The ext4 kernel driver rejects any write at the VFS layer, regardless of process privileges. A root-level RCE exploit, a compromised web server process, or any automated system process cannot overwrite the served files. Modification requires a legitimate, authenticated SSH session and an explicit `chattr -i` command — the same path used for authorised deployments.

2. **DCC Ring 0 BPF audit** — 8 eBPF LSM programs run continuously in the kernel. Every write attempt against the protected files is intercepted at the `lsm/file_permission` hook, logged with PID and process name, and the `token_map` is frozen at load time (`bpf_map_freeze`) to prevent fake-token injection. This provides a tamper-evident audit trail independent of userspace logging.

Together these layers mean: the JavaScript your browser downloads is cryptographically identical to the code in the audited source tree. An attacker who can serve you modified JavaScript must first obtain authenticated SSH access to the server — the same level of access required for a legitimate deployment.

---

### What BioWallet does NOT protect against

**A fully compromised browser**
If the browser process itself is controlled by an attacker, Worker isolation provides no protection. Use a dedicated browser profile for high-value wallets. See *Hardened Deployment* below for a kernel-level mitigation.

**Presentation attacks (photo or mask spoofing)**
BioWallet v35.4+ includes a **dynamic head-turn liveness challenge** at every vault open, face re-enrollment, and emergency seed recovery. A static photograph cannot pass the challenge because it cannot perform a head turn.

*How it works:* Using `faceLandmark68Net` (already loaded, zero extra dependency), the app measures a baseline nose-position ratio, then detects a ~20° turn in either direction within 8 seconds. The biometric scan (`captureEmbedding`) only runs after the challenge passes and a 2-second stabilisation pause.

*Remaining limitations:*
- A **video replay** that includes a head turn could theoretically defeat the challenge; however, a targeted video of a specific person performing the exact random timing is significantly harder to obtain.
- A **3D mask** with articulated joints could also bypass — this is out of scope for the typical threat model.
- For high-value holdings, **SSS 2-of-3 with a hardware device factor** is still strongly recommended as a second layer.

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

Findings that are part of the known limitations listed above (e.g. OS-level compromise, video-replay liveness bypass) are **out of scope** for recognition, but we welcome constructive discussion.

---

## Server-side hardening: BioWallet + BioOS (production active)

BioWallet's cryptographic guarantees operate at the browser layer. The
*server-side* hardening described here protects the integrity of the code
you download before any cryptographic guarantee can apply.

### Protection stack at `biowallet.metaspace.bio`

**Layer 1 — ext4 immutable (kernel VFS)**

Critical source files carry `chattr +i`. The ext4 driver returns `EPERM` on
any write syscall against these files, at the VFS layer, before any userspace
process can act. This applies unconditionally — regardless of process UID,
capabilities, or whether the process believes it has root.

Protected files: `app.js`, `vault_worker.js`, `sw.js`, `bio_capture.js`,
`causal_chain.js`, `vault.js`, `sss.js`, `fuzzy_extractor.js`, `wallet.js`,
`recovery_formula.js`, `checksums.txt`.

**Layer 2 — DCC Ring 0 BPF (kernel LSM)**

8 eBPF programs run continuously in the kernel via Linux Security Module hooks:

| BPF program | Hook | Function |
|---|---|---|
| `dcc_causality_monitor` | `raw_tp/input_event` | Issues causal tokens on hardware IRQ events |
| `dcc_axiom_validator` | `lsm/file_permission` | Audits every file write; blocks non-token writes in blocking mode |
| `dcc_read_guard` | `lsm/file_open` | Audits file reads for non-whitelisted processes |
| `dcc_network_guard` | `lsm/socket_connect` | Audits outbound connections for non-whitelisted processes |
| `dcc_exec_guard` | `lsm/bprm_check_security` | Audits exec calls for non-whitelisted processes |
| `dcc_fork_inherit` | `raw_tp/sched_process_fork` | Enforces token inheritance at fork |
| `dcc_bpf_prog_guard` | `lsm/bpf_prog` | Prevents loading of additional BPF programs without a valid token |
| `dcc_task_kill_guard` | `lsm/task_kill` | Blocks attempts to kill the DCC loader itself without a valid token |

`token_map` is frozen at load time (`bpf_map_freeze`) — fake token injection
via `bpftool` returns `EPERM`. The loader's own PID is recorded in
`loader_pid_map`; any kill attempt without a valid causal token is rejected.

**What this guarantees**

An attacker who achieves remote code execution on the server — through a web
exploit, a vulnerable dependency, or a compromised process running as root —
cannot modify the served JavaScript files. Both protections must be defeated
independently, and both operate below the userspace boundary.

The only authorised modification path is: authenticated SSH access → explicit
`chattr -i` → file write → `chattr +i` restore. This is the same path used for
every legitimate deployment, and it is logged by the BPF audit layer.

**Known limitations**

- Comm-based process whitelist is spoofable via `prctl(PR_SET_NAME)` if an
  attacker already has code execution — inode-based fix planned (Phase 11)
- BPF programs are not formally Z3-verified (DCC protocol logic is; BPF
  implementation is audited manually)
- No external security audit of the kernel-level components yet

**Deployment mode:** `file_axiom_map` loaded (write-audit active), `config_map
log_only = 1` (audit mode). Blocking mode available via runtime BPF map
update without service restart.

---

## Audit status

| Component | Formal verification | Manual audit | Penetration test |
|---|---|---|---|
| DCC protocol + invariants | ✅ 71/71 Z3 PASS (DCC, BCH, SSS, liveness, TX, session, worker) · [DOI 10.5281/zenodo.20517348](https://doi.org/10.5281/zenodo.20517348) | ✅ Internal | — |
| GF(2⁸) SSS arithmetic | ✅ 13/13 PASS, 196 608 exhaustive cases · [DOI 10.5281/zenodo.20517348](https://doi.org/10.5281/zenodo.20517348) | ✅ Internal | — |
| Vault encryption (AES-256-GCM) | Standard algorithm | ✅ Internal | — |
| Genesis HMAC (v35+) | HMAC-SHA256 via WebCrypto HKDF | ✅ Internal | — |
| BIP39/BIP44 key derivation | Standard — matches MetaMask derivation | ✅ Internal | — |
| Worker isolation | CSP `worker-src 'self'` | ✅ Internal | — |
| XSS / HTML injection (v35.1+) | — | ✅ `h()` escape on all external data | — |
| WalletConnect v2 | — | ✅ Internal | — |
| Paraswap swap integration | — | ✅ Internal | — |
| Liveness / PAD | ✅ LIV1–4 Z3-verified *(v35.4)* — head-turn at OPEN, re-enroll, genesis recovery | ✅ Internal | — |
| Server-side supply chain | ✅ `chattr +i` (ext4 kernel) + DCC Ring 0 BPF audit — active in production | ✅ Internal | — |
| DCC constitution | ✅ SHA-256 anchored on Arbitrum One blockchain · [CONSTITUTION.md](CONSTITUTION.md) | ✅ Internal | — |
| External audit | ❌ Not yet performed | | |

We invite independent security researchers to audit the codebase and the formal verification tests.
