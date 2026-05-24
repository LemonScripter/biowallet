# Deferred / Future Validation Tasks

These items were identified as valuable but deliberately excluded from the initial
implementation due to complexity or toolchain requirements.

---

## DEFERRED-1: Syzkaller Integration

**What:** Automated kernel syscall fuzzer directed at the DCC LSM hooks.
**Why deferred:** Requires a dedicated VM with syzbot config, significant setup overhead.
**Expected value:** Coverage of edge cases in BPF verifier path and LSM hook interactions.
**When to revisit:** After Phase 11 (systemd service) is stable.

---

## DEFERRED-2: Isabelle/HOL Formal Proof

**What:** Machine-checked proof that the `.bio` invariants (I1–I6) are preserved
         by the BPF implementation, using Isabelle/HOL with a C semantics model.
**Why deferred:** Requires translating the BPF C semantics into Isabelle — substantial effort.
**Expected value:** TRL-5 → TRL-6 certification evidence for avionics/medical use.
**When to revisit:** After Z3 differential (current) is published.

---

## DEFERRED-3: T19 — Namespace / Cgroup Attack

**What:** Attacker creates a new user namespace, gains CAP_BPF within it,
         attempts to load a competing BPF program that bypasses DCC.
**Why deferred:** Requires kernel 6.5+ namespace + CAP_BPF interaction testing.
**Expected value:** Documents whether user namespaces allow BPF map tampering.
**When to revisit:** After T13 (axiom map tamper) results are analyzed.

---

## DEFERRED-4: T20 — eBPF Verifier Bypass via BTF Type Confusion

**What:** Craft a BPF program that passes the verifier but reads/writes
         `token_map` entries out-of-bounds via BTF type confusion.
**Why deferred:** Requires deep BPF verifier knowledge; likely kernel-version specific.
**When to revisit:** If a relevant CVE is published for the running kernel.
