# BioWallet — Security Model

**Author:** Szőke László-Ferenc | MetaSpace.Bio Logic Engine project | admin@metaspace.bio

---

## The core promise

Your private key (seed) never leaves the browser's background Worker thread in plain form. The main page — and any JavaScript running on it — only ever sends instructions to the Worker and receives a signed transaction back. The seed itself is never passed across that boundary.

---

## What protects your wallet

### 1. Biometric encryption at rest

Your seed is encrypted with **AES-256-GCM** and stored locally in the browser. The decryption key is derived from your face scan using a fuzzy extractor and a 300,000-iteration PBKDF2-SHA256 key derivation function. Without your face — captured live, in the right lighting, at the right angle — the vault cannot be opened.

There is no password, no PIN, no recovery phrase stored in the app. The only key is your face plus the helper data (`P` file) stored alongside the vault.

### 2. The DCC Causal Chain

Every sensitive operation is guarded by the **Digital Causal Closure (DCC)** chain. This is a formal security invariant built into the vault layer — not just a UI check, but a hard gate in the cryptographic code.

How it works:

- After a successful face scan, the system issues a **causal token** — a one-time, time-limited proof that a physical biometric event just occurred.
- Every vault operation (open, sign, export) must consume a valid token before it can proceed.
- If the token is missing, expired, or already used, the operation is **hard-rejected** — the vault does not open, the transaction is not signed.

The token has four properties that cannot be bypassed:

| Property | What it means |
|---|---|
| **Must exist (P1)** | No operation without a prior face scan |
| **Must be fresh (P2)** | Open: valid for 30 s · Sign: 10 s · Export: 5 s |
| **Single-use (P3)** | Used once, then destroyed — no replay attacks |
| **Vault-bound (P4)** | A token from one vault cannot open another |

And two behavioural rules:

| Rule | What it means |
|---|---|
| **P5** | Every signing operation requires a new face scan — an open vault is not enough |
| **P7** | The vault auto-locks after every signing — it does not stay open |

**In practice:** Even if an attacker injects code into the page and tries to call `vault.sign()`, they cannot — the DCC gate requires a token, and the token only exists for seconds after a real face capture.

### 3. Worker thread isolation

All cryptographic operations run in a dedicated **Module Worker** (`vault_worker.js`). The main page thread can send messages to the Worker — but it cannot read the Worker's memory. The seed, the decryption key, and all intermediate cryptographic material live and die inside the Worker.

After signing, the seed bytes are explicitly zeroed (`seed.fill(0)`) before the auto-lock.

### 4. No plaintext seed, ever

BioWallet has no "show seed phrase" button. The 24-word mnemonic is never displayed in the UI. It exists in memory only for the instant it is needed to sign a transaction, and nowhere else.

---

## When the system fully protects you

| State | What is happening | Protection level |
|---|---|---|
| **Locked** (default) | Vault encrypted, no token, Worker idle | ✅ Full |
| **Scanning** | Face capture in progress | ✅ Full (key not yet derived) |
| **Open, waiting** | Token valid, vault decrypted in Worker | ✅ Full (seed stays in Worker) |
| **Signing** | Transaction being signed | ✅ Full — auto-lock follows immediately |
| **Brute-force block** | 3 failed scans → escalating cooldown | ✅ Full (lockout enforced) |
| **Export / paper recovery** | rawA + r generated, P never included | ✅ Full — see Recovery section |

---

## When protection is limited or absent

These are not bugs — they are the boundaries of what any browser-based wallet can guarantee. You should understand them.

### ❶ Malicious browser extension

A browser extension has full access to the page's DOM and can intercept keystrokes, read displayed values, and inject JavaScript. If a malicious extension is installed, it could observe your Ethereum address, intercept a signing request, or manipulate the UI.

**What to do:** Only use BioWallet in a browser profile with no extensions, or in a dedicated browser instance.

### ❷ Compromised operating system

If your device's OS is compromised (malware, rootkit), an attacker may be able to take memory snapshots, capture camera frames, or log network traffic. No browser wallet can protect against OS-level compromise.

**What to do:** Keep your OS updated. Do not use BioWallet on a shared or infected machine.

### ❸ Camera spoofing

BioWallet uses a face recognition model to derive the encryption key. It does **not** currently include liveness detection (checking that a real face is present, not a photo). A high-quality photo of your face, held in front of the camera, could theoretically open the vault.

**What to do:** Be aware of who can photograph your face and at what resolution. This risk is similar to a fingerprint wallet — your biometric is not a secret in the way a password is.

### ❹ Physical coercion

If someone forces you to scan your face in front of the camera, the vault will open. No cryptographic system can protect against this.

### ❺ recovery_tool.html used online

The offline recovery tool (`recovery_tool.html`) decodes your paper backup into the 24-word seed phrase. If you run it on a machine connected to the internet, the words appear in a browser tab that could theoretically be read by extensions, clipboard monitors, or screen capture.

**What to do:** Always use `recovery_tool.html` on an air-gapped machine (no network, no extensions). Print the result immediately and close the browser. See the Recovery section below.

### ❻ Between open and sign

After the DCC gate passes, the decrypted seed data exists in Worker memory until `sign()` completes and `lock()` is called. This window is very short (milliseconds to seconds), but it exists. The 10-second SIGN TTL is a hard upper bound — after that, the token expires and the vault auto-locks on the next operation attempt.

---

## What BioWallet never does

These are hard guarantees, verifiable in the source code:

- **Never sends your seed or private key over the network** — no outbound calls contain key material
- **Never stores the seed in plaintext** — only the encrypted vault blob is written to localStorage
- **Never shows the 24-word mnemonic in the UI** — there is no reveal function
- **Never includes your personal number (P) in the app** — P is only used offline, in `recovery_tool.html`
- **Never uses a cloud service for key operations** — all cryptography runs locally
- **Never keeps the vault open after signing** — P7 auto-lock is unconditional

---

## Recovery security

The paper backup system is designed so that no single document recovers your wallet — you need three pieces:

| What | Where | Contains |
|---|---|---|
| **Final Paper A** | Stored safely (e.g. bank vault) | 24 encoded numbers |
| **Paper B** | Stored separately from Paper A | 24 random offsets |
| **Personal number P** | Memorised — never written down | Your personal modifier |

**How it is generated:**

1. BioWallet generates Raw Paper A (inside the Worker, seed never leaves) and outputs 24 numbers.
2. You take these to `recovery_tool.html` on an **air-gapped machine**.
3. You enter your personal number P. The tool applies P to produce Final Paper A and immediately erases P from the input field.
4. You print or write down Final Paper A.
5. Paper B (the random offsets) was also generated by the app and given to you separately.

**To recover:**

- Open `recovery_tool.html` on an air-gapped machine.
- Enter Final Paper A + Paper B + P.
- The tool computes the 24 BIP39 words.
- Write them down immediately. Close and clear the browser.
- Import into any BIP39-compatible wallet (MetaMask, etc.).

**P is never in the system.** Neither the app nor `recovery_tool.html` stores P. If you forget P, the recovery cannot be completed.

---

## How to verify what you are running

BioWallet includes a build verification system so you can confirm the server has not tampered with the files you are running.

### Step 1 — Check the footer hash

When BioWallet is open in your browser, the footer shows a short build fingerprint, for example:

```
Build: fe7f8317…
```

### Step 2 — Compare with the published hash

Run `build_hash.py` locally (from the source code) or check the `HASHES.md` file on GitHub for the current release. The SHA-256 hash of `index.html` and `app.js` should match what is shown in the footer.

If the hashes do not match, the server may have served modified files.

### Step 3 — Inspect the source

The full source is available at: https://github.com/LemonScripter/biowallet

The security-critical files are:
- `src/core/vault.js` — encryption, key derivation, DCC gating
- `src/core/causal_chain.js` — the DCC token logic (P1–P7)
- `src/app/vault_worker.js` — Worker entry point
- `src/core/fuzzy_extractor.js` — biometric → key conversion

### Step 4 — Run offline

BioWallet is a **Progressive Web App (PWA)**. After the first load, it caches all files locally. You can:
1. Load the app once on a trusted network.
2. Disconnect from the internet.
3. Reload — the app continues to work from the local cache.

All signing operations function entirely offline. RPC calls (balance checks, transaction broadcasting) require internet, but they handle no key material.

---

## Summary table

| Threat | Protected? | Notes |
|---|---|---|
| Someone steals your device | ✅ Yes | Vault is encrypted; face required to open |
| Someone knows your browser localStorage | ✅ Yes | Only encrypted blob stored |
| Brute-force face spoofing | ✅ Yes | Escalating cooldown after 3 failures |
| Replay attack (reuse signed TX) | ✅ Yes | Single-use DCC token + nonce in TX |
| Phishing / fake site | ✅ Partial | Build fingerprint lets you verify the real site |
| Malicious browser extension | ⚠️ Limited | Extensions have DOM access; use a clean profile |
| Compromised OS | ❌ No | OS-level attacks are outside the wallet's scope |
| Camera photo spoofing | ⚠️ Limited | No liveness detection; risk depends on photo quality |
| Physical coercion | ❌ No | Cryptography cannot stop physical force |
| recovery_tool used online | ⚠️ Limited | Use only air-gapped |
| Forgotten personal number P | ❌ No recovery | P is never stored; if lost, paper backup is unusable |
