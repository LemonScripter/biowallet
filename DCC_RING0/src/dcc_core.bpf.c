// SPDX-License-Identifier: GPL-2.0
// DCC Ring 0 — Fázis 8+9: Intent Binding + Atomi Tranzakció
//
// Programok (6 db, változatlan):
//   1. dcc_causality_monitor  raw_tp/input_event       → IRQ token + op_class + tx init
//   2. dcc_fork_inherit        raw_tp/sched_process_fork → token örökítés
//   3. dcc_axiom_validator     lsm/file_permission       → írás védelem (Phase 8+9)
//   4. dcc_read_guard          lsm/file_open             → olvasás védelem
//   5. dcc_network_guard       lsm/socket_connect        → hálózat védelem
//   6. dcc_exec_guard          lsm/bprm_check_security   → exec védelem
//
// CHALLENGE PARITÁS (Axiom_Validator.js + Virtual_CPU.js):
//   Phase 8 — Intent Binding:
//     op_class a tokenben rögzíti a SZÁNDÉKOLT operáció típusát
//     file_axiom_map: fájlnév → engedélyezett op_class bitmask
//     AXIOM_MISMATCH ha a fájl axiomája nem egyezik a token op_class-ával
//
//   Phase 9 — Atomi Tranzakció (IDLE→LOCKED→STAGED/ROLLBACK):
//     tx_map: per-PID tranzakciós állapot
//     első írás: token elfogyaszt → inode kötés → TX_STAGED
//     ugyanaz az inode, TX_STAGED: SAT (multi-write engedélyezett)
//     KÜLÖNBÖZŐ inode, TX_STAGED: TX_ROLLBACK — mindig -1, soha nem konfigurálható
//     TOCTOU zárás: autonóm pivotelás más célra deterministikusan blokkolva
//
//   Virtual_CPU.js AUTONOMOUS = always false → itt: nincs IRQ → nincs token → BLOCK

#include "vmlinux.h"
#include <bpf/bpf_helpers.h>
#include <bpf/bpf_tracing.h>
#include <bpf/bpf_core_read.h>

// ─────────────────────────────────────────────
// Verdict kódok
// ─────────────────────────────────────────────
#define VERDICT_SAT              1
#define VERDICT_NO_TOKEN         2
#define VERDICT_EXPIRED          3
#define VERDICT_CONSUMED         4
#define VERDICT_AXIOM            5
#define VERDICT_WHITELISTED      6
#define VERDICT_TOKEN_INHERITED  7
#define VERDICT_READ_BLOCKED     8
#define VERDICT_NET_BLOCKED      9
#define VERDICT_EXEC_BLOCKED    10
#define VERDICT_TX_ROLLBACK     11   // Phase 9: TOCTOU — mindig hard block
#define VERDICT_AXIOM_MISMATCH  12   // Phase 8: op_class ≠ file axiom

// Guard módok
#define GUARD_OFF    0
#define GUARD_LOG    1
#define GUARD_BLOCK  2

// Phase 8 — op_class bitek (bitmask)
#define OP_WRITE  (1u << 0)
#define OP_NET    (1u << 1)
#define OP_EXEC   (1u << 2)
#define OP_ANY    0xFFu      // minden operáció engedélyezett
#define OP_BLOCK  0x00u      // minden operáció tiltott

// Phase 9 — tranzakciós állapotok
#define TX_IDLE    0
#define TX_LOCKED  1
#define TX_STAGED  2

#define CAUSALITY_WINDOW_NS  500000000ULL
#define MAX_FORK_GENERATION  3

// ─────────────────────────────────────────────
// Struktúrák
// ─────────────────────────────────────────────

struct causal_token {
    __u64 timestamp_ns;
    __u32 pid;
    __u32 consumed;
    char  comm[16];
    __u8  generation;
    __u8  op_class;     // Phase 8: milyen operációra szól
    __u8  _pad[2];
};

struct audit_event {
    __u64 timestamp_ns;
    __u32 pid;
    __u32 verdict;
    char  comm[16];
    __u8  extra;
    __u8  _pad[3];
};

struct config_t {
    __u32 log_only;
    __u32 read_guard;
    __u32 net_guard;
    __u32 exec_guard;
};

// Phase 9 — per-PID atomi tranzakció állapot
struct tx_state {
    __u8  state;         // TX_IDLE / TX_LOCKED / TX_STAGED
    __u8  _pad[7];
    __u64 lock_time_ns;
    __u64 bound_ino;     // inode kötés (TOCTOU)
};

// ─────────────────────────────────────────────
// BPF Maps
// ─────────────────────────────────────────────

struct {
    __uint(type, BPF_MAP_TYPE_HASH);
    __uint(max_entries, 4096);
    __type(key,   __u32);
    __type(value, struct causal_token);
} token_map SEC(".maps");

struct {
    __uint(type, BPF_MAP_TYPE_ARRAY);
    __uint(max_entries, 1);
    __type(key,   __u32);
    __type(value, struct config_t);
} config_map SEC(".maps");

struct {
    __uint(type, BPF_MAP_TYPE_RINGBUF);
    __uint(max_entries, 1 << 20);
} audit_buf SEC(".maps");

struct {
    __uint(type, BPF_MAP_TYPE_ARRAY);
    __uint(max_entries, 1);
    __type(key,   __u32);
    __type(value, __u32);
} loader_pid_map SEC(".maps");

struct {
    __uint(type, BPF_MAP_TYPE_HASH);
    __uint(max_entries, 256);
    __type(key,   char[16]);
    __type(value, __u32);
} whitelist_map SEC(".maps");

struct {
    __uint(type, BPF_MAP_TYPE_HASH);
    __uint(max_entries, 64);
    __type(key,   char[16]);
    __type(value, __u32);
} exec_whitelist_map SEC(".maps");

struct {
    __uint(type, BPF_MAP_TYPE_PERCPU_ARRAY);
    __uint(max_entries, 1);
    __type(key,   __u32);
    __type(value, char[32]);
} exec_scratch_map SEC(".maps");

// Phase 8: fájlnév → engedélyezett op_class bitmask
// 0xFF=bármely, 0x00=mindig tiltott, 0x01=csak OP_WRITE stb.
struct {
    __uint(type, BPF_MAP_TYPE_HASH);
    __uint(max_entries, 64);
    __type(key,   char[16]);
    __type(value, __u32);
} file_axiom_map SEC(".maps");

// Phase 9: per-PID atomi tranzakció
struct {
    __uint(type, BPF_MAP_TYPE_HASH);
    __uint(max_entries, 4096);
    __type(key,   __u32);
    __type(value, struct tx_state);
} tx_map SEC(".maps");

// ─────────────────────────────────────────────
// Segédfüggvények
// ─────────────────────────────────────────────

static __always_inline void emit_ex(__u32 pid, __u32 verdict, __u8 extra)
{
    struct audit_event *ev = bpf_ringbuf_reserve(&audit_buf, sizeof(*ev), 0);
    if (!ev) return;
    ev->timestamp_ns = bpf_ktime_get_ns();
    ev->pid     = pid;
    ev->verdict = verdict;
    ev->extra   = extra;
    bpf_get_current_comm(ev->comm, sizeof(ev->comm));
    bpf_ringbuf_submit(ev, 0);
}

static __always_inline void emit(__u32 pid, __u32 verdict)
{
    emit_ex(pid, verdict, 0);
}

static __always_inline int is_loader_self(__u32 pid)
{
    __u32 key = 0;
    __u32 *lp = bpf_map_lookup_elem(&loader_pid_map, &key);
    if (!lp || *lp == 0) return 0;
    return (pid == *lp) ? 1 : 0;
}

static __always_inline struct config_t *get_config(void)
{
    __u32 key = 0;
    return bpf_map_lookup_elem(&config_map, &key);
}

static __always_inline int check_whitelist(__u32 pid)
{
    char comm[16] = {};
    bpf_get_current_comm(comm, sizeof(comm));
    __u32 *wl = bpf_map_lookup_elem(&whitelist_map, comm);
    if (wl && *wl == 1) {
        emit(pid, VERDICT_WHITELISTED);
        return 1;
    }
    return 0;
}

// Phase 8: file axiom ellenőrzés
// 0=pass, -1=BLOCKED fájl, -2=op_class mismatch
static __always_inline int check_file_axiom(struct file *file, __u8 op_class)
{
    const char *dname = BPF_CORE_READ(file, f_path.dentry, d_name.name);
    char fname[16] = {};
    bpf_probe_read_kernel_str(fname, sizeof(fname), dname);

    __u32 *allowed = bpf_map_lookup_elem(&file_axiom_map, fname);
    if (!allowed) return 0;                          // nincs bejegyzés → pass
    if (*allowed == OP_BLOCK) return -1;             // BLOCKED fájl
    if (!(*allowed & ((__u32)op_class))) return -2;  // op_class nem egyezik
    return 0;
}

// Phase 9: DCC kauzális lánc + inode kötés
// Visszatérés: 0=allow, -1=block
static __always_inline int check_dcc_chain_tx(__u32 pid, int blocking, __u64 ino)
{
    struct causal_token *tok = bpf_map_lookup_elem(&token_map, &pid);
    if (!tok) {
        emit(pid, VERDICT_NO_TOKEN);
        return blocking ? -1 : 0;
    }

    __u64 age = bpf_ktime_get_ns() - tok->timestamp_ns;
    if (age > CAUSALITY_WINDOW_NS) {
        emit(pid, VERDICT_EXPIRED);
        bpf_map_delete_elem(&tx_map, &pid);
        return blocking ? -1 : 0;
    }

    if (tok->consumed) {
        // Token elfogyasztott — de ha ugyanarra az inode-ra ír, multi-write SAT
        struct tx_state *tx = bpf_map_lookup_elem(&tx_map, &pid);
        if (tx && tx->state == TX_STAGED && tx->bound_ino != 0 && tx->bound_ino == ino) {
            emit(pid, VERDICT_SAT);
            return 0;
        }
        emit(pid, VERDICT_CONSUMED);
        return blocking ? -1 : 0;
    }

    // Első írás: token elfogyasztása + TX_STAGED + inode kötés
    tok->consumed = 1;
    bpf_map_update_elem(&token_map, &pid, tok, BPF_EXIST);

    struct tx_state tx_new = {};
    tx_new.state        = TX_STAGED;
    tx_new.lock_time_ns = tok->timestamp_ns;
    tx_new.bound_ino    = ino;
    bpf_map_update_elem(&tx_map, &pid, &tx_new, BPF_ANY);

    emit(pid, VERDICT_SAT);
    return 0;
}

// ─────────────────────────────────────────────
// PROGRAM 1: Causality Monitor  [Phase 8: +op_class, Phase 9: +tx init]
// ─────────────────────────────────────────────
SEC("raw_tp/input_event")
int BPF_PROG(dcc_causality_monitor,
             void *dev, unsigned int type, unsigned int code, int value)
{
    if (type != 1 || value != 1) return 0;

    __u32 pid = bpf_get_current_pid_tgid() >> 32;
    if (is_loader_self(pid)) return 0;

    // Phase 8: op_class — billentyűzet (code<256) → WRITE+NET+EXEC szándék
    __u8 op_class = (code < 256) ? (OP_WRITE | OP_NET | OP_EXEC) : OP_ANY;

    struct causal_token tok = {
        .timestamp_ns = bpf_ktime_get_ns(),
        .pid          = pid,
        .consumed     = 0,
        .generation   = 0,
        .op_class     = op_class,
    };
    bpf_get_current_comm(tok.comm, sizeof(tok.comm));
    bpf_map_update_elem(&token_map, &pid, &tok, BPF_ANY);

    // Phase 9: tranzakció LOCKED állapotba
    struct tx_state tx = {};
    tx.state        = TX_LOCKED;
    tx.lock_time_ns = tok.timestamp_ns;
    tx.bound_ino    = 0;
    bpf_map_update_elem(&tx_map, &pid, &tx, BPF_ANY);

    emit(pid, VERDICT_SAT);
    return 0;
}

// ─────────────────────────────────────────────
// PROGRAM 2: Fork Inherit  [Phase 8: op_class öröklés]
// ─────────────────────────────────────────────
SEC("raw_tp/sched_process_fork")
int BPF_PROG(dcc_fork_inherit,
             struct task_struct *parent, struct task_struct *child)
{
    __u32 parent_pid = BPF_CORE_READ(parent, tgid);
    __u32 child_pid  = BPF_CORE_READ(child,  tgid);
    if (parent_pid == child_pid) return 0;

    struct causal_token *ptok = bpf_map_lookup_elem(&token_map, &parent_pid);
    if (!ptok) return 0;

    __u64 age = bpf_ktime_get_ns() - ptok->timestamp_ns;
    if (age > CAUSALITY_WINDOW_NS) return 0;
    if (ptok->consumed) return 0;
    if (ptok->generation >= MAX_FORK_GENERATION) return 0;

    struct causal_token child_tok = {};
    child_tok.timestamp_ns = ptok->timestamp_ns;
    child_tok.pid          = child_pid;
    child_tok.consumed     = 0;
    child_tok.generation   = ptok->generation + 1;
    child_tok.op_class     = ptok->op_class;
    bpf_probe_read_kernel(child_tok.comm, sizeof(child_tok.comm), ptok->comm);

    bpf_map_update_elem(&token_map, &child_pid, &child_tok, BPF_ANY);
    emit_ex(child_pid, VERDICT_TOKEN_INHERITED, ptok->generation + 1);
    return 0;
}

// ─────────────────────────────────────────────
// PROGRAM 3: Axiom Validator  [Phase 8+9: teljes challenge paritás]
// lsm/file_permission — írás védelem
//
// Sorrend:
//   1. Loader/whitelist bypass
//   2. TOCTOU check (TX_STAGED + más inode → mindig -1)
//   3. File Axiom check (op_class vs fájlnév)
//   4. DCC kauzális lánc + inode kötés
// ─────────────────────────────────────────────
SEC("lsm/file_permission")
int BPF_PROG(dcc_axiom_validator, struct file *file, int mask)
{
    if (!(mask & 2)) return 0;

    __u32 pid = bpf_get_current_pid_tgid() >> 32;
    if (is_loader_self(pid)) return 0;

    struct config_t *cfg = get_config();
    int blocking = (cfg && cfg->log_only == 0) ? 1 : 0;

    __u64 ino = BPF_CORE_READ(file, f_inode, i_ino);

    /* Phase 8: OP_BLOCK — direct lookup, overrides whitelist (challenge BIO 0xDEAD) */
    {
        const char *dn0 = BPF_CORE_READ(file, f_path.dentry, d_name.name);
        char fn0[16] = {};
        bpf_probe_read_kernel_str(fn0, sizeof(fn0), dn0);
        __u32 *ax0 = bpf_map_lookup_elem(&file_axiom_map, fn0);
        if (ax0 && *ax0 == 0) {  /* OP_BLOCK = 0x00 */
            emit_ex(pid, VERDICT_AXIOM_MISMATCH, 0);
            return blocking ? -1 : 0;
        }
    }

    if (check_whitelist(pid)) return 0;


    // ── Phase 9: TOCTOU — deterministikus hard block ──
    struct tx_state *tx = bpf_map_lookup_elem(&tx_map, &pid);
    if (tx && tx->state == TX_STAGED && tx->bound_ino != 0 && tx->bound_ino != ino) {
        emit_ex(pid, VERDICT_TX_ROLLBACK, 0);
        struct tx_state reset = {};
        bpf_map_update_elem(&tx_map, &pid, &reset, BPF_ANY);
        return -1;  // MINDIG -1, nincs config bypass
    }

    // ── Phase 8: File Axiom ──
    struct causal_token *tok = bpf_map_lookup_elem(&token_map, &pid);
    __u8 op_class = tok ? tok->op_class : 0;

    int ar = check_file_axiom(file, op_class);
    if (ar == -1) {
        emit_ex(pid, VERDICT_AXIOM_MISMATCH, 0);
        return blocking ? -1 : 0;
    }
    if (ar == -2) {
        emit_ex(pid, VERDICT_AXIOM_MISMATCH, 0);
        return blocking ? -1 : 0;
    }

    // ── Phase 7→9: DCC + inode kötés ──
    return check_dcc_chain_tx(pid, blocking, ino);
}

// ─────────────────────────────────────────────
// PROGRAM 4: Read Guard  [Phase 6a, változatlan]
// ─────────────────────────────────────────────
SEC("lsm/file_open")
int BPF_PROG(dcc_read_guard, struct file *file)
{
    int flags = BPF_CORE_READ(file, f_flags);
    if ((flags & 3) != 0) return 0;

    struct config_t *cfg = get_config();
    if (!cfg || cfg->read_guard == GUARD_OFF) return 0;

    __u32 pid = bpf_get_current_pid_tgid() >> 32;
    if (is_loader_self(pid)) return 0;
    if (check_whitelist(pid)) return 0;

    int blocking = (cfg->read_guard == GUARD_BLOCK) ? 1 : 0;

    struct causal_token *tok = bpf_map_lookup_elem(&token_map, &pid);
    if (!tok) { emit_ex(pid, VERDICT_READ_BLOCKED, 1); return blocking ? -1 : 0; }
    __u64 age = bpf_ktime_get_ns() - tok->timestamp_ns;
    if (age > CAUSALITY_WINDOW_NS) { emit_ex(pid, VERDICT_READ_BLOCKED, 1); return blocking ? -1 : 0; }
    emit_ex(pid, VERDICT_SAT, 1);
    return 0;
}

// ─────────────────────────────────────────────
// PROGRAM 5: Network Guard  [Phase 6b, változatlan]
// ─────────────────────────────────────────────
SEC("lsm/socket_connect")
int BPF_PROG(dcc_network_guard,
             struct socket *sock, struct sockaddr *address, int addrlen)
{
    struct config_t *cfg = get_config();
    if (!cfg || cfg->net_guard == GUARD_OFF) return 0;

    __u32 pid = bpf_get_current_pid_tgid() >> 32;
    if (is_loader_self(pid)) return 0;
    if (check_whitelist(pid)) return 0;

    int blocking = (cfg->net_guard == GUARD_BLOCK) ? 1 : 0;

    struct causal_token *tok = bpf_map_lookup_elem(&token_map, &pid);
    if (!tok) { emit_ex(pid, VERDICT_NET_BLOCKED, 2); return blocking ? -1 : 0; }
    __u64 age = bpf_ktime_get_ns() - tok->timestamp_ns;
    if (age > CAUSALITY_WINDOW_NS) { emit_ex(pid, VERDICT_NET_BLOCKED, 2); return blocking ? -1 : 0; }
    emit_ex(pid, VERDICT_SAT, 2);
    return 0;
}

// ─────────────────────────────────────────────
// PROGRAM 6: Exec Guard  [Phase 6c/7, változatlan]
// ─────────────────────────────────────────────
SEC("lsm/bprm_check_security")
int BPF_PROG(dcc_exec_guard, struct linux_binprm *bprm)
{
    struct config_t *cfg = get_config();
    if (!cfg || cfg->exec_guard == GUARD_OFF) return 0;

    __u32 pid = bpf_get_current_pid_tgid() >> 32;
    if (is_loader_self(pid)) return 0;

    {
        __u32 sc_key = 0;
        char *path = bpf_map_lookup_elem(&exec_scratch_map, &sc_key);
        if (path) {
            bpf_probe_read_kernel_str(path, 32, BPF_CORE_READ(bprm, filename));
            int base = 0;
            for (int i = 0; i < 31; i++) {
                if (!path[i]) break;
                if (path[i] == '/') base = i + 1;
            }
            char tgt[16] = {};
            for (int i = 0; i < 16; i++) {
                int idx = base + i;
                if (idx < 0 || idx >= 32) break;
                char c = path[idx];
                if (!c) break;
                tgt[i] = c;
            }
            __u32 *wl = bpf_map_lookup_elem(&exec_whitelist_map, tgt);
            if (wl && *wl == 1) { emit(pid, VERDICT_WHITELISTED); return 0; }
        }
    }

    if (check_whitelist(pid)) return 0;

    int blocking = (cfg->exec_guard == GUARD_BLOCK) ? 1 : 0;
    struct causal_token *tok = bpf_map_lookup_elem(&token_map, &pid);
    if (!tok) { emit_ex(pid, VERDICT_EXEC_BLOCKED, 3); return blocking ? -1 : 0; }
    __u64 age = bpf_ktime_get_ns() - tok->timestamp_ns;
    if (age > CAUSALITY_WINDOW_NS) { emit_ex(pid, VERDICT_EXEC_BLOCKED, 3); return blocking ? -1 : 0; }
    emit_ex(pid, VERDICT_SAT, 3);
    return 0;
}

char LICENSE[] SEC("license") = "GPL";
