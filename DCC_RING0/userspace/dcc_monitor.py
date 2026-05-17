#!/usr/bin/env python3
"""
DCC Ring 0 — Audit Monitor (userspace daemon)

A BPF ring buffer-ből olvassa a kernel eBPF programok által generált
audit eseményeket és real-time megjeleníti.

Futtatás: sudo python3 dcc_monitor.py
"""

import ctypes
import os
import sys
import time
from collections import defaultdict

try:
    from bpf import BPF  # bcc Python bindings
    USE_BCC = True
except ImportError:
    USE_BCC = False
    print("[WARN] bcc not available, using raw ring buffer read")

VERDICT_NAMES = {
    1: "UNSAT:NO_TOKEN",
    2: "UNSAT:EXPIRED",
    3: "UNSAT:CONSUMED",
    4: "UNSAT:AXIOM_VIOLATION",
    5: "SAT",
}

COLORS = {
    "SAT":   "\033[92m",   # zöld
    "UNSAT": "\033[91m",   # piros
    "RESET": "\033[0m",
}

stats = defaultdict(int)


def color_verdict(verdict_str):
    if verdict_str.startswith("SAT"):
        return f"{COLORS['SAT']}{verdict_str}{COLORS['RESET']}"
    return f"{COLORS['UNSAT']}{verdict_str}{COLORS['RESET']}"


def handle_event(cpu, data, size):
    class AuditEvent(ctypes.Structure):
        _fields_ = [
            ("timestamp_ns", ctypes.c_uint64),
            ("pid",          ctypes.c_uint32),
            ("verdict",      ctypes.c_uint32),
            ("comm",         ctypes.c_char * 16),
        ]

    event = ctypes.cast(data, ctypes.POINTER(AuditEvent)).contents
    verdict_str = VERDICT_NAMES.get(event.verdict, f"UNKNOWN({event.verdict})")
    comm = event.comm.decode(errors="replace").rstrip("\x00")
    ts = time.strftime("%H:%M:%S")

    stats[verdict_str] += 1
    print(f"[{ts}] {color_verdict(verdict_str):40s} pid={event.pid:<6} comm={comm}")


def print_stats():
    print("\n--- DCC Audit Summary ---")
    for verdict, count in sorted(stats.items()):
        print(f"  {verdict:35s}: {count}")
    print()


def main():
    if os.geteuid() != 0:
        print("ERROR: sudo szükséges a BPF ring buffer olvasásához")
        sys.exit(1)

    print("DCC Ring 0 Audit Monitor — Ctrl+C to stop")
    print("LOG-ONLY mód: csak megfigyelés, nincs blokkolás\n")

    if USE_BCC:
        bpf = BPF(src_file="../src/dcc_axiom.bpf.c")
        bpf["audit_buf"].open_ring_buffer(handle_event)
        try:
            while True:
                bpf.ring_buffer_consume()
                time.sleep(0.01)
        except KeyboardInterrupt:
            print_stats()
    else:
        print("bcc nem elérhető. Telepítsd: sudo apt install python3-bpfcc")
        sys.exit(1)


if __name__ == "__main__":
    main()
