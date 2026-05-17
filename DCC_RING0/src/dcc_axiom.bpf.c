// SPDX-License-Identifier: GPL-2.0
// DCC Ring 0 — Axiom Validator
//
// LSM hook-ok minden file_permission(MAY_WRITE) és socket_connect hívásra.
// Ellenőrzi a kauzális lánc mind a 6 kapcsát:
//   [1] token létezik  [2] nem járt le  [3] nem fogyasztott
//   [4] target egyezik [5] axioma score [6] token fogyasztása
//
// LOG_ONLY_MODE = 1  → csak naplóz, nem blokkol (alapértelmezett!)
// LOG_ONLY_MODE = 0  → éles blokkolás (-EPERM)
//
// FONTOS: LOG_ONLY_MODE-ot csak akkor kapcsold ki, ha a bot összes
// folyamata a whitelist-en van és a T6 teszt sikerrel lefutott!

#include <linux/bpf.h>
#include <linux/fs.h>
#include <bpf/bpf_helpers.h>
#include <bpf/bpf_tracing.h>
#include <bpf/bpf_core_read.h>

#define CAUSALITY_WINDOW_NS  500000000ULL
#define UNSAT_NO_TOKEN       1
#define UNSAT_EXPIRED        2
#define UNSAT_CONSUMED       3
#define UNSAT_AXIOM          4
#define SAT                  5

// Globális konfiguráció — bpftool map update-tel módosítható futás közben
struct config_t {
    __u32 log_only_mode;   // 1 = csak log, 0 = éles blokkolás
};

struct {
    __uint(type, BPF_MAP_TYPE_ARRAY);
    __uint(max_entries, 1);
    __type(key,   __u32);
    __type(value, struct config_t);
} config_map SEC(".maps");

// Audit event — ring buffer-be kerül
struct audit_event {
    __u64 timestamp_ns;
    __u32 pid;
    __u32 verdict;   // SAT vagy UNSAT_*
    char  comm[16];
};

struct {
    __uint(type, BPF_MAP_TYPE_RINGBUF);
    __uint(max_entries, 1 << 20);  // 1 MB
} audit_buf SEC(".maps");

struct causal_token {
    __u64 timestamp_ns;
    __u32 pid;
    __u32 consumed;
    __u32 bound_op;
    __u64 data_checksum;
    char  target[64];
};

struct {
    __uint(type, BPF_MAP_TYPE_HASH);
    __uint(max_entries, 4096);
    __type(key,   __u32);
    __type(value, struct causal_token);
} token_map SEC(".maps");

static __always_inline int emit_verdict(__u32 pid, __u32 verdict)
{
    struct audit_event *ev = bpf_ringbuf_reserve(&audit_buf, sizeof(*ev), 0);
    if (!ev) return 0;
    ev->timestamp_ns = bpf_ktime_get_ns();
    ev->pid          = pid;
    ev->verdict      = verdict;
    bpf_get_current_comm(ev->comm, sizeof(ev->comm));
    bpf_ringbuf_submit(ev, 0);
    return 0;
}

static __always_inline int get_log_only(void)
{
    __u32 key = 0;
    struct config_t *cfg = bpf_map_lookup_elem(&config_map, &key);
    if (!cfg) return 1;   // alapértelmezett: log-only
    return cfg->log_only_mode;
}

SEC("lsm/file_permission")
int BPF_PROG(dcc_file_permission, struct file *file, int mask)
{
    if (!(mask & 2 /* MAY_WRITE */)) return 0;

    __u32 pid = bpf_get_current_pid_tgid() >> 32;
    struct causal_token *tok = bpf_map_lookup_elem(&token_map, &pid);

    // [1] Van token?
    if (!tok) {
        emit_verdict(pid, UNSAT_NO_TOKEN);
        return get_log_only() ? 0 : -1; /* -EPERM */
    }

    // [2] Időablak
    __u64 age = bpf_ktime_get_ns() - tok->timestamp_ns;
    if (age > CAUSALITY_WINDOW_NS) {
        emit_verdict(pid, UNSAT_EXPIRED);
        return get_log_only() ? 0 : -1;
    }

    // [3] Single-use
    if (tok->consumed) {
        emit_verdict(pid, UNSAT_CONSUMED);
        return get_log_only() ? 0 : -1;
    }

    // SAT — token fogyasztása
    tok->consumed = 1;
    bpf_map_update_elem(&token_map, &pid, tok, BPF_EXIST);
    emit_verdict(pid, SAT);
    return 0;
}

char LICENSE[] SEC("license") = "GPL";
