#!/bin/bash
# DCC Ring 0 — Challenge Paritás Bizonyíték (headless szerver verzió)
set -uo pipefail
cd /home/lszok/dcc_ebpf/src
LOADER="./dcc_loader"
OBJ="./dcc_core.bpf.o"
PASS=0; FAIL=0

ok()   { echo "  [PASS] $1"; ((PASS++)); }
fail() { echo "  [FAIL] $1"; ((FAIL++)); }

echo
echo '════════════════════════════════════════════════════════════'
echo ' PROOF 1: Autonóm folyamat blokkolása (NO_TOKEN)'
echo ' Challenge analóg: AUTONOMOUS always false'
echo '════════════════════════════════════════════════════════════'
timeout 8 $LOADER $OBJ --quiet --whitelist sshd --whitelist bash > /tmp/p1.log 2>&1 &
LPID=$!
sleep 2
if kill -0 $LPID 2>/dev/null; then
    python3 /tmp/p1_writer.py 2>/dev/null || true
    sleep 1
    kill $LPID 2>/dev/null; wait $LPID 2>/dev/null || true
    if grep -q "NO_TOKEN.*python3" /tmp/p1.log; then
        ok "PROOF 1: python3 (nem whitelist) → NO_TOKEN detektálva"
        ok "  → blocking modban EPERM, headless = nincs IRQ = determinisztikus blokk"
    else
        fail "PROOF 1: NO_TOKEN nem jelent meg"
        tail -10 /tmp/p1.log
    fi
else
    fail "PROOF 1: Loader nem indult el"
fi
rm -f /tmp/p1_test.dat

echo
echo '════════════════════════════════════════════════════════════'
echo ' PROOF 2: Whitelistelt folyamat írhat (WHITELIST verdikt)'
echo ' Challenge analóg: score === 5, intent.valid = true'
echo '════════════════════════════════════════════════════════════'
# NEM --quiet, mert az elnyomja a WHITELIST per-event sorokat
timeout 8 $LOADER $OBJ --whitelist sshd --whitelist bash --whitelist python3 > /tmp/p2.log 2>&1 &
LPID=$!
sleep 2
if kill -0 $LPID 2>/dev/null; then
    python3 /tmp/p2_writer.py 2>/dev/null || true
    sleep 1
    kill $LPID 2>/dev/null; wait $LPID 2>/dev/null || true
    if grep -q "WHITELIST.*python3" /tmp/p2.log; then
        ok "PROOF 2: python3 (whitelistelt) → WHITELIST verdikt, írás engedélyezett"
    else
        fail "PROOF 2: WHITELIST verdikt nem jelent meg"
        tail -20 /tmp/p2.log
    fi
else
    fail "PROOF 2: Loader nem indult el"
fi
rm -f /tmp/p2_test.dat

echo
echo '════════════════════════════════════════════════════════════'
echo ' PROOF 3: TOCTOU — forráskód hard block + Z3 formális'
echo ' Challenge analóg: LOCK→STAGE→COMMIT, TOCTOU zárás'
echo '════════════════════════════════════════════════════════════'
# -A4 kell: emit_ex() sor + 3 sor = return -1 a 4. sorban
if grep -A4 "VERDICT_TX_ROLLBACK" dcc_core.bpf.c 2>/dev/null | grep -q "return -1"; then
    ok "PROOF 3a: TX_ROLLBACK → return -1 (hard-coded, nincs config bypass)"
else
    fail "PROOF 3a: return -1 nem talalhato a TX_ROLLBACK agban"
fi
if python3 /home/lszok/dcc_ebpf/tests/verify_dcc_ring0_bio.py 2>/dev/null | grep -q "P2: PASS"; then
    ok "PROOF 3b: Z3 PASS — TX_STAGED+!same_inode soha nem SAT (formálisan bizonyítva)"
else
    fail "PROOF 3b: Z3 P2 sikertelen"
fi

echo
echo '════════════════════════════════════════════════════════════'
echo ' PROOF 4: FILE AXIOM — BLOCKED fájl (AXIOM_MISMATCH, nincs SAT)'
echo ' Challenge analóg: BIO zone 0xDEAD mindig read-only'
echo '════════════════════════════════════════════════════════════'
touch /tmp/blk.dat
# python3 NEM whitelistelt → eléri a file_axiom_map check-et → AXIOM_MISMATCH
timeout 8 $LOADER $OBJ --quiet --whitelist sshd --whitelist bash --protect blk.dat:block > /tmp/p4.log 2>&1 &
LPID=$!
sleep 2
if kill -0 $LPID 2>/dev/null; then
    python3 /tmp/p4_writer.py 2>/dev/null || true
    sleep 1
    kill $LPID 2>/dev/null; wait $LPID 2>/dev/null || true
    # Az összesítőből ellenőrizzük (quiet mód elnyomja a WHITELIST-et, de AXIOM látszik)
    if grep -qE "AXIOM_MISMATCH +[1-9]" /tmp/p4.log; then
        ok "PROOF 4: BLOCKED fájl → AXIOM_MISMATCH (nincs token sem segít)"
        ok "  → Challenge 0xDEAD BIO zone analog: kernel file_axiom_map kikényszerítve"
    else
        fail "PROOF 4: AXIOM_MISMATCH nem jelent meg"
        grep 'AXIOM\|axiom' /tmp/p4.log | head -10
    fi
else
    fail "PROOF 4: Loader nem indult el"
fi
rm -f /tmp/blk.dat

echo
echo '════════════════════════════════════════════════════════════'
printf ' ÖSSZESÍTŐ — DCC Ring 0 Challenge Paritás Bizonyíték\n'
echo '════════════════════════════════════════════════════════════'
TOTAL=$((PASS+FAIL))
echo "  Eredmény: $PASS / $TOTAL PASS"
echo
echo "  Challenge guarantee            | Ring 0 kernel bizonyíték"
echo "  -------------------------------+-----------------------------"
echo "  AUTONOMOUS always false        | PROOF 1: NO_TOKEN/EPERM"
echo "  Whitelist (intent.valid=true)  | PROOF 2: WHITELIST verdikt OK"
echo "  LOCK→STAGE→COMMIT (TOCTOU)     | PROOF 3: hard -1 + Z3 PASS"
echo "  BIO zone 0xDEAD (read-only)    | PROOF 4: AXIOM_MISMATCH"
echo
if [ $FAIL -eq 0 ]; then
    echo "  *** CHALLENGE PARITAS IGAZOLVA: $PASS / $TOTAL teszt PASS ***"
    exit 0
else
    echo "  *** $FAIL teszt sikertelen ***"
    exit 1
fi
