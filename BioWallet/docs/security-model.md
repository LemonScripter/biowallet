# BioWallet — Security Model

**Author:** Szőke László-Ferenc | MetaSpace.Bio Logic Engine project | admin@metaspace.bio

---

## The core promise

Your private key (seed) never leaves the browser's background Worker thread in plain form. The main page — and any JavaScript running on it — only ever sends instructions to the Worker and receives a signed transaction back. The seed itself is never passed across that boundary.

---

## What protects your wallet

### 1. Biometric encryption at rest

Your seed is encrypted with **AES-256-GCM** and stored locally in the browser. The vault format determines how the decryption key is derived:

**v3 vault (default for all new wallets since v26):** The faceWrap decryption key is derived from `PBKDF2(face_R ‖ PIN_bytes, salt, 300,000 iterations)` — your biometric secret and your PIN are concatenated before key derivation. Opening the vault on a new or unenrolled device requires both a face scan and the PIN. On an enrolled device the device path is used instead (see section 3 below), which never requires a PIN.

**v2 vault (wallets created before v26):** The decryption key is derived from `PBKDF2(face_R, salt, 300,000 iterations)` — face-only, no PIN required. These vaults remain fully functional without migration.

**v1 vault (legacy binary format):** Face-only single-factor. Automatically upgraded to v2 upon device enrollment.

The PIN is never stored anywhere. It is supplied by the user at open time, immediately concatenated with the biometric secret `face_R`, fed into PBKDF2, and discarded. There is no PIN database, no PIN hash, no PIN check — a wrong PIN produces the wrong AES key, and AES-GCM decryption fails silently (the vault reports `BIO_MISMATCH`, identical to a failed face scan).

### 2. The DCC Causal Chain

Every sensitive operation is guarded by the **Digital Causal Closure (DCC)** chain. This is a formal security invariant enforced in the cryptographic layer — not a UI check, but a hard gate that the signing code cannot bypass regardless of what the page layer does.

**The constitutional sequence for signing:**

```
BIO_CAPTURE #1  →  OPEN  →  COMMIT_TX  →  [fingerprint entry]  →  BIO_CAPTURE #2  →  SIGN  →  auto-lock
```

Signing requires **two separate biometric events** and a **manual transaction commitment step**:

1. The first scan opens the vault — its token is consumed immediately.
2. Before the second scan, the app sends the transaction to the Worker (`COMMIT_TX`). The Worker computes `SHA-256(canonical(tx))` and stores it internally. It returns the first 8 characters as a fingerprint.
3. The confirm modal displays the transaction details **and the 8-character fingerprint**. The user must manually type the first 4 characters into an input field.
4. The second face scan issues a token that is **cryptographically bound to the committed transaction hash**.
5. At signing, the Worker re-computes the hash of the transaction it received and verifies it matches the token-bound hash. Any substitution fails.

Each token has four properties enforced at the code level:

| Property | What it means |
|---|---|
| **P1 — Must exist** | No operation without a prior face scan |
| **P2 — Must be fresh** | Open: 30 s · Sign: 10 s · Export: 5 s |
| **P3 — Single-use** | Consumed on first use — no replay |
| **P4 — Vault-bound** | A token issued for one vault cannot open another |

And three behavioural rules that shape the full sequence:

| Rule | What it means |
|---|---|
| **P5 — Sign always re-scans** | Opening the vault is not enough to sign — a new scan is required |
| **P6 — TX commitment** | The second scan token is bound to the exact transaction committed by the user. Any attempt to sign a different transaction fails with `TX_MISMATCH` at the gate |
| **P7 — Auto-lock after sign** | The vault locks unconditionally after every signing operation |

**What this means in practice:** Any attempt to trigger a signing operation — whether from the page, from injected code, or from a simulated UI event — hits the DCC gate. The gate requires a valid token bound to the correct transaction. The token only exists for 10 seconds after a real face capture, and it carries the hash of exactly the transaction the user typed a fingerprint prefix for. Without that physical anchor, the chain stops.

### 3. Device factor (WebAuthn PRF)

On an enrolled device, the vault can be opened without typing a PIN. The browser's **platform authenticator** — a fingerprint sensor, Face ID, or a FIDO2/WebAuthn security key — provides a deterministic 32-byte secret via the **PRF extension** (`navigator.credentials.get` with `extensions: { prf: ... }`). This secret is device-bound and credential-bound: it only exists on the specific authenticator that enrolled it.

The device-path key is derived independently of the PIN:

```
device_key = HKDF(face_R ‖ device_prf, salt, info="biowallet-device-v2")
```

**Open paths for v3 vaults:**

| Scenario | Method | What is required |
|---|---|---|
| Enrolled device | Device path | Face scan + platform authenticator (fingerprint / Face ID) |
| New / unenrolled device | Face path | Face scan + PIN |
| Device path fails (fallback) | Face path | Face scan + PIN |

Device enrollment happens after the initial setup: scan your face to open the vault, then tap **Enroll this device**. Enrollment can be revoked from the settings panel at any time — removing `deviceWrap` from the vault data and reverting to face + PIN on all subsequent opens.

**The device factor does not replace the biometric.** The face scan is always required first — the device PRF is an additional layer on top. An attacker who has the physical device (and can present their own fingerprint) still cannot open the vault because their face scan produces a different `face_R`, and the device-path key derivation starts from `face_R`.

### 4. Worker thread isolation

All cryptographic operations run in a dedicated **Module Worker** (`vault_worker.js`). The main page thread cannot read the Worker's memory. After signing, the seed bytes are explicitly zeroed in memory before auto-lock.

### 5. No plaintext seed, ever

There is no "show seed phrase" button. The 24-word mnemonic never appears in the UI. It exists in Worker memory only for the milliseconds needed to sign a transaction.

---

## When the system fully protects you

| State | What is happening | Protection |
|---|---|---|
| **Locked** (default) | Vault encrypted, no token, Worker idle | ✅ Full |
| **Scanning** | Face capture in progress | ✅ Full |
| **Open, waiting** | First token consumed, vault decrypted in Worker | ✅ Full — seed in Worker only |
| **Confirm modal** | TX committed to Worker, fingerprint shown, user enters prefix | ✅ Full — physical attention anchor |
| **Signing** | Second scan complete, TX hash verified, transaction being signed | ✅ Full — auto-lock follows immediately |
| **Brute-force block** | 3 failed scans → escalating cooldown (30 s → 60 s → 120 s → 240 s) | ✅ Full |
| **Export / paper recovery** | rawA + r generated inside Worker, P never included | ✅ Full |
| **Offline / PWA mode** | App running from local cache, no network | ✅ Full — signing works entirely offline |

---

## Browser extensions and the DCC

This deserves its own section because it is frequently misunderstood.

**What a browser extension can do to the page:**
- Simulate button clicks and UI events
- Read `localStorage` (including the encrypted vault blob and the helper data `P`)
- Inject JavaScript into the page context via a MAIN-world script
- Hook `Worker.prototype.postMessage` to intercept messages between the page and the crypto Worker

**What this achieves against the DCC:** Nothing useful for an unauthenticated operation. Simulating a click on the scan button starts the camera — but the face recognition model reads the **real camera stream**. If no face is present, `fuzzy_extract` produces no valid key and no token is issued. The causal chain stops at the first gate.

### Transaction substitution (the MAIN-world extension threat)

A more sophisticated attack: a MAIN-world extension hooks `Worker.postMessage` and attempts to substitute the user's transaction with a malicious one. This was a real residual risk before P6.

**P6 closes this attack.** The sequence is:

1. Extension intercepts `COMMIT_TX { tx: userTx }` and sends `{ tx: maliciousTx }` to the Worker instead.
2. The Worker stores `hash(maliciousTx)` and returns `fingerprint = hash(maliciousTx)[:8]`.
3. The extension intercepts the response and shows the user a **fake fingerprint** — `hash(userTx)[:8]`.
4. The user reads the fake fingerprint on screen and types the first 4 characters.
5. Those 4 characters are sent to the Worker in `BIO_CAPTURE`. The Worker checks: does the user's input match `hash(maliciousTx)[:4]`?
6. Because `hash(userTx)[:4] ≠ hash(maliciousTx)[:4]` (SHA-256 collision probability: 1 in 2³²), the Worker throws `TX_MISMATCH` and blocks the operation.

Even if the extension also intercepts `BIO_CAPTURE` and replaces the user's input with the correct prefix of `hash(maliciousTx)` — the SIGN gate provides a second independent check: it recomputes `hash(tx_received)` and verifies it matches the token-bound hash. If the extension delivers the correct fingerprint at BIO_CAPTURE but the user later sees the wrong transaction details in their wallet history, there is a forensic trail.

**What about `getUserMedia` spoofing?** To advance the biometric part of the chain, the extension would need to inject a fake video stream — substituting a pre-recorded face video for the real camera feed. This requires:

1. A prior recording of the enrolled face at sufficient resolution and angle
2. A recording that falls within the fuzzy extractor's tolerance window — not just "looks like you" but biometrically close enough to reproduce the same stable key
3. The malicious extension to have been **installed before going offline**, with the face data already embedded

In offline/PWA mode the extension cannot fetch face data on demand. Everything must be pre-loaded. This means the attack is no longer a software attack — it is a **targeted physical-world operation** that requires prior physical proximity, prior device access to install the extension, and biometric precision. Anyone capable of mounting that attack has simpler options available (see: physical coercion below).

**Conclusion:** Browser extensions, as a generic threat category, are defeated by the DCC causal chain and the P6 transaction commitment. The only residual biometric risk — a pre-loaded `getUserMedia` spoof — collapses into the physical-world biometric spoofing threat, which is a separate category.

---

## When protection is limited or absent

### ❶ Biometric spoofing (photo or video)

BioWallet does not currently include liveness detection. A high-quality photograph or video of your face, presented to the camera, could theoretically produce an embedding close enough to pass the fuzzy extractor.

This threat applies whether delivered via a physical print, a screen playing a recording, or (as discussed above) a `getUserMedia`-hooking extension with a pre-loaded recording. In all cases the attacker needs prior biometric data that matches your enrolled face.

**What to do:** Be mindful of who can obtain high-resolution face recordings of you. This risk is similar to fingerprint biometrics — your face is not secret the way a password is. Future versions will add liveness detection (Phase 6+).

### ❷ Compromised operating system

A kernel-level compromise (rootkit, malware with OS privileges) can capture camera frames before they reach the browser, dump process memory, or log all input. No browser-based application can protect against OS-level access.

**What to do:** Keep your operating system updated. Do not use BioWallet on a shared or untrusted machine.

### ❸ Physical coercion

If someone forces you to present your face to the camera, the vault will open. No cryptographic system can protect against this.

### ❹ recovery_tool.html used on a connected machine

The offline recovery tool decodes your paper backup into the 24-word seed phrase. If you run it on a machine connected to the internet, or with browser extensions active, the words are visible in a browser tab that could be observed.

**What to do:** Use `recovery_tool.html` only on an air-gapped machine with no extensions. Print or write down the result immediately. Close the browser and clear its data.

---

## What BioWallet never does

These are hard guarantees, verifiable in the source code:

- **Never sends seed or private key over the network** — no outbound call carries key material
- **Never stores the seed in plaintext** — only the AES-GCM encrypted blob is written to `localStorage`
- **Never shows the 24-word mnemonic in the UI** — there is no reveal function
- **Never includes your personal number P in the app** — P is applied only offline, in `recovery_tool.html`
- **Never uses a cloud service for key operations** — all cryptography runs locally in the Worker
- **Never stores the PIN** — the PIN is mixed into PBKDF2 key material at open/enroll time and immediately discarded; there is no stored PIN representation, hash, or check anywhere in the system
- **Never keeps the vault open after signing** — P7 auto-lock is unconditional and cannot be disabled
- **Never signs a transaction that wasn't committed before the second scan** — P6 binds the signing token to the exact transaction hash; any substitution is rejected at the gate

---

## Recovery security

The paper backup requires three pieces. No single piece recovers the wallet — all three are needed together:

| What | Where | Contains |
|---|---|---|
| **Final Paper A** | Stored safely (e.g. bank vault) | 24 encoded numbers |
| **Paper B** | Stored **separately** from Paper A | 24 random offsets |
| **Personal number P** | Memorised — never written down | Your personal modifier |

**How it is generated:**

1. Inside the Worker (seed never leaves), BioWallet computes Raw Paper A and the random offsets for Paper B.
2. You take Raw Paper A to `recovery_tool.html` on an **air-gapped machine**.
3. You enter P. The tool applies it to produce Final Paper A, then immediately erases P from the field.
4. You print or write down Final Paper A and Paper B separately.

**To recover:**

Open `recovery_tool.html` air-gapped. Enter Final Paper A + Paper B + P. Write down the 24 words. Close and clear the browser. Import into any BIP39-compatible wallet.

**P is never in the system.** If you forget P, the paper backup cannot be decoded.

---

## How to verify what you are running

### Check the build fingerprint

The footer of the running app shows a SHA-256 build fingerprint. Compare it against the published hash on GitHub (run `build_hash.py` locally, or check the release notes). A mismatch means the server may have served modified files.

### Inspect the source

All code is published at: **https://github.com/LemonScripter/biowallet**

Security-critical files:
- `src/core/vault.js` — encryption, key derivation, DCC gating, TX commitment
- `src/core/causal_chain.js` — the DCC token logic (P1–P7), txHash binding
- `src/app/vault_worker.js` — Worker entry point; COMMIT_TX, CANCEL_TX, BIO_CAPTURE, SIGN
- `src/core/fuzzy_extractor.js` — biometric → stable key conversion

### Run offline

After the first load, BioWallet runs entirely from its PWA cache. Disconnect from the internet and reload — the app works. All signing operations function offline. RPC calls (balance checks, broadcasting) require internet but handle no key material.

---

## Summary table

| Threat | Protected? | How |
|---|---|---|
| Stolen / lost device (unenrolled) | ✅ Yes | v3 vault: attacker needs face + PIN; neither is stored |
| Stolen / lost device (enrolled) | ✅ Yes | Attacker's fingerprint produces different `face_R`; vault rejects |
| Stolen `localStorage` + P.json (no device) | ✅ Yes | v3: still needs face + PIN; v2: still needs face |
| Cross-device attack (vault + P.json on new machine) | ✅ Yes | v3: face + PIN both required on any unenrolled device |
| Stolen `localStorage` contents | ✅ Yes | AES-GCM encrypted blob; decryption key never stored |
| Brute-force face spoofing | ✅ Yes | Escalating cooldown after 3 failures |
| Replay attack on signed transaction | ✅ Yes | Single-use DCC token (P3) + transaction nonce |
| Injected code or simulated UI events | ✅ Yes | DCC requires real biometric; no face = no token |
| Browser extension (generic) | ✅ Yes | DCC causal chain cannot be advanced without physical face scan |
| Browser extension — tx substitution (MAIN world) | ✅ Yes | P6: Worker verifies tx hash against token-bound commitment; fingerprint mismatch blocks substitution |
| Phishing / tampered server files | ✅ Partial | Build fingerprint lets you detect tampering |
| Biometric spoofing (photo / video) | ⚠️ Limited | No liveness detection; planned for Phase 6+ |
| Browser extension + pre-loaded face spoof | ⚠️ Limited | Collapses to biometric spoofing; requires prior physical access |
| Compromised operating system | ❌ No | OS-level access is outside the wallet's scope |
| Physical coercion | ❌ No | Cryptography cannot stop physical force |
| recovery_tool used on a connected machine | ⚠️ Limited | Use air-gapped only |
| Forgotten personal number P | ❌ No recovery | P is never stored anywhere |
| Forgotten PIN (v3 vault, no enrolled device) | ❌ No recovery | PIN is not stored; wrong PIN = wrong key; use paper recovery |
