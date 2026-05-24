#!/usr/bin/env python3
"""
DCC Ring 0 — Validation Runner
Runs T01-T13 attack tests, produces a structured report.

Usage (on Tokyo server):
  cd DCC_RING0/validation
  sudo python3 runner/run_attacks.py [--filter T01,T05] [--json] [--no-kernel]

Prerequisites:
  - DCC BPF programs loaded in BLOCKING mode (dcc_loader ... --blocking)
  - /tmp/dcc_inject compiled: gcc -O2 -o /tmp/dcc_inject injector/dcc_inject.c
  - bpftool in PATH
  - Run as root (required for bpftool map updates)
"""

import argparse
import importlib
import json
import os
import sys
import time
from pathlib import Path

# Make sub-packages importable
sys.path.insert(0, str(Path(__file__).parent.parent))

from oracle.bio_semantics import BioSemanticsOracle, OP_BLOCK
from attacks.base import AttackBase, AttackResult, AttackOutcome

# ── Attack registry ───────────────────────────────────────────────────────────

ATTACKS = [
    ("t01_no_irq_write",      "T01_NoIrqWrite"),
    ("t02_expired_token",     "T02_ExpiredToken"),
    ("t03_blocked_file",      "T03_BlockedFile"),
    ("t04_op_class_mismatch", "T04_OpClassMismatch"),
    ("t05_toctou",            "T05_TOCTOU"),
    ("t06_double_consume",    "T06_DoubleConsume"),
    ("t07_fork_inherit",      "T07_ForkInheritLimit"),
    ("t08_whitelist_comm_spoof", "T08_CommSpoof"),
    ("t09_pid_recycle",       "T09_PidRecycle"),
    ("t10_map_flood",         "T10_MapFlood"),
    ("t11_log_only_bypass",   "T11_LogOnlyBypass"),
    ("t12_multi_irq_race",    "T12_MultiIrqRace"),
    ("t13_axiom_map_tamper",  "T13_AxiomMapTamper"),
]


def load_attack_class(module_name: str, class_name: str):
    mod = importlib.import_module(f"attacks.{module_name}")
    return getattr(mod, class_name)


def run_all(
    filter_ids: list[str] | None,
    injector: str,
    bpftool: str,
    kernel_enabled: bool,
) -> list[AttackResult]:
    oracle = BioSemanticsOracle()
    oracle.set_file_axiom("bio_memory.jso", OP_BLOCK)   # default protected file
    oracle.add_whitelist("bash")
    oracle.add_whitelist("python3")
    oracle.add_whitelist("sshd")

    results = []
    for module_name, class_name in ATTACKS:
        cls = load_attack_class(module_name, class_name)
        instance: AttackBase = cls(
            oracle=oracle,
            injector_bin=injector if kernel_enabled else "/dev/null/nonexistent",
            bpftool=bpftool if kernel_enabled else "/dev/null/nonexistent",
        )
        if filter_ids and instance.ATTACK_ID not in filter_ids:
            continue

        print(f"  Running {instance.ATTACK_ID} {instance.ATTACK_NAME}...", end="", flush=True)
        result = instance.run()
        print(f" {result.outcome.value}")
        results.append(result)

    return results


def print_report(results: list[AttackResult], as_json: bool) -> None:
    if as_json:
        data = [
            {
                "id":           r.attack_id,
                "name":         r.attack_name,
                "outcome":      r.outcome.value,
                "oracle":       r.oracle_verdict,
                "kernel_errno": r.kernel_verdict,
                "detail":       r.detail,
                "duration_ms":  round(r.duration_ms, 1),
                "violations":   r.invariants_violated,
            }
            for r in results
        ]
        print(json.dumps(data, indent=2))
        return

    passed   = [r for r in results if r.outcome == AttackOutcome.BLOCKED]
    bypassed = [r for r in results if r.outcome == AttackOutcome.BYPASSED]
    mismatches = [r for r in results if r.outcome == AttackOutcome.ORACLE_MISMATCH]
    errors   = [r for r in results if r.outcome == AttackOutcome.ERROR]
    skipped  = [r for r in results if r.outcome == AttackOutcome.SKIPPED]

    print()
    print("=" * 70)
    print(f"DCC Ring 0 — Attack Validation Report  {time.strftime('%Y-%m-%d %H:%M:%S')}")
    print("=" * 70)
    for r in results:
        print(r.summary_line())
    print("-" * 70)
    print(f"Total: {len(results)}  |  BLOCKED: {len(passed)}  |  BYPASSED: {len(bypassed)}  "
          f"|  MISMATCH: {len(mismatches)}  |  ERROR: {len(errors)}  |  SKIPPED: {len(skipped)}")
    print("=" * 70)

    if bypassed:
        print("\nBYPASSED (real bugs):")
        for r in bypassed:
            print(f"  {r.attack_id}: {r.detail}")
            if r.invariants_violated:
                print(f"    Invariants violated: {', '.join(r.invariants_violated)}")

    if mismatches:
        print("\nORACLE MISMATCHES (oracle vs kernel disagree):")
        for r in mismatches:
            print(f"  {r.attack_id}: {r.detail}")


def main():
    p = argparse.ArgumentParser(description="DCC Ring 0 Attack Validator")
    p.add_argument("--filter",     help="Comma-separated attack IDs to run, e.g. T01,T05")
    p.add_argument("--json",       action="store_true", help="Output JSON report")
    p.add_argument("--no-kernel",  action="store_true", help="Oracle-only (no kernel calls)")
    p.add_argument("--injector",   default="/tmp/dcc_inject", help="Path to dcc_inject binary")
    p.add_argument("--bpftool",    default="bpftool", help="bpftool command")
    args = p.parse_args()

    filter_ids = [x.strip().upper() for x in args.filter.split(",")] if args.filter else None

    if not args.json:
        print("DCC Ring 0 Attack Validation")
        if args.no_kernel:
            print("  Mode: Oracle-only (kernel tests skipped)")
        else:
            print(f"  Injector: {args.injector}")
            print(f"  bpftool:  {args.bpftool}")
        print()

    results = run_all(
        filter_ids=filter_ids,
        injector=args.injector,
        bpftool=args.bpftool,
        kernel_enabled=not args.no_kernel,
    )

    print_report(results, as_json=args.json)

    # Exit 1 if any real bypasses found
    bypasses = [r for r in results if r.outcome == AttackOutcome.BYPASSED]
    sys.exit(1 if bypasses else 0)


if __name__ == "__main__":
    main()
