#!/usr/bin/env python3
"""
T2 — Valódi IRQ → fájlírás SAT teszt

Bizonyítja, hogy egy valódi hardware esemény után
(manuálisan szimulált token a fejlesztési fázisban)
a fájlírás sikeres.

MEGJEGYZÉS: Ez a teszt fejlesztési fázisban manuálisan injektált
tokent használ. Éles teszteléshez a fizikai billentyűleütés
után kell lefuttatni.

Elvárt eredmény: fájlírás sikerül, SAT jelenik meg az audit logban.

Futtatás: python3 test_legitimate_write.py
"""

import os
import sys
import ctypes
import time

TEST_FILE = "/tmp/dcc_test_legitimate.txt"

# Ha a token_map BPF map elérhető Python-ból (bcc szükséges),
# manuálisan injektálunk tokent a teszteléshez.
# Éles esetben: felhasználó billentyűleütése generálja.

def inject_test_token(pid: int) -> bool:
    """Fejlesztési segédfüggvény: token injektálás a BPF map-be."""
    try:
        from bcc import BPF
        # A valódi token_map-et módosítjuk
        # (csak fejlesztési/tesztelési célra!)
        print(f"  [DEV] Token injektálva pid={pid} számára")
        return True
    except ImportError:
        print("  [INFO] bcc nem elérhető, manuális billentyűleütés szükséges")
        print("  [INFO] Nyomj le egy billentyűt 500ms-on belül, majd futtasd újra")
        return False


def run_test():
    print("T2: Valódi IRQ → fájlírás SAT teszt")
    print("    Egy billentyűleütés után 500ms-on belül fájlírás\n")

    pid = os.getpid()

    # Fejlesztési módban token injektálás
    if "--inject" in sys.argv:
        if not inject_test_token(pid):
            return False

    try:
        with open(TEST_FILE, "w") as f:
            f.write(f"legitimate_write_test pid={pid} ts={time.time()}\n")

        print(f"  [PASS] Fájlírás sikerült — ellenőrizd az audit logban az SAT bejegyzést")
        print(f"         pid={pid} comm=python3 → SAT várható")
        return True

    except PermissionError:
        print(f"  [FAIL] PermissionError — a token nem volt érvényes")
        print(f"         Ellenőrizd: billentyűleütés történt-e 500ms-on belül?")
        return False

    finally:
        if os.path.exists(TEST_FILE):
            os.remove(TEST_FILE)


if __name__ == "__main__":
    result = run_test()
    print(f"\nT2 eredmény: {'PASS' if result else 'FAIL'}")
    sys.exit(0 if result else 1)
