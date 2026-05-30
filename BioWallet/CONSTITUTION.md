# BioWallet — Digital Causal Constitution

> **Canonical deployed instance:** https://biowallet.metaspace.bio  
> **Canonical source:** https://github.com/LemonScripter/biowallet (main branch)  
> **Author:** Szőke László-Ferenc — MetaSpace.Bio Logic Engine project

---

## What is the Constitution?

The file `spec/biowallet.bio` is the BioWallet Digital Causal Constitution.
It defines the DCC (Digital Causal Closure) invariants P1–P7 and data-flow
invariants DF1–DF9 that govern every sensitive wallet operation.

These invariants are:
- **Formally verified** by Z3 SMT solver (`tests/verify_biowallet.py`, 7/7 PASS)
- **Hardcoded** in the runtime (`src/core/causal_chain.js`)
- **Tamper-evident** via the SHA-256 anchor below

Any fork that weakens these invariants produces a cryptographically different
file — detectable by anyone with `sha256sum`.

---

## Constitution Hash (SHA-256)

```
793cac74939d658e3cebde0e8066b2ac754ab34e9c85657043c5f58a0a1866e2  spec/biowallet.bio
```

**Verify locally:**
```bash
sha256sum spec/biowallet.bio
# Expected: 793cac74939d658e3cebde0e8066b2ac754ab34e9c85657043c5f58a0a1866e2
```

**Verify all critical files at once:**
```bash
sha256sum -c checksums.txt
```

---

## Blockchain Anchor

The constitution hash is anchored on the Ethereum blockchain as a zero-value
transaction with the following `data` field. This provides an immutable,
timestamped, third-party-verifiable proof of the canonical constitution.

| Field        | Value |
|--------------|-------|
| **Network**  | Arbitrum One (Chain ID 42161) |
| **From**     | `0xcd6317f65d8158163abcf4a4a239c6a68a6e36bb` |
| **To**       | `0x6898c2c1f07ed80c27c1370cd7c251a52246e052` |
| **Value**    | 0 ETH |
| **Data**     | `0x42696f57616c6c657420436f6e737469747574696f6e2076312e30207c20737065632f62696f77616c6c65742e62696f205348412d3235363a2037393363616337343933396436353865336365626465306538303636623261633735346162333465396338353635373034336335663538613061313836366532` |
| **Decoded**  | `BioWallet Constitution v1.0 \| spec/biowallet.bio SHA-256: 793cac74939d658e3cebde0e8066b2ac754ab34e9c85657043c5f58a0a1866e2` |
| **TX hash**  | `0x1c1c485f19fdc1a7f448f06ea8e8c5d0ef0094640cf376e11f42ae14f264a35c` |
| **Block**    | 468 059 183 (0x1be6042f) |
| **Explorer** | https://arbiscan.io/tx/0x1c1c485f19fdc1a7f448f06ea8e8c5d0ef0094640cf376e11f42ae14f264a35c |

### Anchor TX — CONFIRMED ✓

The anchor transaction was broadcast on **2026-05-30** and confirmed on Arbitrum One.
The on-chain data field decodes exactly to the constitution hash string above.
This record is immutable and publicly verifiable on any Arbitrum block explorer.

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

## Invariant summary (P1–P7 + DF1–DF9)

| ID | Name | Rule |
|----|------|------|
| P1 | Bio gate | SAT only after physical bio event + successful match |
| P2 | Token freshness | Token age < 30 000 ms |
| P3 | Single use | Token consumed == FALSE (TOCTOU lock) |
| P4 | Vault binding | Token bound to the specific vault ID |
| P5 | Sign TTL | Token age < 10 000 ms for SIGN |
| P6 | Export TTL | Token age < 5 000 ms for EXPORT |
| P7 | Auto-lock | SIGN or EXPORT → vault transitions to LOCKED |
| DF1 | Seed confinement | seed flows only to signEthTx / seedToAddress / memory_zero |
| DF2 | Seed no-exfil | seed never flows to network / localStorage / console / clipboard |
| DF3 | Private key confinement | Same restrictions as seed |
| DF4 | R confinement | R flows only to deriveKey / memory_zero |
| DF5 | Address clipboard gate | Address to clipboard only on explicit user gesture |
| DF6 | TX broadcast gate | signed_tx to network only after bio_gate + user_confirm |
| DF7 | Mnemonic display only | mnemonic never leaves local_display |
| DF8 | Mandatory zero after use | All SENSITIVE data zeroed after use |
| DF9 | Lock clears sensitive | LOCKED state ⟹ seed, private_key, R all ZEROED |

Formal Z3 proof: `tests/verify_biowallet.py`
