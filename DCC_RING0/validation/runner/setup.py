#!/usr/bin/env python3
"""
DCC Ring 0 Validation — Environment Setup
Run once before the attack suite to prepare the test environment.

Usage:
  cd DCC_RING0/validation
  sudo python3 runner/setup.py [--compile-injector] [--check-only]
"""

import argparse
import os
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).parent.parent  # DCC_RING0/validation/


def check_root() -> bool:
    return os.geteuid() == 0


def check_bpf_loaded() -> bool:
    r = subprocess.run(["bpftool", "prog", "show", "name", "dcc_causality_monitor"],
                       capture_output=True, text=True)
    return r.returncode == 0 and "dcc_causality_monitor" in r.stdout


def check_blocking_mode() -> bool:
    r = subprocess.run(["bpftool", "map", "lookup", "name", "config_map",
                        "key", "00", "00", "00", "00"],
                       capture_output=True, text=True)
    if r.returncode != 0:
        return False
    # config_map value[0] = log_only (0x00 = blocking)
    return "00" in r.stdout.split()[:4]


def compile_injector(src: Path, out: str) -> bool:
    r = subprocess.run(
        ["gcc", "-O2", "-o", out, str(src)],
        capture_output=True, text=True,
    )
    if r.returncode != 0:
        print(f"  gcc error:\n{r.stderr}")
        return False
    print(f"  Compiled: {out}")
    return True


def create_test_files() -> None:
    paths = [
        "/tmp/dcc_test_target.txt",
        "/tmp/dcc_fileA.txt",
        "/tmp/dcc_fileB.txt",
        "/tmp/dcc_shared.dat",
        "/tmp/dcc_pivot.dat",
        "/tmp/dcc_owned.txt",
        "/tmp/dcc_comm_spoof.txt",
        "/tmp/dcc_logonly_test.txt",
        "/tmp/dcc_pid_recycle.txt",
        "/tmp/dcc_double_irq.txt",
        "/tmp/dcc_victim.txt",
    ]
    for p in paths:
        Path(p).touch(mode=0o644, exist_ok=True)
    print(f"  Created {len(paths)} test files in /tmp/")


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--compile-injector", action="store_true")
    p.add_argument("--injector-out",     default="/tmp/dcc_inject")
    p.add_argument("--check-only",       action="store_true",
                   help="Only check prerequisites, don't modify anything")
    args = p.parse_args()

    ok = True

    print("=== DCC Ring 0 Validation Setup ===\n")

    print("[1] Root check")
    if check_root():
        print("  ✓ Running as root")
    else:
        print("  ✗ Not root — bpftool map updates will fail. Re-run with sudo.")
        ok = False

    print("[2] BPF programs loaded")
    if check_bpf_loaded():
        print("  ✓ dcc_causality_monitor found")
    else:
        print("  ✗ DCC BPF not loaded. Run: sudo ./dcc_loader dcc_core.bpf.o --quiet")
        ok = False

    print("[3] Blocking mode")
    if check_blocking_mode():
        print("  ✓ config_map log_only=0 (blocking)")
    else:
        print("  ✗ Guard is in log-only mode. Run with --blocking flag.")
        print("    IMPORTANT: --whitelist sshd REQUIRED to avoid lockout.")
        ok = False

    if args.compile_injector and not args.check_only:
        print("[4] Compile injector")
        src = HERE / "injector" / "dcc_inject.c"
        if src.exists():
            r = compile_injector(src, args.injector_out)
            if not r:
                ok = False
        else:
            print(f"  ✗ Source not found: {src}")
            ok = False
    else:
        print("[4] Injector binary")
        if Path(args.injector_out).exists():
            print(f"  ✓ {args.injector_out} exists")
        else:
            print(f"  ✗ {args.injector_out} missing. Run with --compile-injector.")
            ok = False

    if not args.check_only:
        print("[5] Test files")
        create_test_files()

    print()
    if ok:
        print("✓ Setup complete. Run: sudo python3 runner/run_attacks.py")
    else:
        print("✗ Prerequisites missing — see above.")
        sys.exit(1)


if __name__ == "__main__":
    main()
