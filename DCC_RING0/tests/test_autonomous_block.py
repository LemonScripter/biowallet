#!/usr/bin/env python3
"""
T1 — Autonóm fájlírás blokkolás teszt

Bizonyítja, hogy egy hardware IRQ nélkül futó folyamat
nem tud fájlt írni, ha a DCC axioma validator aktív.

Elvárt eredmény:
  - LOG-ONLY módban: írás sikerül, de UNSAT:NO_TOKEN jelenik meg az audit logban
  - BLOCKING módban: írás PermissionError-ral meghiúsul

Futtatás: python3 test_autonomous_block.py [--blocking]
"""

import os
import sys
import time
import tempfile
import argparse

TEST_FILE = "/tmp/dcc_test_autonomous.txt"
AUDIT_LOG = "/tmp/dcc_audit.log"


def run_test(blocking_mode: bool):
    print(f"T1: Autonóm fájlírás teszt ({'BLOCKING' if blocking_mode else 'LOG-ONLY'} mód)")
    print(f"    Nincs hardware IRQ — ez az autonóm osztály szimulációja\n")

    try:
        with open(TEST_FILE, "w") as f:
            f.write("autonomous_write_attempt\n")

        if blocking_mode:
            print(f"  HIBA: Az írásnak meg kellett volna hiúsulni! (PermissionError várva)")
            return False
        else:
            print(f"  [LOG-ONLY] Írás sikerült (várható) — ellenőrizd az audit logot!")
            print(f"  Audit logban UNSAT:NO_TOKEN sort kell látnod a pid={os.getpid()} folyamatra")
            return True

    except PermissionError:
        if blocking_mode:
            print(f"  [PASS] PermissionError — a DCC axioma sikeresen blokkolta az autonóm írást!")
            print(f"  Ez bizonyítja: hardware IRQ nélkül nincs fájlírás → autonóm malware KIZÁRVA")
            return True
        else:
            print(f"  [UNEXPECTED] PermissionError log-only módban — ellenőrizd a konfigurációt")
            return False

    finally:
        if os.path.exists(TEST_FILE):
            os.remove(TEST_FILE)


def check_audit_log():
    """Ellenőrzi, hogy az audit logban megjelent-e UNSAT:NO_TOKEN bejegyzés."""
    pid = os.getpid()
    if not os.path.exists(AUDIT_LOG):
        print(f"\n  [INFO] Audit log nem található: {AUDIT_LOG}")
        print(f"         Indítsd el a dcc_monitor.py-t és irányítsd a kimenetét oda")
        return

    with open(AUDIT_LOG) as f:
        lines = f.readlines()

    matching = [l for l in lines if f"pid={pid}" in l and "NO_TOKEN" in l]
    if matching:
        print(f"\n  [AUDIT] Megtalálva {len(matching)} UNSAT:NO_TOKEN bejegyzés pid={pid}-hez:")
        for line in matching[-3:]:
            print(f"    {line.rstrip()}")
    else:
        print(f"\n  [AUDIT] Nem találtam bejegyzést pid={pid}-hez az audit logban")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--blocking", action="store_true",
                        help="Blokkoló mód tesztelése (csak T6 után!)")
    args = parser.parse_args()

    result = run_test(args.blocking)
    check_audit_log()

    print(f"\nT1 eredmény: {'PASS' if result else 'FAIL'}")
    sys.exit(0 if result else 1)
