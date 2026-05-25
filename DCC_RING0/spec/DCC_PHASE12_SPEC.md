# DCC Ring 0 — Phase 12 Specification
## Extended Causal Chain with Remote Physical Attestation

**Status:** PLANNED  
**Depends on:** Phase 11 (systemd service, stable 24h+)  
**Branch:** bio-kernel-emu

---

## Motivation

Phase 11 establishes a persistent DCC Ring 0 service on the Tokyo server. A
structural question then arises: if every privileged operation — including DCC
reconfiguration and BPF program management — requires a local hardware IRQ token,
authorized remote administration becomes impossible.

The solution is to extend the physical event set while preserving the causal
constitution's core invariant: *no operation proceeds without a physical human intent*.

---

## Extended Formal Model

```
P = LocalIRQ(server) ∪ AttestedRemote(owner)

AttestedRemote(owner) requires simultaneously:
  1. Physical    — hardware-bound device (FIDO2 key, TPM biometric)
                   private key cannot be extracted in software
  2. Authenticated — hardware-resident private key, replay-protected counter
  3. Origin-bound  — rpId/server-id encoded in the assertion
```

---

## Token Type Extension

```c
// New field: token_type
#define TOKEN_LOCAL_IRQ       0x01  // hardware IRQ on server
#define TOKEN_REMOTE_ATTESTED 0x02  // FIDO2/TPM-attested owner action

// New field: assurance_level
#define ASSURANCE_NONE      0
#define ASSURANCE_PASSWORD  1  // not accepted for privileged ops
#define ASSURANCE_OTP       2
#define ASSURANCE_HW_KEY    3  // minimum for privileged ops
#define ASSURANCE_BIOMETRIC 4
#define ASSURANCE_LOCAL_IRQ 5  // highest

struct causal_token {
    __u64 timestamp_ns;
    __u32 pid;
    __u8  consumed;
    __u8  token_type;       // NEW
    __u8  assurance_level;  // NEW
    __u8  op_class;
    char  comm[16];
    __u32 generation;
    __u64 attestation_id;   // NEW: FIDO2 assertion hash (0 = local IRQ)
};
```

---

## Operation Assurance Requirements

| Operation class          | Min. assurance level | Token types accepted          |
|--------------------------|---------------------|-------------------------------|
| File write (regular)     | 0 (any valid token)  | LOCAL_IRQ, REMOTE_ATTESTED    |
| BPF prog management      | 3 (HW_KEY)           | LOCAL_IRQ, REMOTE_ATTESTED≥3  |
| file_axiom_map reconfig  | 3 (HW_KEY)           | LOCAL_IRQ, REMOTE_ATTESTED≥3  |
| BPF map update (general) | 3 (HW_KEY)           | LOCAL_IRQ, REMOTE_ATTESTED≥3  |

---

## New BPF LSM Hooks (LOG_ONLY first)

```c
SEC("lsm/bpf_prog")
int dcc_bpf_prog_guard(struct bpf_prog *prog) {
    u32 pid = bpf_get_current_pid_tgid() >> 32;
    struct causal_token *tok = bpf_map_lookup_elem(&token_map, &pid);

    if (!tok || tok->consumed || tok->assurance_level < ASSURANCE_HW_KEY) {
        bpf_printk("DCC BPF_PROG_GUARD: pid=%u BLOCKED (no/low token)\n", pid);
        return 0;  // LOG_ONLY: return -EPERM in blocking mode
    }
    return 0;
}

SEC("lsm/bpf_map")
int dcc_bpf_map_guard(struct bpf_map *map, fmode_t fmode) {
    if (!(fmode & FMODE_WRITE)) return 0;  // read-only access allowed

    u32 pid = bpf_get_current_pid_tgid() >> 32;
    struct causal_token *tok = bpf_map_lookup_elem(&token_map, &pid);

    if (!tok || tok->consumed || tok->assurance_level < ASSURANCE_HW_KEY) {
        bpf_printk("DCC BPF_MAP_GUARD: pid=%u map_write BLOCKED\n", pid);
        return 0;  // LOG_ONLY: return -EPERM in blocking mode
    }
    return 0;
}
```

---

## dcc_rat_daemon — Remote Attested Token Daemon

```
Architecture:
  [Admin's device]
    → Windows Hello (TPM 2.0) or FIDO2 key tap
    → SSH with TPM-bound key (Windows 11 native TPM support)
    
  [Tokyo server: dcc_rat_daemon]
    → Receives SSH session metadata + attestation claim
    → Verifies: signature valid against registered owner pubkey
    → Verifies: counter monotonically increasing (replay protection)
    → Verifies: server_id matches expected value
    → If PASS: ioctl() → DCC kernel → token_map[ssh_pid] ← REMOTE_ATTESTED token
    → Token assurance_level = ASSURANCE_HW_KEY (3)
    
  [SSH session]
    → Now has a valid REMOTE_ATTESTED token
    → Can perform privileged BPF operations
    → Token expires after CAUSALITY_WINDOW_NS (500ms) or session end
```

---

## Implementation Phases (safe ordering)

### Phase 12a — LOG_ONLY BPF hooks (SAFE, no blocking)
- Add `dcc_bpf_prog_guard` and `dcc_bpf_map_guard` in LOG_ONLY mode
- Recompile `dcc_core.bpf.c`, reload `dcc-ring0.service`
- Verify: bpftool still works, bot untouched, SSH alive
- Check logs for BPF op events

### Phase 12b — TPM-bound SSH key (CAREFUL)
- Generate TPM-bound SSH key on Windows 11 (Windows Hello protected)
- Add to Tokyo `authorized_keys` IN PARALLEL (old key stays active)
- Test login with new key
- Only remove old key after 48h+ stable

### Phase 12c — dcc_rat_daemon (additive, no system impact)
- Write and deploy `dcc_rat_daemon.py`
- Test token issuance for SSH session PIDs
- Verify on_privileged_op() returns SAT for attested sessions

### Phase 12d — BPF hooks BLOCKING (ONLY after 12a/12b/12c stable)
- Switch LOG_ONLY → BLOCKING in dcc_bpf_prog_guard and dcc_bpf_map_guard
- ONLY with REMOTE_ATTESTED token path working (12c complete)
- ONLY with TPM SSH key verified (12b complete)
- Test: bpftool without token → EPERM
- Test: bpftool with REMOTE_ATTESTED token → allowed

---

## Critical Safety Rules

- **Bot: `/home/lszok/metaspace_bot/` SOHA NEM ÉRINTENDŐ**
- **Phase 12d only after 12a + 12b + 12c all stable**
- **Old SSH key stays in authorized_keys until 12b is 48h+ stable**
- **dcc-ring0.service: LOG_ONLY until explicit blocking mode decision**
- **Never remove sshd from whitelist**

---

## Oracle Coverage

New oracle methods (already implemented in `oracle/bio_semantics.py`):
- `issue_remote_attested_token(pid, comm, assurance_level, attestation_id)`
- `on_privileged_op(pid, comm)` — checks assurance_level ≥ ASSURANCE_HW_KEY

New verdict: `VERDICT_INSUFFICIENT_ASSURANCE = 13`

New test to add: `T14_RemoteAttestation` — verifies that:
1. Token with assurance_level < 3 → INSUFFICIENT_ASSURANCE on privileged op
2. Token with assurance_level ≥ 3 → SAT on privileged op
3. No token → NO_TOKEN on privileged op
