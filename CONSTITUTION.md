# BioWallet — Digital Causal Constitution

> **Canonical deployed instance:** https://biowallet.metaspace.bio  
> **Canonical source:** https://github.com/LemonScripter/biowallet (main branch)  
> **Author:** Szőke László-Ferenc — MetaSpace.Bio Logic Engine project

---

## What is the Constitution?

The file `spec/biowallet.bio` is the BioWallet Digital Causal Constitution.
It defines the DCC (Digital Causal Closure) invariants that govern every
sensitive wallet operation.

These invariants are:
- **Formally verified** by Z3 SMT solver (`tests/verify_biowallet.py`, 71/71 PASS)
- **Hardcoded** in the runtime (`src/core/causal_chain.js`)
- **Tamper-evident** via SHA-256 anchors below

Any fork that weakens these invariants produces a cryptographically different
file — detectable by anyone with `sha256sum`.

---

## Constitution Versions

### v1.0 — Original (2026-05-30) — ✅ ANCHORED ON-CHAIN

**Invariants:** P1–P7 (DCC) + DF1–DF9 (DATA_FLOW) + BCH + Phase5 + Phase9 + SSS + ALKOTMANY + GENESIS  
**Z3 result:** 56/56 PASS

```
793cac74939d658e3cebde0e8066b2ac754ab34e9c85657043c5f58a0a1866e2  spec/biowallet.bio
```

### v2.0 — Extended (2026-06-03) — ⏳ ANCHOR PENDING

**New invariants added:** LIVENESS (LIV1-4) + TX_COMMITMENT (TXC1) + SINGLE_SESSION (SS1) + R_VALIDATION (RV1-2) + WORKER_INTEGRITY (WI1-2)  
**Z3 result:** 71/71 PASS (+15 new proofs)

```
df60de6e3a1adb7c89ad3bc20bdb9dd06d11994c4a9c109a0273ea9cdd80d84f  spec/biowallet.bio
```

**Verify locally:**
```bash
sha256sum spec/biowallet.bio
# v1 original:  793cac74939d658e3cebde0e8066b2ac754ab34e9c85657043c5f58a0a1866e2
# v2 extended:  df60de6e3a1adb7c89ad3bc20bdb9dd06d11994c4a9c109a0273ea9cdd80d84f
```

**Verify all critical files at once:**
```bash
sha256sum -c checksums.txt
```

---

## Blockchain Anchors

### v1.0 Anchor — ✅ CONFIRMED (2026-05-30)

| Field        | Value |
|--------------|-------|
| **Network**  | Arbitrum One (Chain ID 42161) |
| **From**     | `0xcd6317f65d8158163abcf4a4a239c6a68a6e36bb` |
| **To**       | `0x6898c2c1f07ed80c27c1370cd7c251a52246e052` |
| **Value**    | 0 ETH |
| **Data**     | `0x42696f57616c6c657420436f6e737469747574696f6e2076312e30207c20737065632f62696f77616c6c65742e62696f205348412d3235363a2037393363616337343933396436353865336365626465306538303636623261633735346162333465396338353635373034336335663538613061313836366532` |
| **Decoded**  | `BioWallet Constitution v1.0 \| spec/biowallet.bio SHA-256: 793cac74939d658e3cebde0e8066b2ac754ab34e9c85657043c5f58a0a1866e2` |
| **TX hash**  | `0x1c1c485f19fdc1a7f448f06ea8e8c5d0ef0094640cf376e11f42ae14f264a35c` |
| **Explorer** | https://arbiscan.io/tx/0x1c1c485f19fdc1a7f448f06ea8e8c5d0ef0094640cf376e11f42ae14f264a35c |

### v2.0 Anchor — ⏳ PENDING

The v2.0 extended constitution (71/71 Z3 PASS, +15 new invariants) requires a new
on-chain anchor transaction. The calldata to submit on Arbitrum One:

| Field        | Value |
|--------------|-------|
| **Network**  | Arbitrum One (Chain ID 42161) |
| **Value**    | 0 ETH |
| **Data**     | `0x42696f57616c6c657420436f6e737469747574696f6e2076322e30207c20737065632f62696f77616c6c65742e62696f205348412d3235363a2064663630646536653361316164623763383961643362633230626462396464303664313139393463346139633130396130323733656139636464383064383466` |
| **Decoded**  | `BioWallet Constitution v2.0 \| spec/biowallet.bio SHA-256: df60de6e3a1adb7c89ad3bc20bdb9dd06d11994c4a9c109a0273ea9cdd80d84f` |

Submit via MetaMask → Advanced → Hex Data field, from the same `0xcd6317f...` address.

---

## What this protects against

| Threat | Protection |
|--------|-----------|
| Fork weakens DCC TTL (e.g. 30 s → 999 s) | `sha256sum spec/biowallet.bio` will differ |
| Fork removes single-use token constraint | Hash differs; `causal_chain.js` hash also differs |
| Fork claims to be "canonical BioWallet" | Canonical repo + blockchain timestamp prove otherwise |
| Commercial redistribution of modified fork | Commons Clause in LICENSE prohibits it |

---

## Runtime enforcement

Modifying `spec/biowallet.bio` alone does **not** change the deployed app's
behavior — the invariants are enforced by hardcoded constants in
`src/core/causal_chain.js`:

```javascript
const TTL = {
  OPEN:   30_000,   // P2 — 30 s
  SIGN:   10_000,   // P5 — 10 s
  EXPORT:  5_000,   // P6 —  5 s
};
```

The `.bio` file is the **specification**; the runtime is the **enforcement**.
Both are anchored in `checksums.txt`.

---

## Invariant summary

### v1.0 — Original invariants (56 Z3 proofs)

| ID | Name | Rule |
|----|------|------|
| P1–P7 | DCC temporális | bio_gate, token_freshness, single_use, vault_binding, sign_TTL, export_TTL, auto_lock |
| DF1–DF9 | DATA_FLOW | seed/R/privkey confinement, no-exfil, clipboard gate, tx broadcast gate, mandatory zero |
| BCH-P1–P4 | BCH integrity | b_ref not stored, error correction, bio_match binding |
| WK1–TX4 | Phase 5 | no CDN, Worker sandbox, EIP-1559, balance check |
| REC1–5 | Phase 9 | paper recovery, no seed exposure, P never in app |
| SSS1–6 | Phase 10 | 2-of-3 threshold, privacy, no x=0 share |
| ALKOT1–6 | Enrollment | 2-of-3 factor requirement |
| GENESIS-1–4 | Vault v5 | genesis.dna immutable, chain monotone, SIGN blocked on mismatch |

### v2.0 — Extended invariants (+15 Z3 proofs, total 71)

| ID | Name | Rule |
|----|------|------|
| LIV1 | OPEN requires liveness | `op_open ∧ SAT → liveness_passed` |
| LIV2 | Re-enroll requires liveness | `op_reenroll → liveness_passed` |
| LIV3 | Genesis recover requires liveness | `op_genesis_recover → liveness_passed` |
| LIV4 | Static photo blocked | `static_photo_attack → ¬liveness_passed` |
| TXC1 | TX commitment binding | `op_sign ∧ SAT ∧ hash_bound → signed_hash == committed_hash` |
| SS1 | Single session | `¬(tab_A.open ∧ tab_B.open)` |
| RV1–2 | R structural validity | `token_issued → r_length==32 ∧ r_is_uint8array` |
| WI1–2 | Worker integrity | `worker_crashed ∨ timeout → all_tokens_revoked → ¬SAT` |

Formal Z3 proof: `tests/verify_biowallet.py` (71/71 PASS)
