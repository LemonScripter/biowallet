# Cryptographic specification

---

## 1. Biometric key derivation — BCH fuzzy extractor

The vault key is never stored. It is derived fresh from the user's face at every unlock.

### Why a fuzzy extractor?

A face scan produces a `Float32Array[128]` embedding vector. Two scans of the same face produce slightly different vectors (lighting, angle, camera noise). A cryptographic key derivation function requires *identical* input. A fuzzy extractor bridges this gap: it tolerates small variations while producing the same output for sufficiently similar inputs.

### Construction

BioWallet uses a BCH(63, 51, t=6) fuzzy extractor:

```
Enrollment:
  embedding_raw  →  quantize to 63 bits  →  b (codeword)
  BCH encode b   →  syndrome s
  HKDF(b, salt=s, info="biowallet-v3")  →  vault_key
  Store: { syndrome: s, W_seed: b_quantized }  →  .P.json

Authentication:
  embedding_live  →  quantize to 63 bits  →  b'
  BCH decode (b', syndrome)  →  b  (corrects up to t=6 bit errors)
  HKDF(b, salt=s, info="biowallet-v3")  →  vault_key  (same key as enrollment)
```

| Parameter | Value | Meaning |
|---|---|---|
| Code length | n = 63 | 63-bit codeword |
| Message length | k = 51 | 51 bits of entropy |
| Error correction | t = 6 | Tolerates up to 6 bit-flips between scans |
| Min. Hamming distance | d = 2t+1 = 13 | Two different faces must differ by ≥ 13 bits |

### Security note

The `.P.json` file contains the syndrome `s` and the seed `W_seed`. These do not enable vault decryption — they are BCH helper data that allow re-derivation of the vault key only when a biometrically matching embedding is presented. They are analogous to a password salt: necessary for derivation, insufficient alone.

---

## 2. Vault encryption — AES-256-GCM

```
Encryption (enrollment):
  vault_key (256-bit)
  IV = crypto.getRandomValues(12 bytes)
  ciphertext = AES-256-GCM(key=vault_key, iv=IV, plaintext=JSON(seed+embedding))
  .biowallet = IV || ciphertext

Decryption (unlock):
  IV = .biowallet[0..11]
  ciphertext = .biowallet[12..]
  plaintext = AES-256-GCM-decrypt(key=vault_key, iv=IV, ciphertext)
```

AES-GCM provides both confidentiality and authenticity. An incorrect vault key (wrong face, wrong person) causes a GCM authentication tag failure — the decryption throws before any plaintext is exposed.

Implementation: `crypto.subtle.decrypt()` — the browser's native Web Cryptography API. No custom AES implementation.

---

## 3. HD wallet — BIP39 + BIP44

```
Entropy (128–256 bit)  →  BIP39 mnemonic (12–24 words)
Mnemonic  →  PBKDF2-HMAC-SHA-512 (2048 rounds)  →  512-bit seed
Seed  →  BIP32 master key
Master key  →  m/44'/60'/0'/0/0  →  Ethereum private key (secp256k1)
Private key  →  keccak256(public_key[1:])[-20:]  →  Ethereum address
```

The same derivation path is used for all EVM networks. The Ethereum address is identical on Ethereum mainnet, BNB Chain, Polygon, Arbitrum, and every other EVM-compatible chain.

Implementation: `ethers.js` (bundled locally, no CDN), used exclusively inside `vault_worker.js`.

---

## 4. EIP-1559 fee estimation

```
getFeeData(rpcUrl):
  eth_feeHistory(5 blocks, "latest", [50th percentile])
  eth_maxPriorityFeePerGas()
  
  baseFee_next = baseFee_last × 1.25   // +25 % buffer for next block
  maxPriorityFeePerGas = result or 1.5 Gwei fallback
  maxFeePerGas = baseFee_next + maxPriorityFeePerGas
```

Gas limit: `eth_estimateGas` + 20 % buffer. Fallback: 21 000 (ETH transfer) or 65 000 (token transfer).

---

## 5. DCC — Digital Causal Closure token protocol

DCC enforces that a biometric verification event has a *causal* relationship to every subsequent vault operation. No operation can occur without a fresh, unconsumed token.

```
Token lifecycle:
  BIO_CAPTURE  →  { issued_at: Date.now(), consumed: false }
  OPEN         →  check token_fresh (age < 30 000 ms, !consumed)
  SIGN         →  check token_fresh; token.consumed = true; then LOCK
  LOCK         →  private_key = null; token = null

Token properties:
  - Single-use: consumed after one signing operation
  - Time-bounded: expires 30 s after issuance
  - Scoped: tied to the vault ID, cannot be transferred
```

---

## 6. Paper recovery — two-step formula

The paper recovery system ensures that the seed phrase can be reconstructed offline without ever storing it digitally.

```
Step 1 — export (online, in-app, after biometric verification):
  Generate random r_j  (one per seed word position)
  raw_A_j = wordIndex(mnemonic[j]) XOR r_j  (mod 2048)
  Output: [raw_A_j] (Nyers Papír A) + [r_j] (Papír B)

Step 2 — finalise (offline, in recovery_tool.html):
  User provides personal number P
  final_A_j = raw_A_j XOR hash(P, j)  (Végleges Papír A)

Recovery:
  wordIndex = final_A_j XOR r_j XOR hash(P, j)
  mnemonic = BIP39_word(wordIndex) × 24
```

**Security property:** Neither Nyers Papír A alone, nor Papír B alone, nor the app itself can reconstruct the mnemonic. Recovery requires both paper sheets *plus* the memorized P value.

---

## 7. Shamir Secret Sharing over GF(2⁸) — Phase 10

*(Planned — formal verification complete, JS implementation pending)*

```
Split(secret, threshold=2, n=3):
  f(x) = secret + a₁·x   (degree-1 polynomial over GF(2⁸))
  share_i = (i, f(i))  for i ∈ {1, 2, 3}

Reconstruct(share_i, share_j):
  Lagrange interpolation at x=0:
  secret = f(0) = share_i · (0 - j)/(i - j) + share_j · (0 - i)/(j - i)
  (all arithmetic in GF(2⁸))

GF(2⁸) operations:
  add(a, b) = a XOR b
  mul(a, b) = Russian peasant algorithm mod 0x11b (AES polynomial)
```

The Z3 proof in `tests/verify_sss_gf256.py` verifies all GF field axioms and SSS reconstruction correctness for all possible 8-bit secret values.
