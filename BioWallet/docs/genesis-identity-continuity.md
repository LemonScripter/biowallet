# BioWallet Genesis Identity Continuity

**Author:** Szőke László-Ferenc | MetaSpace.Bio Logic Engine  
**Version:** 1.0 | 2026-05-31  
**Status:** Design specification — implementation roadmap  
**Contact:** admin@metaspace.bio

---

## Abstract

BioWallet derives cryptographic vault keys from biometric face embeddings.
This creates a fundamental tension: the biometric is the key, yet biometrics
change over time. This document formalises the `genesis.dna` identity anchor
and the `dna_chain` re-enrollment protocol as a solution to three related
problems: (1) gradual biometric drift due to aging, (2) sudden biometric
change due to accident or illness, and (3) legal inheritance of digital
assets without compromising the vault's security model.

The core thesis is that `genesis.dna` — a cryptographic commitment to the
owner's biometric at the moment of wallet creation — acts as a **persistent
identity root**. Combined with a chain of authorised re-enrollments, it
provides continuity across arbitrarily large biometric change, as long as
the change is traversed incrementally and every step is explicitly authorised
by the previous identity.

---

## 1. The Biometric Drift Problem

### 1.1 FaceNet Embedding Stability

BioWallet uses a FaceNet-style model producing 128-dimensional `Float32`
embeddings. The BCH fuzzy extractor maps these to a 256-bit binary vector
via a random projection matrix `W` and a sign quantisation step:

```
b = sign(W · embedding)    b ∈ {0,1}^256
```

The BCH(255, 55, t=25) code can correct up to **25 bit-flips** between
the enrollment bitstring `b_enroll` and the current scan `b_now`. This
corresponds to a Hamming distance threshold of approximately **10%** of
the 256 projected bits.

Research on face recognition across age gaps shows the following approximate
embedding distance growth (Hamming distance after projection, indicative):

| Age delta | Typical distance | Within BCH threshold? |
|---|---|---|
| 0–2 years | 2–8 bits | Yes (comfortable margin) |
| 2–5 years | 5–18 bits | Yes |
| 5–10 years | 12–28 bits | Borderline |
| 10–20 years | 20–45 bits | No — correction fails |
| 20+ years | 35–70 bits | No |
| Accident / surgery | 40–120+ bits | No |

The critical insight: **a 50-year vault lifespan requires a re-enrollment
strategy**. Without it, the vault will eventually become inaccessible due to
natural aging alone — not due to any attack.

### 1.2 The Incremental Re-enrollment Solution

The key mathematical property of BCH correction is:

> If `d(b_0, b_1) ≤ t` AND `d(b_1, b_2) ≤ t`, it does NOT follow that
> `d(b_0, b_2) ≤ t`.

But the identity chain only needs `d(b_{n-1}, b_n) ≤ t` at each step —
the vault is re-keyed at each re-enrollment. The full arc
`b_0 → b_1 → ... → b_n` is traversable even if `d(b_0, b_n) >> t`,
as long as each individual step stays within the correction threshold.

**Formal statement:**

Let `E_n` be the face embedding at time `T_n`. Let `R_n = BCH_extract(E_n, P_n)`
be the derived vault key. A re-enrollment at step `n` requires:

```
BCH_extract(E_n, P_{n-1}) = R_{n-1}     (can open current vault)
```

After re-enrollment, a new `P_n` is stored and the vault is re-encrypted
with `R_n`. The wallet is now bound to the identity at `T_n`, but the
`dna_chain` records the authorisation chain back to genesis.

This means an owner who re-enrolls every **3–5 years** — a single deliberate
annual session — maintains a continuous vault identity across their entire
lifetime.

---

## 2. The genesis.dna Anchor

### 2.1 Definition

```
genesis.dna = SHA-256(R_0 ‖ ts_0_u64be)
```

Where:
- `R_0` = the BCH-extracted vault key at first enrollment (`Uint8Array[32]`)
- `ts_0_u64be` = the enrollment timestamp as a big-endian 64-bit integer
- `‖` = byte concatenation

`genesis.dna` is:
- **Stored in plaintext** in the vault JSON — it is not a secret
- **Immutable** — no operation in the BioWallet protocol changes it
- **Unforgeable** without knowledge of `R_0` (preimage resistance of SHA-256)
- **Non-reversible** — `genesis.dna` does not reveal the face or the embedding

### 2.2 What genesis.dna represents

`genesis.dna` is a cryptographic **commitment to identity at a specific moment
in time**. It answers the question: *"Is this vault owned by the same person
who created it?"* — without requiring the owner's face to be the same as it
was at creation.

It is analogous to the genesis block of a blockchain: the immutable foundation
from which all subsequent state is derived.

### 2.3 The dna_chain

Each re-enrollment appends one entry to `dna_chain`:

```
chain[0].hash = SHA-256("" ‖ genesis.dna ‖ ts_0.toString())
chain[n].hash = SHA-256(chain[n-1].hash ‖ genesis.dna ‖ ts_n.toString())
```

Properties of the chain:
- **Monotonically growing** — only append operations, never truncation (Z3 GENESIS-3)
- **Immutable past** — each hash commits to all previous hashes + genesis.dna
- **Tamper-evident** — modifying any past entry breaks all subsequent hashes
- **genesis.dna-anchored** — every entry explicitly contains genesis.dna in the
  hash input, binding the chain irrevocably to the original identity

The chain is the **causal proof of continuous ownership**: the person who holds
the wallet at step `n` was authorised by the person at step `n-1`, who was
authorised by the person at step `n-2`, ... all the way back to the original
enrollment that produced `genesis.dna`.

---

## 3. The DCC Genesis Guard

The Digital Causal Closure protocol enforces the genesis anchor at the SIGN
gate. The Z3-verified invariants are:

```
GENESIS-1: re_enrollment cannot change genesis.dna
           ∀ re_enrollment: vault.genesis.dna = genesis.dna_pre  [IMMUTABLE]

GENESIS-2: v5 vault, chain_len=1, dna_mismatch → SIGN blocked
           v5 ∧ chain_len=1 ∧ ¬genesis_match → sign_blocked=True

GENESIS-3: re_enrollment strictly grows chain_len
           ∀ re_enrollment: chain_len_after > chain_len_before

GENESIS-4: re-enrolled vault (chain_len > 1) → genesis guard disabled
           v5 ∧ chain_len>1 → sign_blocked_genesis=False

GENESIS-OK: v5, face-open, genesis match, chain_len=1 → SIGN not blocked
            SAT — consistent state
```

The logic behind GENESIS-4 is deliberate: once a re-enrollment has occurred,
the genesis guard becomes a bootstrap-only check. After re-enrollment, the
vault key itself is the authentication proof — the re-enrollment authorisation
already established that the current face is the correct owner.

---

## 4. Continuity Across Aging

### 4.1 The Recommended Re-enrollment Schedule

Based on the empirical distance data in §1.1, the following schedule maintains
continuous vault access across a human lifespan:

| Life phase | Recommended interval | Reason |
|---|---|---|
| Ages 18–30 | Every 5 years | Face stable, low drift |
| Ages 30–50 | Every 3 years | Gradual change accelerates |
| Ages 50–70 | Every 2 years | Aging more pronounced |
| Ages 70+ | Every 1–2 years | Significant year-on-year change |
| After any surgery | Immediately | Facial structure may have changed |
| After major illness | Within 3 months | Weight/skin changes |

The wallet should implement a **re-enrollment reminder** system: if
`now - dna_chain[last].ts > 365 days`, display a non-blocking notice
on the lock screen.

### 4.2 Proof of Continuous Ownership

The `dna_chain` is the **proof of continuous ownership** over time. Given:

```
chain = [
  { gen:0, hash: H0, ts: 2025-01-15, method: "initial_enrollment" },
  { gen:1, hash: H1, ts: 2027-03-10, method: "re_enrollment" },
  { gen:2, hash: H2, ts: 2030-06-22, method: "re_enrollment_via_sss" },
  ...
]
```

The `method` field distinguishes how the authorisation occurred:

| method | Authorisation basis |
|---|---|
| `initial_enrollment` | First enrollment |
| `re_enrollment` | Previous face opened vault → strong biometric continuity |
| `re_enrollment_via_sss` | Paper+device opened vault (face unavailable/changed) → continuity via two SSS factors; face bound to chain on this browser |

An auditor can verify:
1. `H0 = SHA-256(genesis.dna ‖ ts_0)` — matches genesis
2. `H1 = SHA-256(H0 ‖ genesis.dna ‖ ts_1)` — links to H0
3. `H2 = SHA-256(H1 ‖ genesis.dna ‖ ts_2)` — links to H1
4. Each re-enrollment timestamp is monotonically increasing
5. genesis.dna appears in every hash — the chain cannot be split off
   and reattached to a different identity

This chain, stored inside the vault JSON, constitutes a machine-verifiable
**identity continuity certificate**.

---

## 5. Continuity After Sudden Biometric Change

### 5.1 The Deadlock Problem

If the owner's face changes catastrophically (accident, severe burns, facial
surgery) before a re-enrollment, a deadlock occurs:

```
Cannot re-enroll → requires opening the vault with current face
Cannot open vault → current face is too different (BCH correction fails)
```

This is the most serious continuity failure mode. The current BioWallet
protocol does not solve it fully. The following extensions address it.

### 5.2 Extension A: Social Witness Re-enrollment

A designated set of witnesses (M-of-N) can co-authorise an emergency
re-enrollment. The protocol:

1. Owner designates `N` witnesses at enrollment time (e.g., N=3, M=2)
2. Each witness receives a **witness certificate**: `HMAC(witness_secret, genesis.dna)`
3. In an emergency, M witnesses provide their certificates
4. The wallet verifies M valid certificates → authorises re-enrollment
5. Chain entry: `method: "social_witness_recovery", witnesses: [hash1, hash2]`

The witness secrets are never stored in the vault — they are distributed
to trusted parties (family, lawyer, notary) as paper documents.

Security property: An attacker needs M witness secrets AND the vault file
AND the P.json to perform a social recovery. Since witnesses are physically
distributed, collusion requires real-world coordination.

### 5.3 Extension B: Biometric Portfolio

At creation time, enroll **multiple biometric modalities**:

```
genesis.dna = SHA-256(
  R_face_0 ‖ R_fingerprint_0 ‖ R_iris_0 ‖ ts_0
)
```

Each biometric has its own fuzzy commitment and BCH syndrome stored in P.json.
If the face fails, fingerprint or iris can:
1. Open the vault
2. Verify against genesis.dna (the multi-modal commitment)
3. Re-enroll the face biometric under the existing chain

This is particularly valuable for medical scenarios: facial surgery typically
does not affect fingerprints. Iris biometrics are stable across most accidents.

### 5.4 Extension C: Time-locked Paper Override

At enrollment, the owner creates a **time-locked override key**:

```
override_key = random 256 bits
override_ct  = AES-GCM(PBKDF2(override_key, salt, 500k), seed_json)
unlock_ts    = now + 5_years
```

The override key is sealed in a physical envelope with a notary, with
instructions: "Open only if the wallet owner presents this document and
demonstrates identity via government ID."

After `unlock_ts`, the override key can unlock the vault without any
biometric. The timestamp prevents immediate use (cold-wallet theft protection).

This is a last-resort mechanism — its existence is not recorded in the
vault JSON (to prevent targeted attack).

---

## 6. Inheritance After Death

### 6.1 Current State: SSS 2-of-3 Solves Most Cases

With Phase 10 SSS(2,3) (live since v29), inheritance is partially solved
**today without any protocol extension**:

| Heir has | Can reconstruct? | Biometric needed? |
|---|---|---|
| Paper share (x=3) + enrolled device (x=2) | **Yes** | No |
| Paper share (x=3) + owner's face scan | No — device x=2 also needed OR face x=1 sufficient | x=1 alone? |
| Face biometric (impossible post-death) | No | — |

The paper share path (`reconstruct(x=2, x=3)` = device + paper) allows
heirs to access funds **without any biometric**. The heir needs:
- The `.biowallet` file (or a copy)
- The 64 hex-character paper share
- The enrolled device (WebAuthn authenticator)

This is functionally equivalent to a hardware wallet inheritance plan:
the paper share plays the role of the recovery seed.

### 6.2 The genesis.dna in Inheritance Context

In the inheritance scenario, `genesis.dna` serves as a **legal identifier**:

```
genesis.dna = SHA-256(R_0 ‖ ts_0) = "3f8a92c4..."
```

This 64-character hex string uniquely identifies the wallet. It can be:
- Registered in a **digital will** as the wallet identifier
- Referenced in a **smart contract succession plan** on Arbitrum or Ethereum
- Included in legal documents as an **asset identifier**
- Used by heirs to prove ownership in court (along with vault file + paper share)

The genesis.dna does not reveal any biometric data — it is safe to publish
in legal documents.

### 6.3 Proposed: On-chain Succession Contract

```solidity
contract BioWalletSuccession {
    mapping(bytes32 => SuccessionPlan) public plans;

    struct SuccessionPlan {
        bytes32 genesisDna;      // SHA-256 of genesis.dna
        address[] heirs;         // Ethereum addresses of designated heirs
        uint256 inactivityPeriod; // e.g., 3 years in seconds
        uint256 lastActivity;    // timestamp of last on-chain ping
        uint256 requiredHeirs;   // M-of-N threshold
    }

    function registerPlan(
        bytes32 genesisDna,
        address[] memory heirs,
        uint256 inactivityPeriod,
        uint256 required
    ) external { ... }

    function ping(bytes32 genesisDna) external {
        // Owner calls this periodically to prove liveness
        plans[genesisDna].lastActivity = block.timestamp;
    }

    function claimSuccession(
        bytes32 genesisDna,
        bytes32 newGenesisDna,     // heir's new wallet genesis
        bytes[] memory heirSigs    // M-of-N heir signatures
    ) external {
        require(block.timestamp - plans[genesisDna].lastActivity
                > plans[genesisDna].inactivityPeriod);
        // verify M-of-N signatures, record succession
        emit SuccessionClaimed(genesisDna, newGenesisDna, block.timestamp);
    }
}
```

The on-chain succession record creates an **immutable public proof** that
the new wallet (heir's `newGenesisDna`) is the legal successor of the
original wallet (`genesisDna`). This is verifiable by any court, exchange,
or protocol without revealing private keys or biometric data.

---

## 7. The Full Identity Continuity Model

Combining all components, the complete identity continuity model is:

```
genesis.dna ─────────────────────────────────────────────────────── immutable
     │
     ├── dna_chain[0]  T0  initial_enrollment      (face_R_0)
     │         │
     │         ├── dna_chain[1]  T1  re_enrollment          (face_R_1, aging)
     │         │         │
     │         │         ├── dna_chain[2]  T2  re_enrollment  (face_R_2)
     │         │         │         │
     │         │         │         └── dna_chain[3]  T3  social_witness_recovery
     │         │         │                   (face_R_3, post-accident)
     │         │         │
     │         │         └── [alternative] biometric_portfolio: fingerprint fallback
     │
     ├── SSS shares (paper + device) → seed accessible without face chain
     │
     ├── genesis_backup → face-only emergency path (within BCH tolerance)
     │
     └── on-chain succession contract → heir can claim after inactivity period
```

The model has **four independent continuity paths**, each addressing a
different failure scenario:

| Scenario | Path | Status |
|---|---|---|
| Normal aging, proactive re-enrollment | `dna_chain` extension | Live (v32) |
| Lost BCH tolerance, face accessible | `genesis_backup` (same face) | Live (v32) |
| Catastrophic face change | Social witness re-enrollment | Proposed |
| Death / permanent incapacity | SSS paper + device shares | Live (v29) |
| Death + missing device | On-chain succession contract | Proposed |
| Multi-biometric fallback | Biometric portfolio | Proposed |

---

## 8. Security Properties of the Identity Chain

### 8.1 What the Chain Guarantees

**Theorem:** Given a valid `dna_chain` of length `n`, an attacker who holds
the vault file and P.json but not the current face embedding cannot:

1. **Forge a new chain entry** — requires opening the vault with current face
2. **Truncate the chain** — GENESIS-3 enforces strictly growing chain_len
3. **Replace genesis.dna** — GENESIS-1 enforces immutability
4. **Reattach the chain to a different vault** — genesis.dna is derived from
   the original vault key `R_0`; a different face cannot produce the same genesis.dna

### 8.2 What the Chain Does Not Guarantee

The chain does NOT prove that every re-enrollment was performed by the same
biological person — only that whoever performed step `n` had access to the
vault at step `n-1`. This is a deliberate design choice:

> **The chain is a chain of authorisation, not a chain of biometric identity.**

This is why social witness recovery (§5.2) is acceptable: the witnesses'
co-signature, combined with the requirement to open the previous vault step,
provides sufficient authorisation even without biometric proof.

### 8.3 Relationship to Self-Sovereign Identity

`genesis.dna` is a self-sovereign identity (SSI) primitive:
- It is **self-generated** — no third party issues it
- It is **unforgeable** — SHA-256 preimage resistance
- It is **portable** — it's a 32-byte value that can be copied, printed, registered
- It is **biometric-grounded** — derived from a unique biological feature
- It is **chain-extensible** — future states can be authorised by past states

This aligns with the W3C DID (Decentralised Identifier) model:
`genesis.dna` could serve as the seed for a DID document, with `dna_chain`
entries as verifiable credentials proving identity continuity.

---

## 9. Implementation Roadmap

| Priority | Feature | Complexity | Impact |
|---|---|---|---|
| 🔴 | Re-enrollment reminder (annual notification) | Low | High — prevents accidental lockout |
| 🔴 | genesis.dna displayed in wallet UI (as identity fingerprint) | Low | High — user awareness |
| 🟡 | Social witness re-enrollment (M-of-N paper certificates) | Medium | Critical for accident recovery |
| 🟡 | Biometric portfolio (fingerprint / iris as fallback) | High | Eliminates accident deadlock |
| 🟢 | On-chain succession contract (Arbitrum One) | Medium | Solves inheritance permanently |
| 🟢 | W3C DID integration (genesis.dna as DID seed) | High | Interoperability |

---

## 10. Conclusion

The `genesis.dna` + `dna_chain` architecture transforms BioWallet from a
static biometric lock into a **dynamic identity continuity system**. The vault
does not bind funds to a face — it binds funds to an identity, expressed as a
cryptographic anchor at a moment in time, with an explicit protocol for
authorised identity evolution.

A wallet created today can, in principle, be held continuously for a human
lifetime — through aging, through accidents, through the passage of the vault
to heirs — as long as each transition is:

1. Authorised by the previous identity (or by the designated witnesses), and
2. Recorded in the `dna_chain` with genesis.dna anchoring every entry.

The funds are not lost when the face changes. They are only lost if no
authorised transition is possible — and the proposed extensions (social witness,
biometric portfolio, on-chain succession) eliminate the remaining failure modes.

**The genesis.dna is not a snapshot of who you are today. It is the root
of proof that you are still the same person who created the wallet — no
matter how much you have changed.**

---

*See also: [FORMAT.md](../FORMAT.md) for vault JSON schema,
[docs/cryptography.md](cryptography.md) for BCH specification,
[docs/formal-verification.md](formal-verification.md) for Z3 proofs.*
