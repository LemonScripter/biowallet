# Formal verification

BioWallet uses [Z3](https://github.com/Z3Prover/z3) — Microsoft Research's industrial-strength SMT (Satisfiability Modulo Theories) solver — to formally verify security-critical properties of its core protocols.

Formal verification does not test code with inputs. It **proves** that a property holds for all possible inputs simultaneously, or finds a counterexample if it does not.

---

## What is verified

### 1. DCC + vault invariants — `tests/verify_biowallet.py`

**71 properties across 12 modules (v35.4a):**

| Module | Properties | What is verified |
|---|---|---|
| DCC | 7 | Token lifecycle, state machine transitions, auto-lock |
| Fuzzy extractor (DF) | 9 | BCH correction bounds, key derivation stability |
| BCH code | 4 | Error correcting code algebraic properties |
| Vault protocol (P5) | 8 | Vault open/lock/sign safety conditions |
| Paper recovery (P9) | 5 | Two-step recovery formula correctness |
| SSS enrollment | 6 | Shamir share split/reconstruct consistency |
| Enrollment constitution (ALKOT) | 6 | Minimum 2-of-3 factor requirement |
| Genesis identity chain | 4 | genesis.dna immutability, chain monotonicity |
| **Liveness / PAD** (v35.4) | **4** | **Head-turn required at OPEN/re-enroll/genesis; static photo blocked** |
| **TX commitment** (v35.4) | **1** | **Signed tx hash must match committed hash** |
| **Single session** (v35.4) | **1** | **Two tabs cannot hold the vault open simultaneously** |
| **R validation + Worker integrity** (v35.4) | **4** | **Biometric result type/length; worker crash revokes all tokens** |

**Selected properties:**

```python
# DCC-1: the vault can only open with a fresh token
Implies(vault_open, token_fresh)

# DCC-2: a consumed token cannot reopen the vault
Not(And(token_consumed, vault_open_again))

# DCC-4: signing always leads to the locked state
Implies(signing, next_state == LOCKED)

# ALKOT-6: face alone is insufficient for Phase 10 vault open
Implies(
    And(face_enrolled, Not(fingerprint_enrolled), Not(hw_key_enrolled)),
    Not(vault_open_p10)
)

# LIV-1 (v35.4): vault open requires liveness to have passed
Implies(And(op_open, SAT), liveness_passed)

# LIV-4 (v35.4): a static photo cannot pass liveness
Implies(static_photo_attack, Not(liveness_passed))

# WI-1 (v35.4): worker crash revokes all pending tokens
Implies(worker_crashed, And(all_pending_tokens_revoked, Not(SAT)))
```

**Method:** Each property is encoded as a Z3 formula. The solver checks whether a violation is *satisfiable*. `unsat` means no violation is possible — the property holds universally.

### 2. GF(2⁸) SSS arithmetic — `tests/verify_sss_gf256.py`

**13 properties verifying Shamir Secret Sharing over the Galois field GF(2⁸):**

BioWallet's Phase 10 SSS implementation operates over GF(2⁸) — the finite field with 256 elements, using the AES irreducible polynomial `x⁸ + x⁴ + x³ + x + 1`. This is the same field used inside AES-128/256.

The proofs use Z3's `BitVec(8)` sort to model 8-bit integers with exact finite-field semantics.

**Field axioms verified (GF-1 through GF-6):**

```python
# GF-1: every element is its own additive inverse (XOR)
ForAll([a], z3_gf_add(a, a) == 0)

# GF-6: every non-zero element has a multiplicative inverse
ForAll([a], Implies(a != 0, z3_gf_mul(a, z3_gf_inv(a)) == 1))
```

**SSS correctness (SSS-1 through SSS-4):**

```python
# Any 2 of 3 shares reconstruct the secret exactly
secret = BitVec('secret', 8)
shares = split(secret, threshold=2, n=3)

# SSS-1: shares 0 and 1 suffice
ForAll([secret], reconstruct([shares[0], shares[1]]) == secret)

# SSS-4: a single share reveals nothing
# (shown by satisfiability: for any share value s, both secret=0 and secret=1 are consistent)
```

**Exhaustive cases:**
- 196 608 GF(2⁸) multiplications: `a * b` for all `a, b ∈ {0..255}` (via Python, not Z3)
- 256 multiplicative inverse cases
- 256 Lagrange interpolation cases

---

## How to run

```bash
pip install z3-solver

# 71 invariants — takes ~10 seconds
python tests/verify_biowallet.py

# 13 GF(2^8) proofs — takes ~5 seconds
python tests/verify_sss_gf256.py
```

Both scripts exit with code `0` on full pass and print per-property results.

---

## Relationship to the running code

The Z3 models are faithful abstractions of the JavaScript implementation:

| Z3 model | JavaScript counterpart |
|---|---|
| `vault_open`, `token_fresh`, `token_consumed` | Worker state in `vault_worker.js` |
| `z3_gf_mul`, `z3_gf_add` | `gfMul`, `gfAdd` in planned `sss.js` |
| `BCH_correct(embedding, W_seed)` | `fuzzyExtract()` in `src/core/fuzzy_extractor.js` |
| `AES_GCM_decrypt(vault_key, ciphertext)` | `crypto.subtle.decrypt()` in `vault_worker.js` |

The Z3 proofs verify the *algebraic and logical properties* of these operations. They do not verify the browser's implementation of AES-GCM (which is provided by the Web Cryptography API and is itself a well-audited standard).

---

## Limitations of the formal proofs

1. **Model vs. implementation gap.** The Z3 models are hand-written abstractions. A bug in the JS implementation that is not captured by the model would not be detected by the proofs.

2. **Browser crypto trust.** `crypto.subtle` is trusted. The proofs do not verify the browser's AES-GCM implementation.

3. **Biometric model.** The fuzzy extractor proofs model the BCH code algebraically but cannot capture the statistical properties of real face embeddings (distribution, inter-personal distance, etc.).

4. **Liveness model.** Since v35.4 the Z3 proofs include LIV1–4 which verify that liveness *must* have passed before any sensitive operation and that a static photo attack cannot satisfy the liveness predicate. The model captures the logical requirement; it does not verify the neural network's ability to distinguish a live face from a sophisticated video replay.
