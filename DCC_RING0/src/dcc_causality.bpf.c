// SPDX-License-Identifier: GPL-2.0
// DCC Ring 0 — Causality Monitor
//
// Minden valódi kernel input eseménynél (EV_KEY press) causal tokent generál
// és a token_map BPF map-be írja [pid → token].
//
// A token CSAK valódi hardware IRQ-ból keletkezhet:
//   hardware IRQ → kernel input subsystem → evdev → ez a tracepoint
// Szoftveres event_generate() nem jut el idáig.

#include <linux/bpf.h>
#include <linux/input-event-codes.h>
#include <bpf/bpf_helpers.h>
#include <bpf/bpf_tracing.h>

#define CAUSALITY_WINDOW_NS  500000000ULL   // 500ms
#define MAX_TARGET_LEN       64

struct causal_token {
    __u64 timestamp_ns;     // bpf_ktime_get_ns() — hardver IRQ pillanata
    __u32 pid;              // melyik folyamathoz érkezett az IRQ
    __u32 consumed;         // single-use flag (0=szabad, 1=elfogyasztva)
    __u32 bound_op;         // kötött operáció kódja (0=szabad)
    __u64 data_checksum;    // kötött adat FNV-hash (0=nincs)
    char  target[MAX_TARGET_LEN];  // event source device neve
};

// token_map: pid → causal_token
struct {
    __uint(type, BPF_MAP_TYPE_HASH);
    __uint(max_entries, 4096);
    __type(key,   __u32);
    __type(value, struct causal_token);
} token_map SEC(".maps");

// raw_tp megközelítés: a kernel TRACE_EVENT TP_PROTO argumentumait kapjuk meg
// tisztán, struktúra-offset nélkül. Kernelben:
//   TRACE_EVENT(input_event, TP_PROTO(struct input_dev *dev,
//               unsigned int type, unsigned int code, int value), ...)
SEC("raw_tp/input_event")
int BPF_PROG(dcc_input_event, void *dev, unsigned int type,
             unsigned int code, int value)
{
    // Csak valódi key press (value==1), nem repeat (value==2)
    if (type != 1 /* EV_KEY */ || value != 1)
        return 0;

    __u32 pid = bpf_get_current_pid_tgid() >> 32;

    struct causal_token tok = {
        .timestamp_ns  = bpf_ktime_get_ns(),
        .pid           = pid,
        .consumed      = 0,
        .bound_op      = 0,
        .data_checksum = 0,
    };

    bpf_get_current_comm(tok.target, sizeof(tok.target));
    bpf_map_update_elem(&token_map, &pid, &tok, BPF_ANY);

    return 0;
}

char LICENSE[] SEC("license") = "GPL";
